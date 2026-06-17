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

  it("GET /shipments 응답에 status_changed_at 포함(신규는 created_at 으로 초기화)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    // 즉시 1회 track 은 outbound 차단 → 미저장. status_changed_at 은 INSERT 시 created_at 으로 초기화된다.
    expect((await createShipment("dev-A", "kr.cjlogistics", "123456789012")).status).toBe(201);

    const res = await SELF.fetch(`${BASE}/shipments`, { headers: bearer("dev-A") });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      shipments: { status_changed_at: number; created_at: number }[];
    };
    expect(body.shipments).toHaveLength(1);
    const s = body.shipments[0];
    expect(typeof s.status_changed_at).toBe("number");
    expect(s.status_changed_at).toBe(s.created_at); // 단계 변동 전 = 등록 시각
  });

  it("status_changed_at NULL 행(backfill 전)은 created_at 으로 폴백", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const created = Date.now();
    // status_changed_at 컬럼을 지정하지 않아 NULL(backfill 전 기존 행 모사).
    await env.DB.prepare(
      "INSERT INTO shipments (id, carrier, tracking_no, active, created_at) VALUES ('s1','kr.cjlogistics','999999999999',1,?)",
    )
      .bind(created)
      .run();
    await env.DB.prepare(
      "INSERT INTO subscriptions (device_id, shipment_id, created_at) VALUES ('dev-A','s1',?)",
    )
      .bind(created)
      .run();

    const res = await SELF.fetch(`${BASE}/shipments`, { headers: bearer("dev-A") });
    const body = (await res.json()) as { shipments: { id: string; status_changed_at: number }[] };
    const s = body.shipments.find((x) => x.id === "s1")!;
    expect(s.status_changed_at).toBe(created); // NULL → created_at 폴백
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

  // ── GET /shipments/:id — recipient 패스스루(화면 전용·미저장, ADR-005, step2) ──

  it("GET /:id — recipient 키 포함, 자격증명 없음(tryTrack=null) → recipient null", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const created = await createShipment("dev-A", "kr.cjlogistics", "123456789012");
    const { shipment } = (await created.json()) as { shipment: { id: string } };

    const res = await SELF.fetch(`${BASE}/shipments/${shipment.id}`, { headers: bearer("dev-A") });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recipient: unknown };
    // 테스트 env 는 자격증명이 비어 tryTrack=null → recipient null(앱이 섹션 숨김). 키는 항상 존재.
    expect("recipient" in body).toBe(true);
    expect(body.recipient).toBeNull();

    // 미저장(ADR-005): shipments 스키마에 recipient/sender 컬럼이 없다(스키마 불변).
    const cols = await env.DB.prepare("PRAGMA table_info(shipments)").all<{ name: string }>();
    const names = cols.results.map((c) => c.name);
    expect(names).not.toContain("recipient");
    expect(names).not.toContain("sender");
  });

  it("GET /:id — 데모 recipient 패스스루는 D1 어디에도 저장되지 않는다(ADR-005 CRITICAL)", async () => {
    // 데모 경로는 외부 호출 없이 캔드 recipient 를 반환한다(network 차단 무관). creds 가드를 통과시켜
    // tryTrack 이 track()까지 도달하게 한 뒤(데모 분기는 graphql 호출 없이 단락) finally 로 복원한다.
    const saved = {
      id: env.DELIVERY_TRACKER_CLIENT_ID,
      secret: env.DELIVERY_TRACKER_CLIENT_SECRET,
      demo: env.DEMO_TRACKING_NUMBER,
    };
    try {
      env.DELIVERY_TRACKER_CLIENT_ID = "x";
      env.DELIVERY_TRACKER_CLIENT_SECRET = "y";
      env.DEMO_TRACKING_NUMBER = "00000000000000";

      await registerDevice("dev-A", TOKEN_A);
      const created = await createShipment("dev-A", "kr.cjlogistics", "00000000000000");
      const { shipment } = (await created.json()) as { shipment: { id: string } };

      const res = await SELF.fetch(`${BASE}/shipments/${shipment.id}`, { headers: bearer("dev-A") });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { recipient: { name: string; regionName: string } | null };
      expect(body.recipient).toEqual({ name: "홍**", regionName: "서울 강남" });

      // 패스스루 응답 뒤에도 어떤 행에도 수령인 이름이 저장되지 않는다(저장 경로 부재).
      const ships = await env.DB.prepare("SELECT * FROM shipments").all();
      expect(JSON.stringify(ships.results)).not.toContain("홍**");
      const subs = await env.DB.prepare("SELECT * FROM subscriptions").all();
      expect(JSON.stringify(subs.results)).not.toContain("홍**");
    } finally {
      env.DELIVERY_TRACKER_CLIENT_ID = saved.id;
      env.DELIVERY_TRACKER_CLIENT_SECRET = saved.secret;
      env.DEMO_TRACKING_NUMBER = saved.demo;
    }
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

  it("IP 등록 레이트 초과 → 429 (ADR-008 throttle, device_id 순환 방어)", async () => {
    // 같은 IP에서 윈도(10분) 내 60회는 허용, 61회째 throttle (IP 기준 카운트).
    const ip = "203.0.113.7";
    const headers = { ...bearer("dev-A"), "Content-Type": "application/json", "cf-connecting-ip": ip };
    const body = JSON.stringify({ push_token: TOKEN_A, platform: "ios" }); // 멱등 upsert (UNIQUE 충돌 회피)
    for (let i = 0; i < 60; i++) {
      const res = await SELF.fetch(`${BASE}/devices`, { method: "POST", headers, body });
      expect(res.status).toBe(200);
    }
    const over = await SELF.fetch(`${BASE}/devices`, { method: "POST", headers, body });
    expect(over.status).toBe(429);
  });

  // ── PATCH /shipments/:id — 음소거 토글(ADR-020, step1) ──

  async function createAndGetId(deviceId: string): Promise<string> {
    const created = await createShipment(deviceId, "kr.cjlogistics", "123456789012");
    const { shipment } = (await created.json()) as { shipment: { id: string } };
    return shipment.id;
  }

  function patchMute(deviceId: string, id: string, body: unknown): Promise<Response> {
    return SELF.fetch(`${BASE}/shipments/${id}`, {
      method: "PATCH",
      headers: { ...bearer(deviceId), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function mutedOf(deviceId: string, id: string): Promise<boolean> {
    const res = await SELF.fetch(`${BASE}/shipments`, { headers: bearer(deviceId) });
    const body = (await res.json()) as { shipments: { id: string; muted: boolean }[] };
    return body.shipments.find((s) => s.id === id)!.muted;
  }

  it("PATCH /:id {muted:true} → 204, 이후 목록 muted=true; {muted:false} → false", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const id = await createAndGetId("dev-A");
    expect(await mutedOf("dev-A", id)).toBe(false); // 기본 음소거 안 됨

    expect((await patchMute("dev-A", id, { muted: true })).status).toBe(204);
    expect(await mutedOf("dev-A", id)).toBe(true);

    expect((await patchMute("dev-A", id, { muted: false })).status).toBe(204);
    expect(await mutedOf("dev-A", id)).toBe(false);
  });

  it("PATCH 미소유 id → 404 (타 구독자 보호)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerDevice("dev-B", TOKEN_B);
    const id = await createAndGetId("dev-A");
    expect((await patchMute("dev-B", id, { muted: true })).status).toBe(404);
    // A 의 음소거 상태는 안 바뀐다.
    expect(await mutedOf("dev-A", id)).toBe(false);
  });

  it("PATCH 잘못된 바디({}·{muted:'x'}) → 400", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const id = await createAndGetId("dev-A");
    expect((await patchMute("dev-A", id, {})).status).toBe(400);
    expect((await patchMute("dev-A", id, { muted: "x" })).status).toBe(400);
  });

  it("PATCH {muted:true} 이중 호출 멱등(204·여전히 muted=1)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const id = await createAndGetId("dev-A");
    expect((await patchMute("dev-A", id, { muted: true })).status).toBe(204);
    expect((await patchMute("dev-A", id, { muted: true })).status).toBe(204);
    expect(await mutedOf("dev-A", id)).toBe(true);
    expect(await count("subscriptions")).toBe(1); // 새 행 안 생김
  });

  it("한 송장 두 구독자 — 한쪽 음소거가 타 구독자에 무영향", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerDevice("dev-B", TOKEN_B);
    const id = await createAndGetId("dev-A");
    expect((await createShipment("dev-B", "kr.cjlogistics", "123456789012")).status).toBe(201); // dedupe 동일 송장
    expect((await patchMute("dev-A", id, { muted: true })).status).toBe(204);
    expect(await mutedOf("dev-A", id)).toBe(true);
    expect(await mutedOf("dev-B", id)).toBe(false); // B 는 그대로 켜짐
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
