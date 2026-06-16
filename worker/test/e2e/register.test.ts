import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { applySchema } from "../helpers";
import { call } from "./scenario";
import { runPollingBatch } from "../../src/cron";

/**
 * 등록 사용자 여정 E2E — 앱이 실제로 하는 HTTP 호출 순서 그대로(지름길 없음, scenario.call 만 사용).
 * device 를 임의 INSERT 하지 않는다(그 지름길이 QA-001 데드락을 통합 테스트가 놓친 원인이다).
 * 발견한 갭은 verify 를 빨갛게 만들지 않는다: 사양 미충족은 it.todo("QA-NNN: …") + docs/QA_FINDINGS.md.
 *
 * QA-001(#3) 수정 후: 기기 등록을 push_token 에서 분리 — 토큰 없이 POST /devices {platform} 가 되고,
 * 그 device 로 POST /shipments 가 201. 푸시 거부 사용자도 등록 가능(데드락 해소).
 */

const TOKEN_A = "ExponentPushToken[AAAAAAAAAAAAAAAAAAAAAA]";
const TOKEN_B = "ExponentPushToken[BBBBBBBBBBBBBBBBBBBBBB]";

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first<{ c: number }>();
  return row?.c ?? 0;
}

/** 앱이 하듯 device 를 HTTP(POST /devices)로 선등록한다(토큰 포함) — DB 직접 INSERT(지름길) 금지. */
async function registerDevice(deviceId: string, token: string): Promise<void> {
  const res = await call("POST", "/devices", {
    deviceId,
    json: { push_token: token, platform: "ios" },
  });
  expect(res.status).toBe(200);
}

/** 앱 부트스트랩처럼 토큰 없이 device 만 등록(푸시 거부/미허용 경로). */
async function ensureDevice(deviceId: string): Promise<void> {
  const res = await call("POST", "/devices", { deviceId, json: { platform: "ios" } });
  expect(res.status).toBe(200);
}

/**
 * 주입용 fake fetch — track 은 지정 status 의 lastEvent 를 돌려주고, Expo push send 호출 수를 센다.
 * C1(NULL 토큰 device 가 폴링 전환돼도 push 안 감) 검증용 최소 fake.
 */
function makeFetch(status: string): { fetch: typeof fetch; sendCalls: () => number } {
  let sends = 0;
  const fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("oauth2/token")) return Response.json({ access_token: "tok", expires_in: 3600 });
    if (url.includes("graphql")) {
      const node = { time: new Date().toISOString(), status: { code: status } };
      return Response.json({ data: { track: { lastEvent: node, events: { edges: [{ node }] } } } });
    }
    if (url.includes("push/send")) {
      sends++;
      return Response.json({ data: [{ status: "ok", id: `tk-${sends}` }] });
    }
    if (url.includes("push/getReceipts")) return Response.json({ data: {} });
    throw new Error(`unexpected url: ${url}`);
  }) as typeof fetch;
  return { fetch, sendCalls: () => sends };
}

