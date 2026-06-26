import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker from "../src/index";
import { applySchema } from "./helpers";

/**
 * POST /webhooks/track/<secret> 콜백 수신 통합 (ADR-028·029, docs/QA.md F-2·F-3 W1·W2·W5·W6·W12).
 *
 * 콜백 재조회·CAS·푸시는 ctx.waitUntil 비동기라 createExecutionContext + waitOnExecutionContext 로 완료를
 * 결정적으로 기다린다. 외부(tracker.delivery track·Expo push/send)는 globalThis.fetch 스텁으로 mock —
 * 워커는 fetch.bind(globalThis) 라 스텁이 잡힌다(P-1·T1).
 *
 * 검증: 잘못된 시크릿 → 401·무처리(W2) / D1 미존재·비active → 202·track 미호출(W1·W12) /
 *       유효 active → track→CAS→푸시 / 중복 콜백(같은 단계) → 푸시 0(W6) / 직전 폴링 <60s → skip /
 *       track 실패 → 202(W5, 폴백 폴링 흡수).
 */

const BASE = "https://example.com";
const SECRET = "wh-secret-xyz";
const NOW = 1_700_017_200_000; // KST 2023-11-15 12:00 (시각 무관 즉시 발송 — ADR-030)
const MINUTE = 60_000;

let saved: { id: string; secret: string; cb: string };

beforeEach(async () => {
  await applySchema(env.DB);
  saved = {
    id: env.DELIVERY_TRACKER_CLIENT_ID,
    secret: env.DELIVERY_TRACKER_CLIENT_SECRET,
    cb: env.WEBHOOK_CALLBACK_SECRET,
  };
  // 콜백 다운스트림(track)이 도달하도록 자격증명/시크릿을 채운다(외부는 스텁).
  env.DELIVERY_TRACKER_CLIENT_ID = "cid";
  env.DELIVERY_TRACKER_CLIENT_SECRET = "csecret";
  env.WEBHOOK_CALLBACK_SECRET = SECRET;
});

afterEach(() => {
  env.DELIVERY_TRACKER_CLIENT_ID = saved.id;
  env.DELIVERY_TRACKER_CLIENT_SECRET = saved.secret;
  env.WEBHOOK_CALLBACK_SECRET = saved.cb;
  vi.unstubAllGlobals();
});

interface StubCalls {
  track: number;
  send: number;
  sentBodies: string[];
}

/** globalThis.fetch 를 token·track·send 분기 스텁으로 교체. track 은 주어진 status.code 를 lastEvent 로 돌려준다. */
function stubFetch(opts: { trackCode?: string | null; trackFails?: boolean }): StubCalls {
  const calls: StubCalls = { track: 0, send: 0, sentBodies: [] };
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("oauth2/token")) {
      return Response.json({ access_token: "tok", expires_in: 3600 });
    }
    if (url.includes("graphql")) {
      calls.track += 1;
      if (opts.trackFails) {
        return Response.json({ errors: [{ message: "boom", extensions: { code: "INTERNAL" } }] });
      }
      const code = opts.trackCode ?? null;
      const node = code ? { time: new Date(NOW).toISOString(), status: { code }, description: "d" } : null;
      return Response.json({ data: { track: { lastEvent: node, events: { edges: node ? [{ node }] : [] } } } });
    }
    if (url.includes("push/send")) {
      calls.send += 1;
      const batch = JSON.parse(String(init?.body)) as { body: string }[];
      calls.sentBodies.push(...batch.map((m) => m.body));
      return Response.json({ data: batch.map((_, i) => ({ status: "ok", id: `tk-${calls.send}-${i}` })) });
    }
    return new Response(null, { status: 503 });
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fn);
  return calls;
}

/** active 송장 1건 + (선택) 구독자(푸시 토큰). */
async function seedShipment(o: {
  status?: string | null;
  lastPolledAt?: number | null;
  active?: number;
  withSubscriber?: boolean;
}): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO shipments (id, carrier, tracking_no, last_normalized_status, last_polled_at, active, created_at, status_changed_at) " +
      "VALUES ('S', 'kr.cjlogistics', '522093451360', ?, ?, ?, ?, ?)",
  )
    .bind(o.status ?? null, o.lastPolledAt ?? null, o.active ?? 1, NOW, NOW)
    .run();
  if (o.withSubscriber) {
    await env.DB.prepare(
      "INSERT INTO devices (id, push_token, platform, created_at) VALUES ('dev-A', 'ExponentPushToken[AAA]', 'ios', ?)",
    )
      .bind(NOW)
      .run();
    await env.DB.prepare(
      "INSERT INTO subscriptions (device_id, shipment_id, created_at) VALUES ('dev-A', 'S', ?)",
    )
      .bind(NOW)
      .run();
  }
}

