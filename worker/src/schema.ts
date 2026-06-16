/**
 * D1 DDL을 TS에서도 사용할 수 있는 단일 출처.
 * 통합 테스트(step6·step7)는 workerd 런타임에서 실행되어 schema.sql 파일을 읽을 수 없으므로
 * 이 배열로 테스트 D1을 구성한다.
 *
 * schema.sql 과 1:1로 동일하게 유지할 것 — DDL 변경 시 두 파일을 함께 수정한다.
 * (배열 순서 = 적용 순서. shipments ALTER 는 shipments CREATE 뒤에 와야 한다.)
 */
export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,
  push_token  TEXT UNIQUE,
  platform    TEXT NOT NULL,
  created_at  INTEGER NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS shipments (
  id                     TEXT PRIMARY KEY,
  carrier                TEXT NOT NULL,
  tracking_no            TEXT NOT NULL,
  last_normalized_status TEXT,
  last_polled_at         INTEGER,
  active                 INTEGER NOT NULL DEFAULT 1,
  created_at             INTEGER NOT NULL,
  UNIQUE (carrier, tracking_no)
)`,
  `CREATE TABLE IF NOT EXISTS subscriptions (
  device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (device_id, shipment_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_shipments_due ON shipments (active, last_polled_at)`,
  `CREATE TABLE IF NOT EXISTS tracker_token (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  expires_at   INTEGER NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS push_tickets (
  ticket_id   TEXT PRIMARY KEY,
  push_token  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
  ip           TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
)`,
  `ALTER TABLE shipments ADD COLUMN last_event_time INTEGER`,
  `ALTER TABLE shipments ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE shipments ADD COLUMN next_retry_at INTEGER`,
];
