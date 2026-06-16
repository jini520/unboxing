# Step 0: schema-evolution

worker 백엔드 구현의 토대. D1 스키마를 이후 step(토큰 캐시·푸시 receipt·백오프)에 필요한 형태로 진화시키고, 테스트에서 스키마를 적용할 수 있는 단일 출처를 만든다. **비즈니스 로직은 작성하지 않는다.**

## 읽어야 할 파일

먼저 아래를 읽고 데이터 모델·스키마 진화 규칙·환경변수 인벤토리를 파악하라:

- `/docs/ARCHITECTURE.md` — "데이터 모델 (Phase 1, D1)", "예고 컬럼", "스키마 진화 / 마이그레이션", "환경변수 & 시크릿 (단일 출처)"
- `/docs/ADR.md` — ADR-010(push receipt), ADR-013(tracker 토큰 캐시)
- `/Users/jinni/Developments/unboxing/worker/schema.sql` — 현재 스키마 (devices·shipments·subscriptions)
- `/Users/jinni/Developments/unboxing/worker/src/index.ts` — 현재 `Env` 인터페이스
- `/Users/jinni/Developments/unboxing/worker/test/api.test.ts` — D1 바인딩 테스트 방식

## 작업

### 1. `worker/schema.sql` 진화 (idempotent)

기존 3개 테이블은 유지하고, 아래를 **`IF NOT EXISTS` / `ADD COLUMN`** 으로 추가한다. SQLite `ALTER TABLE ADD COLUMN` 은 nullable 또는 `NOT NULL DEFAULT` 만 허용한다.

신규 테이블:

- `tracker_token` — tracker.delivery access token 캐시 (ADR-013). 단일 행. 예: `id INTEGER PRIMARY KEY CHECK (id = 1)`, `access_token TEXT NOT NULL`, `expires_at INTEGER NOT NULL`(epoch ms).
- `push_tickets` — Expo Push ticket 임시 보관 → receipt 확인 후 삭제 (ADR-010). 예: `ticket_id TEXT PRIMARY KEY`, `push_token TEXT NOT NULL`(receipt가 무효 토큰일 때 정리용), `created_at INTEGER NOT NULL`.

`shipments` 예고 컬럼 추가:

- `last_event_time INTEGER` — 마지막 이벤트 시각(신선도·동일 단계 내 새 이벤트 판별)
- `fail_count INTEGER NOT NULL DEFAULT 0` — 외부 오류 백오프 카운트
- `next_retry_at INTEGER` — 백오프 재시도 기준 시각

### 2. `worker/src/schema.ts` 신설 (테스트용 단일 출처)

통합 테스트(step6·step7)는 workerd 런타임에서 실행되어 `schema.sql` 파일을 읽을 수 없다. DDL을 TS에서도 쓸 수 있게 한다:

```ts
/** schema.sql 과 1:1로 동일하게 유지할 것 — 통합 테스트가 이 배열로 테스트 D1을 구성한다. */
export const SCHEMA_STATEMENTS: string[] = [ /* CREATE TABLE ... 각 문장 */ ];
```

`schema.sql` 상단에 "DDL 변경 시 `src/schema.ts` 도 함께 수정" 주석을 남긴다. 두 파일의 DDL은 동일해야 한다.

### 3. `worker/src/index.ts` `Env` 확장

환경변수 인벤토리(ARCHITECTURE)에 맞춰 **optional** 필드만 추가한다(미구현 기능이라 선택):

```ts
export interface Env {
  DB: D1Database;
  DELIVERY_TRACKER_CLIENT_ID: string;
  DELIVERY_TRACKER_CLIENT_SECRET: string;
  EXPO_ACCESS_TOKEN?: string;     // Expo Push 서버 발송 인증 (ADR-010, 선택·권장)
  DEMO_TRACKING_NUMBER?: string;  // 심사용 데모 분기 (ADR-019, 선택)
}
```

`/health` 라우트·`scheduled` 스텁은 그대로 둔다(이후 step에서 채운다).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `schema.sql` 의 DDL과 `src/schema.ts` 의 `SCHEMA_STATEMENTS` 가 완전히 동일한가?
   - 모든 신규 DDL이 idempotent(`IF NOT EXISTS` / `ADD COLUMN`)인가?
   - `Env` 가 ARCHITECTURE "환경변수 & 시크릿" 표와 일치하는가?
3. 결과에 따라 `phases/worker-backend/index.json` 의 step 0 을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 3회 시도 후 실패 → `"status": "error"`, `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason"` 후 중단

## 금지사항

- 기존 테이블(devices·shipments·subscriptions)의 컬럼을 삭제·타입 변경하지 마라. 이유: SQLite는 파괴적 변경 시 테이블 재생성이 필요하고, 운영 DB에 이미 적용된 스키마를 깬다.
- 비즈니스 로직(정규화·폴링·푸시)을 작성하지 마라. 이유: 이 step은 스키마/타입 토대만 다룬다. 레이어 혼합 금지.
- `Env` 에 secret 값을 하드코딩하거나 기본값을 박지 마라. 이유: 시크릿은 `wrangler secret`/`.dev.vars` 에서 주입된다.
- 기존 테스트를 깨뜨리지 마라.
