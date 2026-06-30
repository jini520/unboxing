# Step 0: notifications-schema — 알림 기록 테이블·인덱스 추가

v1.1 알림 기록(받은 푸시 목록)의 **서버측 단일 신규 표면**인 `notifications` 테이블을 추가한다. 이 step은 **스키마 DDL만** 추가하고 동작(로깅·조회)은 다음 step에서 붙인다. ADR-023: 서버가 발송한 알림을 비영속 상태 로그로 기록(수령인 없는 비-PII)하고 앱이 받아 표시한다. 신규 테이블 1개뿐이라 파괴적 변경·RENAME·ADD COLUMN 함정이 없다.

## 읽어야 할 파일

먼저 아래를 읽고 데이터 모델·DDL 단일출처 2개의 동기화 규칙·v1.1 알림 설계를 파악하라:

- `/docs/ARCHITECTURE.md` — "데이터 모델"의 `notifications` 항목(컬럼·FK·인덱스·보존), "v1.1 마이그레이션"(신규 테이블만·자동 생성), "스키마 진화 / 마이그레이션"
- `/docs/ADR.md` — ADR-023(알림 기록 = 서버측 비영속 상태 로그 SOT + 로컬 캐시, 읽음은 로컬), ADR-005(개인정보 비영속)
- `/docs/ENGINEERING.md` — A절 P-2(RENAME 전파)·P-3(로컬 D1 드리프트), B절(D1 마이그레이션 절차). **이번 변경은 신규 테이블 `IF NOT EXISTS`라 P-2/P-3 위험 없음**
- `worker/schema.sql` 와 `worker/src/schema.ts`(`SCHEMA_STATEMENTS`) — **DDL 단일 출처 2개. 항상 1:1로 함께 수정한다.** `notification_queue` 정의를 그대로 본받는다(같은 멱등 패턴).
- `worker/src/index.ts` — 기존 `*Row` 타입 정의 패턴(`ShipmentRow` 등)

## 작업

### 1. `notifications` 테이블 + 인덱스 — `schema.sql` 와 `schema.ts` **둘 다**
기존 테이블 정의들 뒤에 멱등 DDL 추가(`notification_queue` 와 동일한 위치/스타일):

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL,
  shipment_id TEXT REFERENCES shipments(id) ON DELETE SET NULL,
  carrier     TEXT NOT NULL,
  last4       TEXT NOT NULL,
  body        TEXT NOT NULL,
  stage       TEXT NOT NULL,
  sent_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_device_sent ON notifications(device_id, sent_at);
```

- `device_id`: **수신 기기**(이 키로 `GET /notifications` 조회·`DELETE /me` 정리 — token 양도 누설 회피).
- `shipment_id`: **nullable**, `ON DELETE SET NULL`(송장 정리돼도 기록 보존·딥링크만 무효).
- `carrier`·`last4`·`body`·`stage`: 표시용 denormalize(행 자족·비-PII). `carrier` 는 **carrierId 원문**(한글 변환은 앱).
- `sent_at`: epoch ms.
- `schema.ts SCHEMA_STATEMENTS` 배열에도 같은 두 문장을 1:1로 추가(문자열 단위).

### 2. `NotificationRow` 타입 — `index.ts`
- 기존 `ShipmentRow` 패턴을 따라 행 타입을 선언(다음 step에서 INSERT/SELECT에 사용):
  - `interface NotificationRow { id: string; device_id: string; shipment_id: string | null; carrier: string; last4: string; body: string; stage: string; sent_at: number }`

### 3. ENGINEERING B절 적용 절차 한 줄
- `/docs/ENGINEERING.md` B절에 v1.1 적용/확인을 추가: 원격 D1 은 `schema.sql` 재실행(`npx wrangler d1 execute unboxing --remote --file=schema.sql`)으로 `notifications` 자동 생성(멱등), `npx wrangler d1 execute unboxing --command "PRAGMA table_info(notifications)"` 로 컬럼 확인. 로컬도 동일(`--local`).

## 테스트 (TDD)
- 워커 통합(`cloudflare:test` env·D1): 스키마 적용 후 `notifications` 테이블에 **1행 INSERT → SELECT 로 모든 컬럼 왕복** 확인(컬럼·타입·인덱스 존재 확인). `shipment_id` NULL 허용 확인.
- 기존 워커 테스트가 새 DDL로 깨지지 않는지(스키마 부트스트랩 경로).

## 마이그레이션 (원격 D1 — 사람이 배포 시)
```bash
# worker/ 에서. 멱등(IF NOT EXISTS)이라 재실행 안전.
npx wrangler d1 execute unboxing --remote --file=schema.sql
npx wrangler d1 execute unboxing --remote --command "PRAGMA table_info(notifications)"
```

## Acceptance Criteria
```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차
1. 위 AC 실행.
2. 아키텍처 체크리스트:
   - `schema.sql` ↔ `schema.ts` **1:1 동기화**(두 문장 모두 양쪽에).
   - 신규 테이블만 추가(기존 테이블 재생성·RENAME·ADD COLUMN 없음).
   - ADR 스택 이탈 없음 · CLAUDE.md CRITICAL(비영속·$0) 위반 없음 · 기존 테스트 무파손.
3. `phases/07-backend-v0-v11-notifications/index.json` step 0 업데이트(성공→completed+summary / 3회 실패→error / 외부개입→blocked).

## 금지사항
- `schema.sql` 와 `schema.ts` 중 한쪽만 고치지 마라. 이유: DDL 단일출처가 둘이라 드리프트 시 로컬/원격·테스트 환경이 갈린다(ENGINEERING P-3).
- 기존 테이블을 재생성(RENAME/DROP)하지 마라. 이유: 신규 테이블만 필요하며 재생성은 P-2 FK 전파 함정을 부른다.
- `notifications` 에 수령인 이름·주소·연락처 컬럼을 넣지 마라. 이유: 비영속 원칙(ADR-005). 끝4자리·상태·택배사 denormalize 만 허용.
- `carrier` 에 한글명을 저장하지 마라. 이유: 서버는 carrierId 저장, 한글 변환은 앱(이슈 #9 원칙) — 다음 step과 일관.
- 기존 테스트를 깨뜨리지 마라.
