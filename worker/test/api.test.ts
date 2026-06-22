import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { applySchema } from "./helpers";

describe("HTTP API", () => {
  it("GET /health → 200 { ok: true }", async () => {
    const res = await SELF.fetch("https://example.com/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("알 수 없는 경로 → 404", async () => {
    const res = await SELF.fetch("https://example.com/nope");
    expect(res.status).toBe(404);
  });
});

describe("D1 바인딩", () => {
  it("테이블 생성·삽입·조회가 동작한다", async () => {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, name TEXT)",
    );
    await env.DB.prepare("INSERT INTO t (name) VALUES (?)").bind("unboxing").run();
    const row = await env.DB.prepare("SELECT name FROM t WHERE id = 1").first<{
      name: string;
    }>();
    expect(row?.name).toBe("unboxing");
  });
});

// v1.1 알림 기록 테이블 (step0, ADR-023). 이 step 은 스키마만 추가 — 로깅/조회는 다음 step.
describe("notifications 테이블 (v1.1 스키마)", () => {
  beforeEach(async () => {
    await applySchema(env.DB);
  });

  it("모든 컬럼 INSERT → SELECT 왕복", async () => {
    // FK(shipment_id → shipments.id) 충족 위해 부모 송장 먼저.
    await env.DB.prepare(
      "INSERT INTO shipments (id, carrier, tracking_no, active, created_at) VALUES (?, ?, ?, 1, ?)",
    )
      .bind("ship-1", "kr.cjlogistics", "5220934513601360", 1700000000000)
      .run();
    await env.DB.prepare(
      `INSERT INTO notifications (id, device_id, shipment_id, carrier, last4, body, stage, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind("n1", "dev-A", "ship-1", "kr.cjlogistics", "1360", "배송 완료 ✓", "배송완료", 1700000000000)
      .run();

    const row = await env.DB.prepare("SELECT * FROM notifications WHERE id = ?")
      .bind("n1")
      .first<{
        id: string;
        device_id: string;
        shipment_id: string | null;
        carrier: string;
        last4: string;
        body: string;
        stage: string;
        sent_at: number;
      }>();

    expect(row).toEqual({
      id: "n1",
      device_id: "dev-A",
      shipment_id: "ship-1",
      carrier: "kr.cjlogistics",
      last4: "1360",
      body: "배송 완료 ✓",
      stage: "배송완료",
      sent_at: 1700000000000,
    });
  });

  it("shipment_id NULL 허용", async () => {
    await env.DB.prepare(
      `INSERT INTO notifications (id, device_id, shipment_id, carrier, last4, body, stage, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind("n2", "dev-A", null, "kr.epost", "3530", "오늘 도착 예정", "배송출발", 1700000001000)
      .run();

    const row = await env.DB.prepare("SELECT shipment_id FROM notifications WHERE id = ?")
      .bind("n2")
      .first<{ shipment_id: string | null }>();
    expect(row?.shipment_id).toBeNull();
  });
});
