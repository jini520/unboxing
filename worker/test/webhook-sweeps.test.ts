import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { applySchema } from "./helpers";
import { runPollingBatch } from "../src/cron";

/**
 * cron webhook sweeps 통합 (ADR-028, docs/QA.md F-2·F-3 W7·W10·W11·W12).
 *
 * cron 은 신선도 1차에서 **유지보수+저빈도 폴백**으로 전환됐다. 본 파일은 cron 의 webhook 표면을 검증한다:
 *  - 조건부 폴백 due(등록분 ~12h·NULL 적응형, isDue 단일 출처)
 *  - webhook 24h 재등록 sweep(만료 임박만)
 *  - webhook 등록 sweep(즉시 마이그레이션·승급 W7·등록 실패 NULL 재시도)
 *  - lifecycle 독립 sweep(재폴링 0 webhook 송장도 비활성·W11)
 *  - 슬롯 위생(비active → 재등록 제외) · 예산 우선·이월(재등록 우선·등록 이월·W10)
 *
 * runPollingBatch 는 now·fetch 주입으로 결정적. 외부(tracker.delivery·Expo)는 fetch 스텁으로 mock —
 * 토큰·track·registerTrackWebhook·push 를 캔드로 돌려준다. 자격증명/시크릿/베이스URL 를 채워 등록 sweep 핫패스를 켠다.
 */

const NOW = 1_700_017_200_000; // KST 2023-11-15 12:00 (주간 — 조용시간 아님, 운영성 안내 즉시 발송)
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BASE = "https://wh.example.com";
const SECRET = "wh-secret-sweep";

let saved: { id: string; secret: string; cb: string; base: string | undefined };

beforeEach(async () => {
  await applySchema(env.DB);
  saved = {
    id: env.DELIVERY_TRACKER_CLIENT_ID,
    secret: env.DELIVERY_TRACKER_CLIENT_SECRET,
    cb: env.WEBHOOK_CALLBACK_SECRET,
    base: env.WEBHOOK_CALLBACK_BASE_URL,
  };
  // 등록/재등록 sweep 핫패스를 켠다(없으면 webhookRegContext 가 null → sweep skip). 외부는 스텁.
  env.DELIVERY_TRACKER_CLIENT_ID = "cid";
  env.DELIVERY_TRACKER_CLIENT_SECRET = "csecret";
  env.WEBHOOK_CALLBACK_SECRET = SECRET;
  env.WEBHOOK_CALLBACK_BASE_URL = BASE;
});

afterEach(() => {
  env.DELIVERY_TRACKER_CLIENT_ID = saved.id;
  env.DELIVERY_TRACKER_CLIENT_SECRET = saved.secret;
  env.WEBHOOK_CALLBACK_SECRET = saved.cb;
  env.WEBHOOK_CALLBACK_BASE_URL = saved.base;
});

interface StubOpts {
  /** track lastEvent.status.code 기본값(due 송장 폴링용). null → 데이터 없음(미등록). */
  defaultTrack?: string | null;
  /** tracking_no 별 track status.code 오버라이드(승급 등 단계 변화 검증용). */
  trackMap?: Record<string, string | null>;
  /** registerTrackWebhook 이 GraphQL 오류(쿼터·1000 초과 등)를 반환. */
  registerFails?: boolean;
}

interface StubCalls {
  track: number; // track(GraphQL) 호출 수
  register: number; // registerTrackWebhook 호출 수
  registeredNos: string[]; // 등록된 trackingNumber 목록(재등록 vs 등록 sweep 분간)
  callbackUrls: string[];
}

