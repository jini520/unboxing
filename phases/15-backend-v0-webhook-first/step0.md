# Step 0: schema-migration

webhook-first 전환(ADR-028)의 **스키마·타입·시크릿 골격**만 놓는다. 로직은 없다.

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-028**(`webhook_expires_at` 용도: webhook 만료·재등록 sweep 기준, **nullable — 등록 성공분만 set, NULL=미등록→폴백 폴링**), ADR-029(시크릿)
- `/docs/ARCHITECTURE.md` — "Webhook (1차 신선도)" 의 schema 표(`shipments.webhook_expires_at`)·**환경변수 & 시크릿 표**(`WEBHOOK_CALLBACK_SECRET`·`WEBHOOK_SIGNING_SECRET`)
- `/docs/ENGINEERING.md` — "webhook-first phase 스키마 변경 §6"(ADD COLUMN 델타)·함정 **T8**(운영 D1 통째 재실행 ❌)
- `worker/schema.sql` — 운영 DDL(ALTER 블록은 line ~81~88: `last_event_time`·`fail_count`·`next_retry_at`·`status_changed_at`·`muted`)
- `worker/src/schema.ts` — `SCHEMA_STATEMENTS` 배열. 주석: "schema.sql 과 1:1로 동일하게 유지할 것 — DDL 변경 시 두 파일을 함께 수정한다."
- `worker/wrangler.toml` — `[vars]` 와 시크릿 주석(자격증명은 `wrangler secret put`)
- `worker/.dev.vars` — 로컬 dev 시크릿(gitignore됨)

코드를 읽고 기존 ALTER 패턴(`status_changed_at` 등)을 그대로 따른 뒤 작업하라.

## 작업

### 1. `webhook_expires_at` 컬럼 추가 (nullable, epoch ms)

기존 `status_changed_at` ALTER 바로 뒤에 **양쪽 파일에 동일하게** 추가한다:

- `worker/schema.sql`:
  ```sql
  ALTER TABLE shipments ADD COLUMN webhook_expires_at INTEGER;  -- webhook 만료 epoch ms(재등록 sweep 기준). NULL=미등록→폴백 폴링(ADR-028)
  ```
- `worker/src/schema.ts` (`SCHEMA_STATEMENTS` 배열, `status_changed_at` ALTER 다음 줄):
  ```ts
  `ALTER TABLE shipments ADD COLUMN webhook_expires_at INTEGER`,
  ```

### 2. Env 타입에 webhook 시크릿 추가

- `Env` 인터페이스를 찾아라(`grep -rn "DELIVERY_TRACKER_CLIENT_ID" worker/src worker/*.d.ts` 로 선언 위치 확인). 거기에 추가:
  - `WEBHOOK_CALLBACK_SECRET: string;` (필수 — 콜백 경로 시크릿)
  - `WEBHOOK_SIGNING_SECRET?: string;` (선택 — tracker.delivery 서명 제공 시)
- `worker/.dev.vars` 에 로컬 더미값 한 줄 추가: `WEBHOOK_CALLBACK_SECRET=<로컬-임의-문자열>` (SIGNING 은 생략 가능).

### 3. Row/직렬화 타입 반영(읽기만)

- `ShipmentRow`(또는 cron `DueRow`) 등 `shipments` 를 SELECT 해 타입 매핑하는 곳에 `webhook_expires_at: number | null` 필드를 더한다. **실제 소비(due 분기·등록)는 step1·3·5** 이므로 여기선 타입만.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `schema.sql` 과 `src/schema.ts` 가 `webhook_expires_at` 에서 **1:1** 인가(드리프트 0)?
   - `WEBHOOK_CALLBACK_SECRET` 가 `[vars]` 가 아니라 **시크릿/Env** 로 들어갔는가(로그 금지 자산, ARCHITECTURE 환경변수 표)?
   - CLAUDE.md CRITICAL(비영속·무료 티어) 위반 없는가?
3. 결과에 따라 `phases/15-backend-v0-webhook-first/index.json` 의 step0 업데이트:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(추가한 컬럼·Env 키)"`
   - 3회 시도 후 실패 → `"status": "error"`, `"error_message": "구체적 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "사유"`

## 금지사항

- 운영 D1 에 `schema.sql` 을 **통째로 재실행하지 마라**. 이유: `ADD COLUMN` 이 이미 있으면 `duplicate column` throw(ENGINEERING T8·P-3). 운영 적용은 step6 의 ALTER 델타.
- `webhook_expires_at` 을 `NOT NULL`/`DEFAULT` 로 만들지 마라. 이유: **NULL=미등록(폴백 폴링)** 의미 구분이 ADR-028 설계 핵심. 기본값을 주면 모든 행이 "등록됨"으로 오인된다.
- 등록·콜백·sweep **로직을 구현하지 마라**(step1~5 소관). 이 step 은 스키마·타입·시크릿 골격만.
- 기존 ALTER 순서·CREATE 정의를 바꾸지 마라. 이유: 적용 순서 드리프트.
- 기존 테스트를 깨뜨리지 마라.
