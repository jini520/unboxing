import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker from "../src/index";
import { applySchema } from "./helpers";

/**
 * webhook 등록 @ POST /shipments 통합 (ADR-028, docs/QA.md F-2).
 *
 * 등록은 ctx.waitUntil 비동기라 createExecutionContext + waitOnExecutionContext 로 완료를 결정적으로 기다린다
 * (SELF.fetch 는 waitUntil 종료를 보장 못 함). 외부(tracker.delivery)는 globalThis.fetch 스텁으로 mock —
 * 토큰·track·registerTrackWebhook 응답을 캔드로 돌려준다(실호출 없음). 워커는 fetch.bind(globalThis) 라 스텁이 잡힌다.
 *
 * 검증: 비미등록·active → 등록 1회·webhook_expires_at set / 미등록·배송완료 → 미호출 / dedupe-hit → 미호출 /
 *       등록 실패 → 송장 등록은 성공(201)·webhook_expires_at NULL(폴백, W3·W4).
 */

const BASE = "https://example.com";
const SECRET = "wh-secret-abc";
const HOUR = 3_600_000;

let saved: { id: string; secret: string; cb: string };

beforeEach(async () => {
  await applySchema(env.DB);
  saved = {
    id: env.DELIVERY_TRACKER_CLIENT_ID,
    secret: env.DELIVERY_TRACKER_CLIENT_SECRET,
    cb: env.WEBHOOK_CALLBACK_SECRET,
  };
  // 등록 핫패스가 즉시 track·registerTrackWebhook 까지 도달하도록 자격증명/시크릿을 채운다(외부는 스텁).
  env.DELIVERY_TRACKER_CLIENT_ID = "cid";
  env.DELIVERY_TRACKER_CLIENT_SECRET = "csecret";
  env.WEBHOOK_CALLBACK_SECRET = SECRET;
  // device 선등록(통합 단축 — handleCreateShipment 의 device 가드 통과용).
  await env.DB.prepare(
    "INSERT INTO devices (id, push_token, platform, created_at) VALUES ('dev-A', NULL, 'ios', ?)",
  )
    .bind(Date.now())
    .run();
});

afterEach(() => {
  env.DELIVERY_TRACKER_CLIENT_ID = saved.id;
  env.DELIVERY_TRACKER_CLIENT_SECRET = saved.secret;
  env.WEBHOOK_CALLBACK_SECRET = saved.cb;
  vi.unstubAllGlobals();
});

interface StubOpts {
  /** 즉시 track lastEvent 의 status.code. null/undefined → 데이터 없음(미등록). */
  trackCode?: string | null;
  /** registerTrackWebhook 이 GraphQL 오류(쿼터·1000 초과 등) 반환. */
  registerFails?: boolean;
}

interface StubCalls {
  token: number;
  track: number;
  register: number;
  callbackUrls: string[];
}

/** globalThis.fetch 를 토큰·track·register 분기 스텁으로 교체하고 호출 카운터를 돌려준다. */
function stubFetch(opts: StubOpts): StubCalls {
  const calls: StubCalls = { token: 0, track: 0, register: 0, callbackUrls: [] };
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("oauth2/token")) {
      calls.token += 1;
      return Response.json({ access_token: "tok", expires_in: 3600 });
    }
    if (url.includes("graphql")) {
      const body = JSON.parse((init?.body as string) ?? "{}") as {
        query: string;
        variables: Record<string, unknown>;
      };
      if (body.query.includes("registerTrackWebhook")) {
        calls.register += 1;
        // 실 스키마: 단일 input 래핑(2026-06-26 스모크). callbackUrl 은 input 안에 있다.
        const input = (body.variables.input ?? {}) as Record<string, unknown>;
        calls.callbackUrls.push(String(input.callbackUrl));
        if (opts.registerFails) {
          return Response.json({ errors: [{ message: "quota", extensions: { code: "RESOURCE_EXHAUSTED" } }] });
        }
        return Response.json({ data: { registerTrackWebhook: true } });
      }
      // track 쿼리
      calls.track += 1;
      const code = opts.trackCode ?? null;
      const node = code ? { time: new Date().toISOString(), status: { code }, description: "d" } : null;
      return Response.json({ data: { track: { lastEvent: node, events: { edges: node ? [{ node }] : [] } } } });
    }
    return new Response(null, { status: 503 });
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fn);
  return calls;
}