/** globalThis.fetch 를 토큰·track·register·push 분기 스텁으로 교체(주입 deps.fetch 가 잡는다). */
function stubFetch(opts: StubOpts): { fetch: typeof fetch; calls: StubCalls } {
  const calls: StubCalls = { track: 0, register: 0, registeredNos: [], callbackUrls: [] };
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("oauth2/token")) {
      return Response.json({ access_token: "tok", expires_in: 3600 });
    }
    if (url.includes("graphql")) {
      const body = JSON.parse((init?.body as string) ?? "{}") as {
        query: string;
        variables: Record<string, unknown>;
      };
      if (body.query.includes("registerTrackWebhook")) {
        calls.register += 1;
        calls.registeredNos.push(String(body.variables.trackingNumber));
        calls.callbackUrls.push(String(body.variables.callbackUrl));
        if (opts.registerFails) {
          return Response.json({ errors: [{ message: "quota", extensions: { code: "RESOURCE_EXHAUSTED" } }] });
        }
        return Response.json({ data: { registerTrackWebhook: { id: "wh-1" } } });
      }
      // track 쿼리 — variables.trackingNumber 로 trackMap 우선, 없으면 defaultTrack.
      calls.track += 1;
      const no = String(body.variables.trackingNumber);
      const code = no in (opts.trackMap ?? {}) ? opts.trackMap![no] : (opts.defaultTrack ?? null);
      const node = code ? { time: new Date(NOW).toISOString(), status: { code }, description: "d" } : null;
      return Response.json({ data: { track: { lastEvent: node, events: { edges: node ? [{ node }] : [] } } } });
    }
    if (url.includes("push/getReceipts")) {
      return Response.json({ data: {} });
    }
    if (url.includes("push/send")) {
      const batch = JSON.parse(String(init?.body)) as unknown[];
      return Response.json({ data: batch.map((_, i) => ({ status: "ok", id: `tk-${i}` })) });
    }
    throw new Error(`unexpected url: ${url}`);
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

async function seed(
  id: string,
  o: {
    trackingNo: string;
    status?: string | null;
    lastPolledAt?: number | null;
    webhookExpiresAt?: number | null;
    createdAt?: number;
    active?: number;
  },
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO shipments (id, carrier, tracking_no, last_normalized_status, last_polled_at, active, created_at, webhook_expires_at) " +
      "VALUES (?, 'kr.cjlogistics', ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      o.trackingNo,
      o.status ?? null,
      o.lastPolledAt ?? null,
      o.active ?? 1,
      o.createdAt ?? NOW,
      o.webhookExpiresAt ?? null,
    )
    .run();
}

async function seedSubscriber(deviceId: string, token: string, shipmentId: string): Promise<void> {
  await env.DB.prepare("INSERT INTO devices (id, push_token, platform, created_at) VALUES (?, ?, 'ios', ?)")
    .bind(deviceId, token, NOW)
    .run();
  await env.DB.prepare("INSERT INTO subscriptions (device_id, shipment_id, created_at) VALUES (?, ?, ?)")
    .bind(deviceId, shipmentId, NOW)
    .run();
}

async function expiresOf(id: string): Promise<number | null> {
  const r = await env.DB.prepare("SELECT webhook_expires_at AS e FROM shipments WHERE id = ?")
    .bind(id)
    .first<{ e: number | null }>();
  return r?.e ?? null;
}

async function rowOf(id: string): Promise<{ active: number; lastPolledAt: number | null } | null> {
  const r = await env.DB.prepare("SELECT active AS a, last_polled_at AS p FROM shipments WHERE id = ?")
    .bind(id)
    .first<{ a: number; p: number | null }>();
  return r ? { active: r.a, lastPolledAt: r.p } : null;
}

async function count(sql: string): Promise<number> {
  const r = await env.DB.prepare(sql).first<{ c: number }>();
  return r?.c ?? 0;
}

describe("cron webhook 재등록 sweep (만료 임박만)", () => {
  it("만료 임박(<24h)·active 만 재등록·webhook_expires_at 48h 갱신 / 여유·비active 제외", async () => {
    // 폴링과 분리해 재등록만 검증 — 모두 not-due(webhook 등록분 → 12h 간격, last_polled=NOW).
    await seed("imminent", { trackingNo: "210000000001", status: "배송출발", lastPolledAt: NOW, webhookExpiresAt: NOW + 12 * HOUR });
    await seed("relaxed", { trackingNo: "210000000002", status: "배송출발", lastPolledAt: NOW, webhookExpiresAt: NOW + 30 * HOUR });
    await seed("inactive", { trackingNo: "210000000003", status: "배송출발", lastPolledAt: NOW, webhookExpiresAt: NOW + 12 * HOUR, active: 0 });
    const { fetch, calls } = stubFetch({ defaultTrack: "OUT_FOR_DELIVERY" });

    await runPollingBatch(env, { now: NOW, fetch });

    expect(calls.register).toBe(1); // imminent 만 재등록
    expect(calls.registeredNos).toEqual(["210000000001"]);
    expect(calls.callbackUrls[0]).toBe(`${BASE}/webhooks/track/${SECRET}`);
    expect(await expiresOf("imminent")).toBe(NOW + 48 * HOUR); // 48h 앞으로 갱신
    expect(await expiresOf("relaxed")).toBe(NOW + 30 * HOUR); // 여유 → 불변
    expect(await expiresOf("inactive")).toBe(NOW + 12 * HOUR); // 비active → 제외(자연 만료로 슬롯 회수)
    expect(calls.track).toBe(0); // 모두 not-due → 폴링 없음
  });
});

