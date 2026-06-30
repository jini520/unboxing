# Step 28: status-changed-at — 상태 변경 시각 저장·노출

앱 목록의 "업데이트" 시각을 **API 호출 시각이 아니라 상태(단계)가 실제로 바뀐 시각**으로 보여주기 위한 백엔드 작업이다. 현재 앱 카드는 `createdAt`(등록 시각)을 쓰고 있고, 서버에는 단계 전환 시각을 담는 컬럼이 없다(`last_event_time` 컬럼은 선언만 되어 있고 어디서도 기록하지 않음 — 이번 작업에서 쓰지 말 것).

## 읽어야 할 파일

먼저 아래를 읽고 데이터 모델·cron 전환 로직·HTTP 직렬화 흐름을 파악하라:

- `/docs/ARCHITECTURE.md` — "데이터 모델", "HTTP API 계약", "상태 정규화 & 알림", "동시성 & 원자성", "스키마 진화 / 마이그레이션"
- `/docs/ADR.md` — ADR-009(정규화), ADR-012(선점 갱신·KST), ADR-014(서버 SOT)
- `/docs/ENGINEERING.md` — 마이그레이션 함정(P-2 RENAME 전파). 이번 변경은 단순 ADD COLUMN이라 RENAME 이슈 없음.
- `worker/schema.sql` 와 `worker/src/schema.ts` — **DDL 단일 출처 2개. 항상 1:1로 함께 수정한다.**
- `worker/src/cron.ts` — `pollOne`, `casStage`, 배송완료 CAS 분기(`next === "배송완료"`), `onPollError`
- `worker/src/index.ts` — `SHIPMENT_FIELDS`, `shipmentCols`, `serializeShipment`, `ShipmentRow`, `handleCreateShipment`(즉시 상태 저장 지점 — 신규 INSERT vs 기존 재구독 200 분기)
- `worker/test/` 하위 cron·shipments·api 테스트, `worker/test/e2e/` 시나리오

## 작업

### 1. 스키마: `shipments.status_changed_at INTEGER`
- `worker/schema.sql` 와 `worker/src/schema.ts`(`SCHEMA_STATEMENTS`) **둘 다**에 기존 `ALTER TABLE shipments ADD COLUMN ...` 들 **뒤에** 추가:
  - `ALTER TABLE shipments ADD COLUMN status_changed_at INTEGER`
- 의미: **현재 단계가 시작된 시각(epoch ms)**. 단계가 바뀔 때만 갱신한다(폴링 때마다 갱신 ❌).

### 2. 등록 시 초기값 — `handleCreateShipment`(index.ts)
- **신규 shipment INSERT 시에만** `status_changed_at = created_at` 으로 초기화한다(아직 단계 변동이 없으니 등록 시각이 곧 현재 단계 시작 시각).
- **기존 운송장에 재구독하는 200(멱등) 경로에서는 `status_changed_at` 을 건드리지 마라.** 이유: 다른 사용자가 이미 추적 중이던 송장의 단계 시작 시각을 새 구독자 등록 때문에 덮어쓰면 안 됨(dedupe 공유 행).
- 등록 직후 즉시 track으로 **비종료 단계를 저장**하는 기존 분기에서 단계를 저장할 때, `status_changed_at` 도 그 이벤트 시각(있으면 `lastEvent.time` 파싱 ms, 없으면 now)으로 함께 갱신한다.

### 3. cron 전환 시 기록 — `casStage` / 배송완료 CAS (cron.ts)
- `casStage(env, id, prev, next)` 가 전환을 **차지(영향행=1)** 할 때, 같은 UPDATE 문에서 `status_changed_at` 도 함께 설정한다. 전환의 이벤트 시각을 인자로 받도록 시그니처를 확장하라:
  - 예: `casStage(env, id, prev, next, changedAt: number)` — `UPDATE shipments SET last_normalized_status = ?, status_changed_at = ? WHERE id = ? AND last_normalized_status IS ?`
  - `changedAt` 값: 전환을 일으킨 이벤트 시각(`ev?.time` 을 `Date.parse` → ms). 파싱 불가/누락/`NaN` 이면 `deps.now`.
