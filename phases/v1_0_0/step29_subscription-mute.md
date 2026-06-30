# Step 29: subscription-mute — 송장별 알림 음소거

앱 목록에서 **좌측 스와이프로 "이 송장의 알림만" 끄고/켜는** 기능의 백엔드다. 핵심 제약: 같은 운송장을 여러 device가 공유(N:1 구독)하므로 음소거는 **구독(subscription) 단위**여야 한다 — 한 사용자가 음소거해도 다른 구독자의 알림은 그대로여야 한다.

> **제품 결정(이 step의 전제)**: 음소거는 해당 송장의 **모든** 푸시를 끈다 — 단계 전환 알림뿐 아니라 운영성 알림(번호 확인·분실 의심)도 포함. 이유: 사용자 멘탈모델 "이 택배 알림 끄기"에 부합. 단계 추적(폴링·CAS·status_changed_at)은 계속되고 **발송만** 빠진다(앱을 열면 최신 상태가 보임).

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — "데이터 모델"(devices/shipments/subscriptions), "HTTP API 계약", "푸시 발송 파이프라인", "에러 처리 매트릭스"
- `/docs/ADR.md` — ADR-007(인가: Bearer device_id), ADR-018(거래성 알림만), ADR-010(푸시 2단계). **이 step에서 ADR-020(아래 §문서)을 신설한다.**
- `/docs/ENGINEERING.md` — 마이그레이션 함정. 이번도 단순 ADD COLUMN(RENAME 이슈 없음).
- `worker/schema.sql` 와 `worker/src/schema.ts` — DDL 단일 출처 2개(1:1로 함께 수정).
- `worker/src/cron.ts` — `subscriberTokens`(알림 fan-out의 토큰 소스), `fanOut`, `notifyTransition`, 배송완료 분기, `enqueue`/`flushQueue`(야간 보류 큐)
- `worker/src/index.ts` — `handleListShipments`, `handleGetShipment`, `handleDeleteShipment`(인가/소유 확인 패턴), `serializeShipment`, `ShipmentRow`, `parseJsonObject`, fetch 라우터의 `segments.length === 2 && segments[0] === "shipments"` 블록, `enforceIpRateLimit`(PATCH엔 적용 안 함)
- `worker/test/` 하위 cron·api·shipments 테스트
- step 0 결과(`status_changed_at`) — 같은 파일들을 만지므로 그 변경을 먼저 읽고 충돌 없이 이어서 작업하라.

## 작업

### 1. 스키마: `subscriptions.muted INTEGER NOT NULL DEFAULT 0`
- `worker/schema.sql` 와 `worker/src/schema.ts` **둘 다**에, 기존 ALTER 들 뒤에 추가:
  - `ALTER TABLE subscriptions ADD COLUMN muted INTEGER NOT NULL DEFAULT 0`
- DEFAULT 0 = 기존 구독 전부 "알림 켜짐" 유지(안전).

### 2. cron 알림 제외 — `subscriberTokens`(cron.ts)
- 음소거된 구독은 푸시를 받지 않아야 한다. `subscriberTokens` 의 JOIN 쿼리에 `AND sub.muted = 0` 을 추가한다.
- 이 함수는 단계 전환·배송완료·운영성(번호확인/분실) 알림 fan-out **모두**의 토큰 소스다 → 음소거 = 해당 송장의 **모든** 푸시를 끈다(위 제품 결정). 단계(CAS) 상태 전이 자체는 그대로 진행되고 **발송만** 빠진다(멱등 불변).

### 3. HTTP API: 음소거 토글 — `PATCH /shipments/:id`
- 라우터의 `segments.length === 2 && segments[0] === "shipments"` 블록에 `if (method === "PATCH")` 분기를 추가하고 `handleMuteShipment(env, request, deviceId, id)` 를 만든다.
- 바디: `{ "muted": boolean }`. `parseJsonObject` 로 파싱하고 `muted` 가 boolean이 아니면 `ApiError(400, "INVALID_BODY", ...)`.
- 인가/소유: `handleDeleteShipment` 처럼 `SELECT 1 FROM subscriptions WHERE shipment_id = ? AND device_id = ?` 로 소유 확인 후 없으면 `ApiError(404, "NOT_FOUND", ...)`.
- 동작: `UPDATE subscriptions SET muted = ? WHERE device_id = ? AND shipment_id = ?` (boolean → 1/0). 성공 시 `204 No Content`. **반드시 device_id + shipment_id 둘 다로 WHERE** (타 구독자 보호).
- **레이트리밋 적용 금지**: PATCH는 `enforceIpRateLimit` 대상이 아니다(등록 남용 방어와 무관, 저위험).