describe("cron 조건부 폴백 due (등록분 ~12h · NULL 적응형)", () => {
  it("webhook 등록분은 ~12h 전엔 due ❌, NULL(미등록 폴백)은 적응형대로 due", async () => {
    // 둘 다 배송출발(NULL 기준 60분 간격)·2h 전 폴링. 등록분(12h)은 미due, NULL 분은 due.
    await seed("hooked", { trackingNo: "220000000001", status: "배송출발", lastPolledAt: NOW - 2 * HOUR, webhookExpiresAt: NOW + 48 * HOUR });
    await seed("fallback", { trackingNo: "220000000002", status: "배송출발", lastPolledAt: NOW - 2 * HOUR, webhookExpiresAt: null });
    const { fetch, calls } = stubFetch({ defaultTrack: "OUT_FOR_DELIVERY" });

    await runPollingBatch(env, { now: NOW, fetch });

    expect(calls.track).toBe(1); // fallback(NULL) 만 폴링
    expect((await rowOf("hooked"))?.lastPolledAt).toBe(NOW - 2 * HOUR); // webhook 분 미폴링(선점 안 됨)
    expect((await rowOf("fallback"))?.lastPolledAt).toBe(NOW); // NULL 분 폴링(선점 갱신)
  });
});

describe("cron webhook 등록 sweep (즉시 마이그레이션·승급·재시도)", () => {
  it("active·NULL·등록가능 송장을 due 무관 등록·webhook_expires_at set(이후 due ~12h)", async () => {
    // not-due(last_polled=NOW)라 폴링은 0 — 등록 sweep 이 due 무관 등록함을 확인.
    await seed("mig1", { trackingNo: "230000000001", status: "배송출발", lastPolledAt: NOW, webhookExpiresAt: null });
    await seed("mig2", { trackingNo: "230000000002", status: "이동중", lastPolledAt: NOW, webhookExpiresAt: null });
    const { fetch, calls } = stubFetch({ defaultTrack: "OUT_FOR_DELIVERY" });

    await runPollingBatch(env, { now: NOW, fetch });

    expect(calls.track).toBe(0); // 폴링 0(not-due)
    expect(calls.register).toBe(2); // 둘 다 due 무관 등록
    expect(await expiresOf("mig1")).toBe(NOW + 48 * HOUR);
    expect(await expiresOf("mig2")).toBe(NOW + 48 * HOUR);
  });

  it("미등록·배송완료·비active 는 등록 sweep 제외", async () => {
    await seed("unreg", { trackingNo: "240000000001", status: null, lastPolledAt: NOW, webhookExpiresAt: null });
    await seed("done", { trackingNo: "240000000002", status: "배송완료", lastPolledAt: NOW, webhookExpiresAt: null, active: 1 });
    await seed("off", { trackingNo: "240000000003", status: "배송출발", lastPolledAt: NOW, webhookExpiresAt: null, active: 0 });
    const { fetch, calls } = stubFetch({ defaultTrack: "OUT_FOR_DELIVERY" });

    await runPollingBatch(env, { now: NOW, fetch });

    expect(calls.register).toBe(0);
    expect(await expiresOf("unreg")).toBeNull();
    expect(await expiresOf("done")).toBeNull();
    expect(await expiresOf("off")).toBeNull();
  });

  it("승급(W7): 미등록→첫 이벤트 폴링 후 같은 fire 의 등록 sweep 이 픽업", async () => {
    // 미등록·due(last_polled=null) → 폴링이 첫 이벤트(등록) 감지 → 등록 sweep 이 등록 가능 단계로 픽업.
    await seed("promote", { trackingNo: "250000000001", status: null, lastPolledAt: null, webhookExpiresAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "promote");
    const { fetch, calls } = stubFetch({ trackMap: { "250000000001": "INFORMATION_RECEIVED" } });

    await runPollingBatch(env, { now: NOW, fetch });

    expect(calls.track).toBe(1); // 폴링이 미등록→등록 으로 승급
    expect(calls.register).toBe(1); // 같은 fire 등록 sweep 이 픽업(W7)
    expect(calls.registeredNos).toEqual(["250000000001"]);
    expect(await expiresOf("promote")).toBe(NOW + 48 * HOUR);
  });

  it("등록 실패 → NULL 유지(폴백) → 다음 fire 재시도(W3·W4)", async () => {
    await seed("retry", { trackingNo: "260000000001", status: "배송출발", lastPolledAt: NOW, webhookExpiresAt: null });

    // 1차: 등록 실패 → NULL 유지(폴백 폴링이 흡수).
    const first = stubFetch({ defaultTrack: "OUT_FOR_DELIVERY", registerFails: true });
    await runPollingBatch(env, { now: NOW, fetch: first.fetch });
    expect(first.calls.register).toBe(1);
    expect(await expiresOf("retry")).toBeNull();

    // 2차: 같은 NULL 행을 등록 sweep 이 재시도 → 성공 시 set.
    const second = stubFetch({ defaultTrack: "OUT_FOR_DELIVERY" });
    await runPollingBatch(env, { now: NOW + HOUR, fetch: second.fetch });
    expect(second.calls.register).toBe(1);
    expect(await expiresOf("retry")).toBe(NOW + HOUR + 48 * HOUR);
  });
});

describe("cron lifecycle 독립 sweep (폴링 분리·W11)", () => {
  it("재폴링이 거의 없는 webhook 송장도 30일 경과 시 비활성+분실 안내", async () => {
    // webhook 등록분(expires set·12h 간격)이라 last_polled=NOW 면 폴링은 안 함 → 폴링 안에서 판정하면 만료 누락.
    await seed("zombie", {
      trackingNo: "270000000001",
      status: "이동중",
      lastPolledAt: NOW,
      webhookExpiresAt: NOW + 48 * HOUR,
      createdAt: NOW - 31 * DAY,
    });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "zombie");
    const { fetch, calls } = stubFetch({ defaultTrack: "IN_TRANSIT" });

    await runPollingBatch(env, { now: NOW, fetch });

    expect(calls.track).toBe(0); // 폴링 안 됨(not-due webhook 송장)
    expect((await rowOf("zombie"))?.active).toBe(0); // 독립 sweep 이 비활성(W11)
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(0); // 주간이라 즉시 발송(보류 아님)
  });
});