describe("E2E 등록 여정 — 지름길 없이 사용자 순서 그대로", () => {
  beforeEach(async () => {
    await applySchema(env.DB);
  });

  // ── 1. (QA-001 #3) 푸시 거부(토큰 없음)여도 등록 가능 — 데드락 해소 ──
  it("[QA-001 해소] 토큰 없이 POST /devices {platform} → 그 device 로 POST /shipments 201", async () => {
    // 푸시를 거부한 사용자도 앱이 토큰 없이 device 를 부트스트랩한다 → 운송장 등록이 401 이 아니라 201.
    await ensureDevice("qa001-no-token");
    const res = await call("POST", "/shipments", {
      deviceId: "qa001-no-token",
      json: { carrier: "kr.cjlogistics", tracking_no: "123456789012" },
    });
    expect(res.status).toBe(201); // 데드락 해소(이전엔 401).
    expect(await count("shipments")).toBe(1);
    // device 는 등록됐으나 push_token 은 NULL(알림만 비활성).
    expect(await count("devices")).toBe(1);
    const tok = await env.DB.prepare("SELECT push_token AS t FROM devices WHERE id = ?")
      .bind("qa001-no-token")
      .first<{ t: string | null }>();
    expect(tok?.t).toBeNull();
  });

  it("기기 선등록 계약 유지 — POST /devices 생략 시 POST /shipments 는 여전히 401", async () => {
    // 앱은 항상 ensureDevice 를 선행하지만, 서버 계약(미등록 device_id → 401)은 그대로 유지한다.
    const res = await call("POST", "/shipments", {
      deviceId: "truly-unregistered",
      json: { carrier: "kr.cjlogistics", tracking_no: "123456789012" },
    });
    expect(res.status).toBe(401);
    expect((res.body as { code: string }).code).toBe("UNAUTHORIZED");
    expect(await count("shipments")).toBe(0);
  });

  it("[C1] NULL 토큰 device 구독 송장이 전환돼도 그 device 엔 push 안 감(오발송 방지)", async () => {
    await ensureDevice("dev-null"); // 토큰 없는 device.
    await call("POST", "/shipments", {
      deviceId: "dev-null",
      json: { carrier: "kr.cjlogistics", tracking_no: "123456789012" },
    });
    // 배송출발(알림 단계)로 전환되는 폴링을 돌려도 NULL 토큰이라 subscriberTokens 가 걸러 send 0.
    const f = makeFetch("OUT_FOR_DELIVERY");
    await runPollingBatch(env, { now: Date.now(), fetch: f.fetch });
    expect(f.sendCalls()).toBe(0);
  });

  it("이중 등록 멱등 — 토큰 없이 등록 후 토큰으로 재등록 → device 1행·push_token 갱신", async () => {
    await ensureDevice("dev-up"); // 1) 토큰 없이.
    await registerDevice("dev-up", TOKEN_A); // 2) 토큰으로 upsert(같은 device_id).
    expect(await count("devices")).toBe(1); // 새 행 없이 1행 유지.
    const tok = await env.DB.prepare("SELECT push_token AS t FROM devices WHERE id = ?")
      .bind("dev-up")
      .first<{ t: string | null }>();
    expect(tok?.t).toBe(TOKEN_A); // NULL → 토큰으로 갱신.
  });

  // ── 2. 정상 등록 여정 ──
  it("device 등록 → 운송장 201 → 같은 기기 재등록 멱등 200(shipments 1행)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const c1 = await call("POST", "/shipments", {
      deviceId: "dev-A",
      json: { carrier: "kr.cjlogistics", tracking_no: "123456789012" },
    });
    expect(c1.status).toBe(201);

    const c2 = await call("POST", "/shipments", {
      deviceId: "dev-A",
      json: { carrier: "kr.cjlogistics", tracking_no: "123456789012" },
    });
    expect(c2.status).toBe(200); // 멱등 — 새 행 없이 기존 구독 반환.
    expect(await count("shipments")).toBe(1);
    expect(await count("subscriptions")).toBe(1);
  });

  it("두 기기가 같은 송장 → dedupe(shipments 1, subscriptions 2), 목록은 각자 것만", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerDevice("dev-B", TOKEN_B);
    expect(
      (
        await call("POST", "/shipments", {
          deviceId: "dev-A",
          json: { carrier: "kr.cjlogistics", tracking_no: "111111111111" },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call("POST", "/shipments", {
          deviceId: "dev-B",
          json: { carrier: "kr.cjlogistics", tracking_no: "111111111111" },
        })
      ).status,
    ).toBe(201);
    expect(await count("shipments")).toBe(1); // dedupe — 같은 (carrier, tracking_no) 는 1행.
    expect(await count("subscriptions")).toBe(2);

    // dev-B 가 다른 송장도 등록 → dev-A 목록엔 안 보인다(격리).
    await call("POST", "/shipments", {
      deviceId: "dev-B",
      json: { carrier: "kr.epost", tracking_no: "222222222222" },
    });
    const listA = await call("GET", "/shipments", { deviceId: "dev-A" });
    expect((listA.body as { shipments: unknown[] }).shipments).toHaveLength(1);
    const listB = await call("GET", "/shipments", { deviceId: "dev-B" });
    expect((listB.body as { shipments: unknown[] }).shipments).toHaveLength(2);
  });

  it("타 기기의 GET/DELETE /:id → 404 (인가·존재 누설 안 함)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerDevice("dev-B", TOKEN_B);
    const created = await call("POST", "/shipments", {
      deviceId: "dev-A",
      json: { carrier: "kr.cjlogistics", tracking_no: "123456789012" },
    });
    const id = (created.body as { shipment: { id: string } }).shipment.id;

    expect((await call("GET", `/shipments/${id}`, { deviceId: "dev-B" })).status).toBe(404);
    expect((await call("DELETE", `/shipments/${id}`, { deviceId: "dev-B" })).status).toBe(404);
    // 인가 실패가 데이터를 건드리지 않았다.
    expect(await count("shipments")).toBe(1);
    expect(await count("subscriptions")).toBe(1);
  });

  it("활성 상한(100) 초과 → 429 — DB 시드 없이 HTTP 로 100건 등록 후 101번째", async () => {
    await registerDevice("dev-A", TOKEN_A);
    // 지름길(DB 직접 시드) 없이 앱이 하듯 100회 등록한다(각 고유 운송장).
    for (let i = 0; i < 100; i++) {
      const tno = String(100000000000 + i);
      const r = await call("POST", "/shipments", {
        deviceId: "dev-A",
        json: { carrier: "kr.cjlogistics", tracking_no: tno },
      });
      expect(r.status).toBe(201);
    }
    const over = await call("POST", "/shipments", {
      deviceId: "dev-A",
      json: { carrier: "kr.cjlogistics", tracking_no: "999999999999" },
    });
    expect(over.status).toBe(429);
    expect((over.body as { code: string }).code).toBe("RATE_LIMITED");
  });

  // ── 3. 형식/매핑(서버 검증). 앱 친근 카피 매핑은 QA_FINDINGS(QA-003) 감사 ──
  it("carrier 형식 오류 → 409, 운송장 형식 오류 → 422", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const badCarrier = await call("POST", "/shipments", {
      deviceId: "dev-A",
      json: { carrier: "잘못된택배사", tracking_no: "123456789012" },
    });
    expect(badCarrier.status).toBe(409);
    expect((badCarrier.body as { code: string }).code).toBe("CARRIER_UNSUPPORTED");

    const badTracking = await call("POST", "/shipments", {
      deviceId: "dev-A",
      json: { carrier: "kr.cjlogistics", tracking_no: "123" },
    });
    expect(badTracking.status).toBe(422);
    expect((badTracking.body as { code: string }).code).toBe("INVALID_TRACKING");
  });

  it("[QA-002 재현] 형식 유효하나 미지원 택배사도 201 수락 — 딥링크 폴백 미도달", async () => {
    await registerDevice("dev-A", TOKEN_A);
    // 'kr.notreal' 은 CARRIER_RE(형식)은 통과하나 실제 미지원. 서버가 지원목록 대조를 안 해 201 수락 →
    // 영구 미등록(7일 후 비활성). 사양(PRD 플로우4)의 409 → 딥링크 안내가 트리거되지 않는다.
    const res = await call("POST", "/shipments", {
      deviceId: "dev-A",
      json: { carrier: "kr.notreal", tracking_no: "123456789012" },
    });
    expect(res.status).toBe(201); // 기대(사양)는 409 CARRIER_UNSUPPORTED. QA-002.
    expect(await count("shipments")).toBe(1);
  });

  // 사양: 형식은 유효하나 tracker.delivery 미지원인 택배사는 409 → 앱 딥링크 폴백 — 아직 미충족.
  it.todo("QA-002: 미지원(형식 유효) 택배사를 409 CARRIER_UNSUPPORTED 로 거르고 딥링크 안내 (서버 지원목록 대조 부재)");

  // ── 4. 택배사 추정(app carrier.ts) 감사 ──
  // 추정 로직은 app 패키지라 여기서 실행 불가 — app/src/lib/carrier.test.ts 가 사양(자릿수별 후보 순서,
  // 정규화 재사용, 무효·빈 입력 → 빈 배열)을 전수 커버한다. 감사 결론: 추정 자체는 사양 충족.
  // 잔여 갭(형식 유효하나 미지원/오추정 carrier 가 그대로 수락)은 서버측 QA-002 로 기록.
});