- 배송완료 CAS 분기(`UPDATE ... SET last_normalized_status = ?, active = 0 ...`)도 동일하게 `status_changed_at = ?` 를 함께 설정한다. `AVAILABLE_FOR_PICKUP`(→배송완료)도 이 경로를 타므로 자동 반영된다.
- **금지**: `last_polled_at` 선점 갱신이나 `onPollError`(백오프 원복)에서 `status_changed_at` 을 건드리지 말 것. 단계가 안 바뀌면 값이 그대로여야 한다.

### 4. HTTP 노출 — index.ts
- `SHIPMENT_FIELDS` 에 `status_changed_at` 추가(목록/상세 SELECT에 자동 포함). `ShipmentRow` 타입에도 `status_changed_at: number | null` 추가.
- `serializeShipment` 응답에 `status_changed_at: row.status_changed_at ?? row.created_at` 추가(컬럼이 비면 등록 시각으로 폴백 — **기존 행 backfill 안전**).

### 5. 문서 갱신 (변경되는 서버 사양 반영)
- `/docs/ARCHITECTURE.md` "데이터 모델" `shipments` 항목에 `status_changed_at`(현재 단계 시작 시각) 추가. "예고 컬럼" 표의 `last_event_time` 행 옆/아래에 `status_changed_at` 한 줄 추가하고 의미가 다름을 명시(last_event_time=미사용·신선도용, status_changed_at=단계 전환 시각).
- `/docs/ARCHITECTURE.md` "HTTP API 계약" — `GET /shipments`·`GET /shipments/:id` 의 `shipment` 객체 필드에 `status_changed_at` 이 포함됨을 한 줄 명시.
- `/docs/ENGINEERING.md` "마이그레이션" 절에 **원격 D1 적용 명령**을 기록(아래 §마이그레이션). backfill 폴백(`?? created_at`)으로 기존 행 안전함도 한 줄.

### 6. 테스트 (TDD)
- cron 테스트:
  - 단계 전환이 일어난 폴링에서 `status_changed_at` 이 **이벤트 시각**으로 갱신됨.
  - 단계 변화가 없는 반복 폴링에서는 `status_changed_at` 이 **변하지 않음**.
  - 이벤트 시각이 누락/파싱불가면 `now` 로 폴백됨.
  - 배송완료(또는 AVAILABLE_FOR_PICKUP) 전환에서도 `status_changed_at` 이 기록됨.
- api/shipments 테스트:
  - `GET /shipments` 응답 항목에 `status_changed_at` 포함.
  - 컬럼이 NULL인 행(backfill 전)은 응답에서 `created_at` 으로 폴백됨.
- e2e(있으면): 데모 송장이 단계 진행 시 `status_changed_at` 이 단계마다 갱신됨(데모 이벤트 시각 기준).

## 마이그레이션 (원격 D1 — 사람이 배포 시 1회)
```bash
# worker/ 에서. ALTER 는 재실행 불가(이미 있으면 duplicate column 에러) → 최초 1회만.
npx wrangler d1 execute unboxing --remote --command "ALTER TABLE shipments ADD COLUMN status_changed_at INTEGER"
```

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차
1. 위 AC 실행.
2. 체크리스트: schema.sql ↔ schema.ts 1:1 동기화 / `status_changed_at` 은 전환 시에만 기록 / 재구독(200) 경로 미갱신 / backfill 폴백 동작 / 기존 테스트 무파손 / ARCHITECTURE·ENGINEERING 문서 갱신.
3. `phases/05-backend-v0-redesign-data/index.json` step 0 업데이트(성공→completed+summary, 실패→error, 외부개입 필요→blocked).

## 금지사항
- 폴링(`last_polled_at` 갱신)마다 `status_changed_at` 을 갱신하지 마라. 이유: "상태 변경 시각"이어야 하며 API 호출 시각이 아님 — 이 기능의 본질을 깨뜨린다.
- 재구독(200 멱등) 시 `status_changed_at` 을 덮어쓰지 마라. 이유: 공유 행의 단계 시작 시각이 타 구독자에게 잘못 보인다.
- `last_event_time` 컬럼을 쓰지 마라. 이유: 선언만 되어 있고 본 작업과 의미가 다르며 혼선을 부른다.
- 수령인 등 PII를 D1에 저장하지 마라(ADR-005).
- 기존 테스트를 깨뜨리지 마라.
