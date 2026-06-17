# Step 6: http-api (HTTP API + D1)

Expo 앱이 호출하는 HTTP API 라우트를 `worker/src/index.ts` 의 `fetch` 핸들러에 구현하고, D1 통합 테스트를 작성한다. `scheduled`(cron)는 step7에서 — 이 step에서는 건드리지 않는다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — "HTTP API 계약" 표, "디바이스 식별 & 인증/인가", "동시성 & 원자성"(dedupe race), "보안 & 공개 API 남용 방어", "에러 처리 매트릭스 → HTTP API"
- `/docs/ADR.md` — ADR-002(익명), ADR-007(device_id Bearer), ADR-008(throttle·활성 상한), ADR-005/011(개인정보 비영속·타임라인 미저장), ADR-017(`DELETE /me`)
- `/Users/jinni/Developments/unboxing/worker/src/index.ts` — 현재 fetch 라우팅 스텁
- `/Users/jinni/Developments/unboxing/worker/schema.sql` · `/Users/jinni/Developments/unboxing/worker/src/schema.ts` — step0 스키마
- `/Users/jinni/Developments/unboxing/worker/src/tracker.ts` — step4 `track`(즉시 1회 조회·상세 타임라인)
- `/Users/jinni/Developments/unboxing/worker/src/lib/tracking.ts`(app) → 동일 검증을 서버에서 재구현해야 함(아래)
- `/Users/jinni/Developments/unboxing/worker/test/api.test.ts` — 기존 테스트 스타일(`cloudflare:test` 의 `SELF`·`env`)

## 작업

### 라우트 (`worker/src/index.ts` fetch 핸들러)

`/health` 외 모든 경로는 `Authorization: Bearer <device_id>` 필요. 에러는 `{ error, code }` + HTTP status.

| 메서드·경로 | 동작 | 성공 |
|---|---|---|
| `POST /devices` | `{push_token, platform}` → `devices` upsert(id=Bearer device_id) | `200 {device_id}` |
| `POST /shipments` | `{carrier, tracking_no}` → dedupe + 구독 + 즉시 1회 track(best-effort) | `201 {shipment}` / 이미 구독 시 `200 {shipment}` |
| `GET /shipments` | 내 송장 목록 + `last_normalized_status` | `200 {shipments:[...]}` |
| `GET /shipments/:id` | 인가 확인 → 실시간 track 타임라인 | `200 {shipment, timeline:[...]}` |
| `DELETE /shipments/:id` | 구독 해제, 마지막 구독이면 shipment 삭제 | `204` |
| `DELETE /me` | device + 구독(CASCADE) + orphan 송장 + 푸시 토큰 폐기 | `204` |

에러 코드(ARCHITECTURE 에러 매트릭스): `400 INVALID_BODY`, `422 INVALID_TRACKING`/`INVALID_TOKEN`, `401 UNAUTHORIZED`, `404 NOT_FOUND`, `429 RATE_LIMITED`, `409 CARRIER_UNSUPPORTED`.

### 결정사항 (이 step에서 확정·일관 적용)

- **`:id` 미소유/없음은 둘 다 `404 NOT_FOUND` 로 통일**한다(존재 누설 최소화 — ARCHITECTURE 보안 섹션이 허용한 옵션). `403` 을 쓰지 않는다.
- **즉시 1회 track / 상세 타임라인은 best-effort**: 외부 실패 시 throw 하지 말고 흡수한다. `POST /shipments` 는 송장을 `미등록`(또는 직전 캐시) 상태로 생성/반환, `GET /:id` 는 `timeline: []` 로 캐시 상태만 반환한다. 이유: NOT_FOUND/미등록은 정상이고 등록이 외부 장애로 막히면 안 된다.
- **서버측 운송장 재검증**: 정규화 후 `^\d{9,14}$` 위반 시 `422 INVALID_TRACKING`. (app `tracking.ts` 와 동일 규칙을 worker에 작은 헬퍼/인라인으로 둔다 — app 패키지를 import하지 말 것.)
- **throttle / 활성 상한**(ADR-008): device 당 활성 구독 수가 상한(상수, 예 `MAX_ACTIVE_PER_DEVICE = 100`) 초과면 `POST /shipments` 에 `429 RATE_LIMITED`.
- **carrier 미지원**: Phase 1에서는 live `carriers()` 조회를 강제하지 않는다. `carrier` 가 비었거나 형식이 명백히 잘못된 경우만 `409 CARRIER_UNSUPPORTED`(딥링크 정보 포함 가능). 실제 지원목록 대조는 후속 작업으로 둔다.

