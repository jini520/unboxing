import { SCHEMA_STATEMENTS } from "../src/schema";

/** DROP 순서 = FK 역순(참조하는 쪽 먼저). */
const TABLES = ["subscriptions", "push_tickets", "notification_queue", "notifications", "tracker_token", "shipments", "devices"];

/**
 * 테스트용 D1을 깨끗이 초기화한다 — 기존 테이블을 제거하고 SCHEMA_STATEMENTS 를 재적용.
 * (ALTER TABLE 가 비멱등이라 매 테스트 새 슬레이트가 필요하다. workerd 런타임이라 schema.sql 파일을 못 읽으므로
 *  단일 출처 src/schema.ts 의 배열을 그대로 사용한다.)
 */
export async function applySchema(db: D1Database): Promise<void> {
  for (const t of TABLES) {
    await db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
  }
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.prepare(stmt).run();
  }
}

/** Authorization: Bearer <device_id> 헤더. */
export function bearer(deviceId: string): HeadersInit {
  return { Authorization: `Bearer ${deviceId}` };
}