/** POST /webhooks/track/<secret> 호출 + waitUntil(재조회) 완료까지 대기. */
async function postCallback(
  secret: string,
  payload: unknown,
): Promise<number> {
  const ctx = createExecutionContext();
  const req = new Request(`${BASE}/webhooks/track/${secret}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res.status;
}

async function statusOf(): Promise<string | null> {
  const r = await env.DB.prepare("SELECT last_normalized_status AS s FROM shipments WHERE id='S'")
    .first<{ s: string | null }>();
  return r?.s ?? null;
}

async function count(sql: string): Promise<number> {
  const r = await env.DB.prepare(sql).first<{ c: number }>();
  return r?.c ?? 0;
}

const VALID = { carrierId: "kr.cjlogistics", trackingNumber: "522093451360" };

describe("POST /webhooks/track/<secret> 콜백", () => {
  it("잘못된 시크릿 → 401·무처리(track 미호출, W2)", async () => {
    await seedShipment({ status: "등록", lastPolledAt: null, withSubscriber: true });
    const calls = stubFetch({ trackCode: "OUT_FOR_DELIVERY" });

    expect(await postCallback("wrong-secret", VALID)).toBe(401);

    expect(calls.track).toBe(0);
    expect(calls.send).toBe(0);
    expect(await statusOf()).toBe("등록"); // 무처리
  });

  it("D1 에 없는 번호 → 202·track 미호출(페이로드 불신, W1)", async () => {
    // 송장 미시드 — 위조·임의 번호 콜백.
    const calls = stubFetch({ trackCode: "OUT_FOR_DELIVERY" });

    expect(await postCallback(SECRET, VALID)).toBe(202);

    expect(calls.track).toBe(0);
  });

  it("비active(active=0) 송장 → 202·track 미호출(W12)", async () => {
    await seedShipment({ status: "배송완료", lastPolledAt: null, active: 0 });
    const calls = stubFetch({ trackCode: "DELIVERED" });

    expect(await postCallback(SECRET, VALID)).toBe(202);

    expect(calls.track).toBe(0);
  });

  it("본문 손상/필드 누락 → 202·track 미호출", async () => {
    await seedShipment({ status: "등록", lastPolledAt: null });
    const calls = stubFetch({ trackCode: "OUT_FOR_DELIVERY" });

    expect(await postCallback(SECRET, "not json")).toBe(202); // 파싱 실패
    expect(await postCallback(SECRET, { carrierId: "kr.cjlogistics" })).toBe(202); // trackingNumber 누락

    expect(calls.track).toBe(0);
  });

  it("유효 active 콜백 → track→CAS→전환 푸시(폴링과 동일 다운스트림)", async () => {
    // 모든 전환은 시각 무관 즉시 발송(조용시간 폐지·ADR-030) — 콜백이 공용 다운스트림(CAS·푸시)을 구동함을 검증.
    await seedShipment({ status: "배송출발", lastPolledAt: null, withSubscriber: true });
    const calls = stubFetch({ trackCode: "DELIVERED" }); // 배송출발 → 배송완료(긴급) 전환

    expect(await postCallback(SECRET, VALID)).toBe(202);

    expect(calls.track).toBe(1);
    expect(calls.send).toBe(1); // 단계 전환 → 푸시 1회(긴급 → 즉시)
    expect(await statusOf()).toBe("배송완료");
    expect(await count("SELECT COUNT(*) AS c FROM shipments WHERE id='S' AND active=0")).toBe(1); // 보관·재폴링 중단
  });

  it("중복 콜백(같은 단계, 60s 경과) → track 하지만 CAS no-op·푸시 0(W6 멱등)", async () => {
    // 신선도 throttle 은 핸들러의 실시간 Date.now() 기준이라 lastPolledAt 도 실시간 기준으로 둔다.
    // 60s 보다 과거(120s)면 throttle 통과(재조회). 단계가 이미 배송출발이라 전환이 없다.
    await seedShipment({ status: "배송출발", lastPolledAt: Date.now() - 2 * MINUTE, withSubscriber: true });
    const calls = stubFetch({ trackCode: "OUT_FOR_DELIVERY" }); // 같은 단계 재확인

    expect(await postCallback(SECRET, VALID)).toBe(202);

    expect(calls.track).toBe(1); // 재조회는 함(throttle 통과)
    expect(calls.send).toBe(0); // 전환 없음 → 푸시 0(CAS no-op)
    expect(await statusOf()).toBe("배송출발");
  });

  it("직전 폴링 <60s → 신선도 throttle skip(202·track 미호출, W6 dedupe)", async () => {
    // 실시간 Date.now() 기준 30s 전 → throttle 이 재조회를 skip.
    await seedShipment({ status: "등록", lastPolledAt: Date.now() - 30_000, withSubscriber: true });
    const calls = stubFetch({ trackCode: "OUT_FOR_DELIVERY" });

    expect(await postCallback(SECRET, VALID)).toBe(202);

    expect(calls.track).toBe(0); // 신선 → 재조회 skip
    expect(calls.send).toBe(0);
  });

  it("track 실패 → 202(폴백 폴링이 다음 due 에 흡수, W5)", async () => {
    await seedShipment({ status: "등록", lastPolledAt: null, withSubscriber: true });
    const calls = stubFetch({ trackFails: true });

    // 콜백은 202 를 이미 반환했고, 비동기 track 실패는 삼켜진다(crash 없음).
    expect(await postCallback(SECRET, VALID)).toBe(202);

    expect(calls.track).toBe(1); // 재조회 시도는 함
    expect(calls.send).toBe(0); // 실패라 전환·푸시 없음
    expect(await statusOf()).toBe("등록"); // 단계 불변
  });
});
