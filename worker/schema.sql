-- unboxing D1 schema (Phase 1) — docs/ARCHITECTURE.md "데이터 모델"
-- 적용: npx wrangler d1 execute unboxing --file=./schema.sql --remote
-- DDL 변경 시 src/schema.ts(SCHEMA_STATEMENTS)도 함께 수정 — 통합 테스트가 그 배열로 테스트 D1을 구성한다.

CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,        -- 기기 식별자(=secret device_id, ADR-007)
  push_token  TEXT UNIQUE,             -- Expo push token. NULL 허용(푸시 거부/미허용도 기기 등록 — QA-001). UNIQUE는 NULL 중복 허용.
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

-- tracker.delivery access token 캐시 (ADR-013) — 단일 행
CREATE TABLE IF NOT EXISTS tracker_token (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  expires_at   INTEGER NOT NULL         -- epoch ms
);

-- Expo Push ticket 임시 보관 → receipt 확인 후 삭제 (ADR-010)
CREATE TABLE IF NOT EXISTS push_tickets (
  ticket_id   TEXT PRIMARY KEY,
  push_token  TEXT NOT NULL,            -- receipt가 무효 토큰일 때 정리용
  created_at  INTEGER NOT NULL          -- epoch ms
);

-- 등록 레이트 throttle (ADR-008 silent throttle) — IP별 슬라이딩 윈도, 단일 행/IP. cron이 만료 행 정리.
CREATE TABLE IF NOT EXISTS rate_limits (
  ip           TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,        -- epoch ms
  count        INTEGER NOT NULL
);

-- 조용시간(야간 KST 22–08) 보류 큐 (PRD 알림 정책) — 비긴급 단계 전환/안내를 보류했다가 아침 cron이 묶어 발송 후 삭제.
-- 메시지 스냅샷(title·body)을 저장한다(아침에 재구성 안 함). 송장 삭제 시 FK CASCADE로 보류분도 자동 정리.
CREATE TABLE IF NOT EXISTS notification_queue (
  id          TEXT PRIMARY KEY,
  shipment_id TEXT REFERENCES shipments(id) ON DELETE CASCADE,  -- 송장 삭제 시 보류분 정리
  push_token  TEXT NOT NULL,            -- 발송 대상(NULL 토큰은 적재 안 함)
  title       TEXT,                     -- PushMessage 스냅샷
  body        TEXT,                     -- PushMessage 스냅샷
  created_at  INTEGER                   -- epoch ms (collapse 시 최신 판별·이월 순서)
);

-- 발송한 알림 기록 (v1.1, ADR-023) — 서버측 비영속 상태 로그(SOT) + 로컬 캐시. 읽음 여부는 로컬.
-- device_id 키(token 양도 누설 회피). carrier·last4·body·stage 는 표시용 denormalize(행 자족·비-PII, 수령인 없음).
-- shipment_id 는 nullable + ON DELETE SET NULL(송장 정리돼도 기록 보존·딥링크만 무효). 보존: cron sweep(90일)+디바이스당 상한.
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL,            -- 수신 기기(GET /notifications 조회·DELETE /me 정리 키)
  shipment_id TEXT REFERENCES shipments(id) ON DELETE SET NULL,  -- 송장 정리돼도 기록 보존
  carrier     TEXT NOT NULL,            -- carrierId 원문(한글 변환은 앱 — 이슈 #9)
  last4       TEXT NOT NULL,            -- 운송장 끝 4자리(비식별)
  body        TEXT NOT NULL,            -- 상태 문구(표시용)
  stage       TEXT NOT NULL,            -- 표준 단계
  sent_at     INTEGER NOT NULL          -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_notifications_device_sent ON notifications (device_id, sent_at);

-- shipments 예고 컬럼 (docs/ARCHITECTURE.md "예고 컬럼") — 신규 적용 시 1회만 실행
ALTER TABLE shipments ADD COLUMN last_event_time INTEGER;            -- 마지막 이벤트 시각(신선도, 현재 미사용)
ALTER TABLE shipments ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0;  -- 외부 오류 백오프 카운트
ALTER TABLE shipments ADD COLUMN next_retry_at INTEGER;             -- 백오프 재시도 기준 시각
ALTER TABLE shipments ADD COLUMN status_changed_at INTEGER;         -- 현재 단계가 시작된 시각(단계 전환 시에만 갱신)
ALTER TABLE shipments ADD COLUMN webhook_expires_at INTEGER;        -- webhook 만료 epoch ms(재등록 sweep 기준). NULL=미등록→폴백 폴링(ADR-028)

-- subscriptions per-구독 음소거 (ADR-020) — 송장별 알림 끄기. DEFAULT 0 = 기존 구독 전부 알림 켜짐.
-- 운송장은 device 간 공유(N:1)라 음소거는 (device_id, shipment_id) 단위 — 타 구독자 무영향.
ALTER TABLE subscriptions ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;
