import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { applySchema, bearer } from "./helpers";

// 외부(tracker.delivery) 실호출은 vitest.config.mts 의 outboundService 차단으로 막힌다.
// 즉시 1회 track 은 best-effort 라 차단돼도 등록은 진행된다(미등록 상태).

const BASE = "https://example.com";
const TOKEN_A = "ExponentPushToken[AAAAAAAAAAAAAAAAAAAAAA]";
const TOKEN_B = "ExponentPushToken[BBBBBBBBBBBBBBBBBBBBBB]";

async function registerDevice(deviceId: string, token: string): Promise<void> {
  const res = await SELF.fetch(`${BASE}/devices`, {
    method: "POST",
    headers: { ...bearer(deviceId), "Content-Type": "application/json" },
    body: JSON.stringify({ push_token: token, platform: "ios" }),
  });
  expect(res.status).toBe(200);
}

function createShipment(deviceId: string, carrier: string, trackingNo: string): Promise<Response> {
  return SELF.fetch(`${BASE}/shipments`, {
    method: "POST",
    headers: { ...bearer(deviceId), "Content-Type": "application/json" },
    body: JSON.stringify({ carrier, tracking_no: trackingNo }),
  });
}

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first<{ c: number }>();
  return row?.c ?? 0;
}

describe("HTTP API — shipments", () => {
  beforeEach(async () => {
    await applySchema(env.DB);
  });

  it("POST /devices upsert → 200 (1행 유지)", async () => {
    const res = await SELF.fetch(`${BASE}/devices`, {
      method: "POST",
      headers: { ...bearer("dev-A"), "Content-Type": "application/json" },
      body: JSON.stringify({ push_token: TOKEN_A, platform: "ios" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ device_id: "dev-A" });

    // 같은 device_id 재등록(새 토큰) → 여전히 1행.
    const res2 = await SELF.fetch(`${BASE}/devices`, {
      method: "POST",
      headers: { ...bearer("dev-A"), "Content-Type": "application/json" },
      body: JSON.stringify({ push_token: TOKEN_B, platform: "android" }),
    });
    expect(res2.status).toBe(200);
    expect(await count("devices")).toBe(1);
  });

  it("POST /shipments 신규 201 · 동일 device 재등록 200(멱등, 1행)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    expect((await createShipment("dev-A", "kr.cjlogistics", "123456789012")).status).toBe(201);
    expect((await createShipment("dev-A", "kr.cjlogistics", "123456789012")).status).toBe(200);
    expect(await count("shipments")).toBe(1);
    expect(await count("subscriptions")).toBe(1);
  });

  it("두 device가 같은 송장 등록 → shipments 1행(dedupe), 구독 2개", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerDevice("dev-B", TOKEN_B);
    expect((await createShipment("dev-A", "kr.cjlogistics", "123456789012")).status).toBe(201);
    expect((await createShipment("dev-B", "kr.cjlogistics", "123456789012")).status).toBe(201);
    expect(await count("shipments")).toBe(1);
    expect(await count("subscriptions")).toBe(2);
  });

  it("GET /shipments는 내 송장만 반환", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerDevice("dev-B", TOKEN_B);
    await createShipment("dev-A", "kr.cjlogistics", "111111111111");
    await createShipment("dev-B", "kr.epost", "222222222222");

    const res = await SELF.fetch(`${BASE}/shipments`, { headers: bearer("dev-A") });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shipments: { tracking_no: string }[] };
    expect(body.shipments).toHaveLength(1);
    expect(body.shipments[0].tracking_no).toBe("111111111111");
  });

  it("타 device가 GET/DELETE /:id 호출 → 404(인가)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerDevice("dev-B", TOKEN_B);
    const created = await createShipment("dev-A", "kr.cjlogistics", "123456789012");
    const { shipment } = (await created.json()) as { shipment: { id: string } };

    const get = await SELF.fetch(`${BASE}/shipments/${shipment.id}`, { headers: bearer("dev-B") });
    expect(get.status).toBe(404);
    const del = await SELF.fetch(`${BASE}/shipments/${shipment.id}`, {
      method: "DELETE",
      headers: bearer("dev-B"),
    });
    expect(del.status).toBe(404);
    // 인가 실패가 데이터를 건드리지 않았다.
    expect(await count("shipments")).toBe(1);
    expect(await count("subscriptions")).toBe(1);
  });

  it("DELETE /:id 마지막 구독 → shipment 삭제(orphan 정리)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const created = await createShipment("dev-A", "kr.cjlogistics", "123456789012");
    const { shipment } = (await created.json()) as { shipment: { id: string } };

    const del = await SELF.fetch(`${BASE}/shipments/${shipment.id}`, {
      method: "DELETE",
      headers: bearer("dev-A"),
    });
    expect(del.status).toBe(204);
    expect(await count("shipments")).toBe(0);
    expect(await count("subscriptions")).toBe(0);
  });

  it("DELETE /me → device·구독·orphan 송장 제거", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await createShipment("dev-A", "kr.cjlogistics", "123456789012");

    const res = await SELF.fetch(`${BASE}/me`, { method: "DELETE", headers: bearer("dev-A") });
    expect(res.status).toBe(204);
    expect(await count("devices")).toBe(0);
    expect(await count("subscriptions")).toBe(0);
    expect(await count("shipments")).toBe(0);
  });

  it("활성 상한 초과 → 429", async () => {
    await registerDevice("dev-A", TOKEN_A);
    // 활성 송장 100개를 직접 시드(HTTP 100회 왕복 회피).
    const now = Date.now();
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 100; i++) {
      const sid = `ship-${i}`;
      const tno = String(100000000000 + i);
      stmts.push(
        env.DB.prepare(
          "INSERT INTO shipments (id, carrier, tracking_no, active, created_at) VALUES (?, 'kr.cjlogistics', ?, 1, ?)",
        ).bind(sid, tno, now),
      );
      stmts.push(
        env.DB.prepare(
          "INSERT INTO subscriptions (device_id, shipment_id, created_at) VALUES ('dev-A', ?, ?)",
        ).bind(sid, now),
      );
    }
    await env.DB.batch(stmts);
    expect(await count("subscriptions")).toBe(100);

    const res = await createShipment("dev-A", "kr.cjlogistics", "999999999999");
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe("RATE_LIMITED");
  });

  it("Bearer 없음 → 401", async () => {
    const res = await SELF.fetch(`${BASE}/shipments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carrier: "kr.cjlogistics", tracking_no: "123456789012" }),
    });
    expect(res.status).toBe(401);
  });
});
