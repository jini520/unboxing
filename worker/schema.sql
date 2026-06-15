-- unboxing D1 schema (Phase 1) — docs/design.md 데이터 모델
-- 적용: npx wrangler d1 execute unboxing --file=./schema.sql --remote

CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,        -- 기기 식별자
  push_token  TEXT NOT NULL UNIQUE,    -- Expo push token
  platform    TEXT NOT NULL,           -- ios | android
  created_at  INTEGER NOT NULL         -- epoch ms
);

CREATE TABLE IF NOT EXISTS shipments (
  id                     TEXT PRIMARY KEY,
  carrier                TEXT NOT NULL,  -- 택배사 코드
  tracking_no            TEXT NOT NULL,  -- 운송장 번호
  last_normalized_status TEXT,           -- 표준 단계: 등록/집화/이동중/배송출발/배송완료/예외/기타
  last_polled_at         INTEGER,        -- epoch ms (due 계산 기준)
  active                 INTEGER NOT NULL DEFAULT 1,  -- 1 활성 / 0 비활성
  created_at             INTEGER NOT NULL,
  UNIQUE (carrier, tracking_no)          -- dedupe: 동일 송장은 1행만
);

CREATE TABLE IF NOT EXISTS subscriptions (
  device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  shipment_id TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (device_id, shipment_id)
);

-- due 폴링 조회용
CREATE INDEX IF NOT EXISTS idx_shipments_due ON shipments (active, last_polled_at);