describe("cron 예산 공유 (재등록 우선·등록 이월·W10)", () => {
  it("재등록이 예산(≤50)을 선점하면 등록 sweep 은 이월된다", async () => {
    // 50건 만료 임박(재등록-due)·not-due + 5건 NULL 등록가능·not-due.
    for (let i = 0; i < 50; i++) {
      await seed(`re${i}`, {
        trackingNo: String(280000000000 + i),
        status: "배송출발",
        lastPolledAt: NOW,
        webhookExpiresAt: NOW + 12 * HOUR, // <24h → 재등록 due
      });
    }
    for (let i = 0; i < 5; i++) {
      await seed(`new${i}`, {
        trackingNo: String(290000000000 + i),
        status: "배송출발",
        lastPolledAt: NOW,
        webhookExpiresAt: null, // 등록 sweep 대상
      });
    }
    const { fetch, calls } = stubFetch({ defaultTrack: "OUT_FOR_DELIVERY" });

    await runPollingBatch(env, { now: NOW, fetch });

    expect(calls.register).toBe(50); // 재등록이 예산 50 을 전부 소진
    // 재등록 50건은 갱신, NULL 5건은 이월(등록 sweep 예산 0) → 여전히 NULL.
    expect(await count("SELECT COUNT(*) AS c FROM shipments WHERE webhook_expires_at = " + (NOW + 48 * HOUR))).toBe(50);
    expect(await count("SELECT COUNT(*) AS c FROM shipments WHERE webhook_expires_at IS NULL")).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(calls.registeredNos).not.toContain(String(290000000000 + i)); // 등록 sweep 미실행(이월)
    }
  });
});