### 4. 음소거 시 야간 보류분 정리 — handleMuteShipment (엣지케이스)
- 야간(조용시간)에 보류 큐(`notification_queue`)에 이미 적재된 알림은 아침 `flushQueue` 가 `subscriberTokens` 를 거치지 않고 큐에서 직접 발송한다 → 음소거 **이전에** 적재된 분이 음소거 후에도 아침에 발송되는 누락이 있다.
- 따라서 `muted = true` 로 설정할 때, 이 기기의 보류분을 함께 삭제한다:
  - 이 device의 `push_token` 조회(`SELECT push_token FROM devices WHERE id = ?`) → 토큰이 있으면 `DELETE FROM notification_queue WHERE shipment_id = ? AND push_token = ?`.
  - 토큰이 NULL이면(푸시 미허용) 정리할 보류분이 없으므로 skip.
- `muted = false`(음소거 해제)에서는 큐 조작 없음.

### 5. 목록/상세에 muted 노출 — index.ts
- `handleListShipments` 의 쿼리는 이미 `subscriptions sub` 를 JOIN한다. SELECT에 `sub.muted` 를 추가하고, 응답 항목에 `muted: row.muted === 1` 을 포함한다(`serializeShipment` 가 shipments 컬럼만 다루므로 muted는 조인 결과에서 호출부에서 합쳐라 — serializeShipment 시그니처를 깨지 말 것).
- `handleGetShipment` 도 동일하게 `sub.muted` 를 SELECT하여 응답 `shipment` 에 `muted` 포함(상세 화면이 음소거 상태를 표시).

### 6. 문서 갱신 (변경되는 서버 사양)
- `/docs/ADR.md` 에 **ADR-020: 송장별 알림 음소거는 per-subscription** 신설. 핵심: 운송장은 device 간 공유(N:1) → 음소거는 구독 단위(device_id+shipment_id), 전역/송장 단위 아님. 음소거는 모든 푸시(전환+운영성)를 끄되 추적은 계속(발송만 보류 제거). ADR-018(거래성) 위반 아님.
- `/docs/ARCHITECTURE.md` "데이터 모델" `subscriptions` 에 `muted`(per-구독 음소거) 추가. "HTTP API 계약" 표에 `PATCH /shipments/:id` 행 추가(요청 `{muted}`, 성공 `204`, 에러 `400/401/404`). "에러 처리 매트릭스 > HTTP API" 에 PATCH 케이스 반영. `GET /shipments`·`/:id` 의 `shipment` 객체에 `muted` 포함 명시.
- `/docs/ENGINEERING.md` 마이그레이션 절에 subscriptions ALTER 명령 기록(아래 §마이그레이션).

### 7. 테스트
- api/shipments 테스트:
  - `PATCH /shipments/:id {muted:true}` → 204, 이후 `GET /shipments` 항목의 `muted === true`. 다시 `{muted:false}` → false.
  - 미소유 id → 404. 잘못된 바디(`{}`·`{muted:"x"}`) → 400. 이중 호출 멱등(true→true 여전히 204·muted=1).
- cron 테스트:
  - 한 송장에 구독자 2명(A muted=1, B muted=0). 단계 전환 폴링 시 **B에게만** 발송, A 제외. 단계 CAS는 그대로 1회.
  - **야간 보류 정리**: 조용시간에 전환으로 A·B 보류 적재 → A가 음소거(`PATCH`) → 아침 `flushQueue` 시 A 보류분은 사라지고 B만 발송됨.

## 마이그레이션 (원격 D1 — 사람이 배포 시 1회)
```bash
npx wrangler d1 execute unboxing --remote --command "ALTER TABLE subscriptions ADD COLUMN muted INTEGER NOT NULL DEFAULT 0"
```

## Acceptance Criteria

```bash
npm run verify
```

## 검증 절차
1. 위 AC 실행.
2. 체크리스트: schema.sql ↔ schema.ts 동기화 / mute는 (device_id, shipment_id) 단위 / 타 구독자 무영향 / 멱등(상태 CAS) 불변 / 음소거 시 야간 보류분 정리 / PATCH 레이트리밋 미적용 / ADR-020·ARCHITECTURE·ENGINEERING 문서 갱신 / 기존 테스트 무파손.
3. `phases/05-backend-v0-redesign-data/index.json` step 1 업데이트.

## 금지사항
- 전역(모든 구독) 음소거를 만들지 마라. 이유: 운송장은 device 간 공유되며 한 사용자의 음소거가 타인에게 새면 안 됨.
- 음소거를 위해 단계 전환(CAS)·`status_changed_at` 기록을 건너뛰지 마라. 이유: 상태 추적은 계속돼야 하고 "발송"만 빠져야 한다(앱을 다시 열면 최신 상태가 보여야 함).
- `flushQueue` 가 `subscriberTokens` 를 거치도록 리팩터하지 마라(과설계). 이유: 보류분은 발송 시점 스냅샷(R2 설계)이라 §4 처럼 음소거 시 정리하는 게 단순·정확.
- 수령인 등 PII를 D1에 저장하지 마라(ADR-005).
- 기존 테스트를 깨뜨리지 마라.