### dedupe + 멱등 (ARCHITECTURE 동시성)

- `INSERT INTO shipments ... ON CONFLICT(carrier, tracking_no) DO NOTHING` → `SELECT` 로 shipment id 확보 → `INSERT OR IGNORE INTO subscriptions`.
- 같은 `(device_id, carrier, tracking_no)` 재등록은 새 행 없이 기존 구독 반환(`200`). 신규는 `201`.

### `DELETE /me` (ADR-017)

- device 삭제 → `subscriptions` CASCADE. 그 결과 구독 0이 된 shipment(orphan) 정리. push_token 폐기(device 행 삭제로 자연 폐기).

### 테스트 헬퍼 + 통합 테스트

`worker/test/helpers.ts`:

```ts
export async function applySchema(db: D1Database): Promise<void>; // src/schema.ts SCHEMA_STATEMENTS 를 exec
export function bearer(deviceId: string): HeadersInit;            // Authorization 헤더
```

`worker/test/shipments.test.ts`(신규, `cloudflare:test` 의 `SELF`·`env`): `beforeEach` 에서 `applySchema(env.DB)` + 정리. 검증:

- `POST /devices` upsert → 200.
- `POST /shipments` 신규 201, 동일 device 재등록 200(멱등, 행 1개).
- 두 device 가 같은 송장 등록 → shipments 1행(dedupe), 구독 2개.
- `GET /shipments` 가 내 송장만 반환.
- `GET /:id` / `DELETE /:id` 를 **타 device** 가 호출 → `404`(인가).
- `DELETE /:id` 마지막 구독 → shipment 삭제(orphan 정리).
- `DELETE /me` → device·구독·orphan 송장 제거.
- 활성 상한 초과 → `429`.
- Bearer 없음 → `401`.

기존 `worker/test/api.test.ts`(health·D1 바인딩)는 유지한다.

## 핵심 규칙 (벗어나면 안 됨)

- **모든 D1 쿼리는 prepared statement(`.bind()`)** 로 파라미터 바인딩한다. 문자열 결합 SQL 금지. 이유: SQLi 차단(ARCHITECTURE 보안).
- **`device_id`·`push_token` 을 로그에 남기지 마라.** 이유: ADR-007, 개인정보/자격 보호.
- **수령인 이름·연락처·주소를 D1에 저장하지 마라.** track 결과의 그런 필드는 응답으로만 흘리고 저장 금지. 이유: CLAUDE.md CRITICAL(개인정보 비영속, ADR-005).
- **타임라인을 D1에 저장하지 마라.** 상세는 실시간 조회. 이유: ADR-011.
- 멱등 등록(200 vs 201), `:id` 인가 404 통일을 반드시 지킨다.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 모든 쿼리가 `.bind()` 인가(SQLi)?
   - 멱등 등록·dedupe·인가(404)·throttle(429)가 테스트로 보장되는가?
   - 타임라인/수령인 정보가 D1에 저장되지 않는가?
   - device_id/push_token 로그 부재?
   - CLAUDE.md CRITICAL(개인정보 비영속·마찰 최소) 위반 없는가?
3. `phases/worker-backend/index.json` 의 step 6 을 업데이트한다(규칙은 step0 과 동일).

## 금지사항

- `scheduled`(cron) 핸들러를 구현하지 마라. 이유: step7의 책임. 이 step은 HTTP만.
- app 패키지(`app/src/lib/tracking.ts`)를 import하지 마라. 이유: worker/app 은 독립 패키지. 서버 재검증을 worker 안에 둔다.
- `403` 과 `404` 를 혼용하지 마라. 이유: 존재 누설 최소화 — `:id` 는 404로 통일.
- 문자열 결합으로 SQL을 만들지 마라. 이유: SQLi.
- 기존 테스트를 깨뜨리지 마라.