/** POST /shipments 를 직접 worker.fetch 로 호출하고 waitUntil(등록) 완료까지 기다린다. */
async function postShipment(deviceId: string, carrier: string, trackingNo: string): Promise<number> {
  const ctx = createExecutionContext();
  const req = new Request(`${BASE}/shipments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${deviceId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ carrier, tracking_no: trackingNo }),
  });
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx); // ctx.waitUntil(등록) 완료 대기
  return res.status;
}

async function expiresAtOf(trackingNo: string): Promise<number | null> {
  const r = await env.DB.prepare("SELECT webhook_expires_at AS e FROM shipments WHERE tracking_no = ?")
    .bind(trackingNo)
    .first<{ e: number | null }>();
  return r?.e ?? null;
}

describe("webhook 등록 @ POST /shipments", () => {
  it("비미등록·active(배송출발) → registerTrackWebhook 1회·webhook_expires_at set·시크릿 경로", async () => {
    const calls = stubFetch({ trackCode: "OUT_FOR_DELIVERY" });
    expect(await postShipment("dev-A", "kr.cjlogistics", "100000000001")).toBe(201);

    expect(calls.register).toBe(1);
    const e = await expiresAtOf("100000000001");
    expect(e).not.toBeNull();
    expect(e!).toBeGreaterThan(Date.now() + 40 * HOUR); // now+48h 근처
    expect(calls.callbackUrls[0]).toContain(`/webhooks/track/${SECRET}`);
  });

  it("미등록(track 데이터 없음) → 등록 미호출·webhook_expires_at NULL", async () => {
    const calls = stubFetch({ trackCode: null });
    expect(await postShipment("dev-A", "kr.cjlogistics", "100000000002")).toBe(201);

    expect(calls.register).toBe(0);
    expect(await expiresAtOf("100000000002")).toBeNull();
  });

  it("배송완료(종료) → 등록 미호출·webhook_expires_at NULL", async () => {
    const calls = stubFetch({ trackCode: "DELIVERED" });
    expect(await postShipment("dev-A", "kr.cjlogistics", "100000000003")).toBe(201);

    expect(calls.register).toBe(0);
    expect(await expiresAtOf("100000000003")).toBeNull();
  });

  it("dedupe-hit(기존 송장·webhook_expires_at 여유) → 재등록 미호출(멱등·만료 불변)", async () => {
    const first = stubFetch({ trackCode: "OUT_FOR_DELIVERY" });
    expect(await postShipment("dev-A", "kr.cjlogistics", "100000000004")).toBe(201);
    expect(first.register).toBe(1);
    const e1 = await expiresAtOf("100000000004");
    expect(e1).not.toBeNull();

    // 같은 (carrier, tracking_no) 를 다른 device 가 등록 → dedupe-hit. 기존 만료가 여유라 재등록 안 함.
    await env.DB.prepare(
      "INSERT INTO devices (id, push_token, platform, created_at) VALUES ('dev-B', NULL, 'ios', ?)",
    )
      .bind(Date.now())
      .run();
    const second = stubFetch({ trackCode: "OUT_FOR_DELIVERY" });
    expect(await postShipment("dev-B", "kr.cjlogistics", "100000000004")).toBe(201); // 새 구독

    expect(second.register).toBe(0);
    expect(await expiresAtOf("100000000004")).toBe(e1); // 만료 불변
  });

  it("등록 GraphQL 오류 → 송장 등록은 성공(201)·webhook_expires_at NULL(폴백)", async () => {
    const calls = stubFetch({ trackCode: "OUT_FOR_DELIVERY", registerFails: true });
    expect(await postShipment("dev-A", "kr.cjlogistics", "100000000005")).toBe(201);

    expect(calls.register).toBe(1); // 시도는 함
    expect(await expiresAtOf("100000000005")).toBeNull(); // 실패 → NULL(폴백 폴링이 흡수)
  });
});
