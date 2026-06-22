# Step 3: notifications-endpoint-and-delete-cleanup — GET /notifications + DELETE /me 정리 + 삭제 시 보류 큐 정리 + SET NULL

앱이 받은 알림 목록을 조회하는 `GET /notifications` 를 추가하고, "모든 데이터 삭제"(`DELETE /me`)가 `notifications` 까지 폐기하도록 확장한다. 또한 **삭제(휴지통으로 보낸) 송장이 알림을 받지 않도록**(사용자 요구) 단건 삭제 시 그 기기의 보류 알림을 정리하고, 송장 행 삭제 시 `notifications.shipment_id` 가 `SET NULL` 로 보존됨을 테스트로 잠근다.

## 읽어야 할 파일

먼저 아래를 읽고 HTTP 라우터·auth·삭제 경로·보류 큐를 파악하라:

- `/docs/ARCHITECTURE.md` — "HTTP API 계약"(`GET /notifications` 행 line 88), "에러 처리 매트릭스" HTTP(line 399~400 — 401/200), "엣지 케이스" 알림(딥링크 정리됨·토큰 양도), "v1.1 설계 보강 ②"(운송장 삭제와 독립·SET NULL)
- `/docs/ADR.md` — ADR-017("모든 데이터 삭제" = 서버 `DELETE /me` + 로컬), ADR-022(휴지통=로컬 소프트 삭제 — 삭제는 구독 해제), ADR-023(알림 기록 — 단건 삭제는 이력 안 지움·90일/상한/DELETE me 로만)
- `/docs/QA.md` — "E-2 워커 통합"의 `GET /notifications`·`DELETE /me`·송장 삭제 SET NULL 행, "E-4" E10(토큰 양도 교차 누설 없음)
- `worker/src/index.ts` — 라우터, `requireDevice`/auth(미인증 401), `handleDeleteMe`(devices·subscriptions·tokens batch), `handleDeleteShipment`(구독 해제·구독 0 시 행 삭제), `serializeShipment` 직렬화 패턴, `NotificationRow`
- `worker/src/lib/quiet.ts` — `notification_queue`(단건 삭제 시 정리 대상)
- **이전 step 산출물**: `notifications` 스키마·로깅, step2 의 device_id↔token 역조회

## 작업

### 1. `GET /notifications` (index.ts)
- auth: 미인증/잘못된 device_id → `401 UNAUTHORIZED`.
- 조회: **이 device_id 행만**, `ORDER BY sent_at DESC`, `?limit=`(기본 100·상한 적용, 예 200).
- 응답: `200 { notifications: [{ id, shipmentId?, carrier, last4, body, stage, sentAt }] }` — `shipment_id` NULL 이면 `shipmentId` 생략/`null`(denormalize 필드로 표시는 유지). 직렬화는 `serializeShipment` 스타일 따른다(snake→camel).

### 2. `DELETE /me` 에 notifications 정리 (index.ts)
- `handleDeleteMe` 의 batch 에 `DELETE FROM notifications WHERE device_id = ?` 추가(기존 devices·subscriptions·tokens 와 함께 원자적 batch).

### 3. 삭제 시 보류 큐 정리 — 휴지통 알림 차단 (index.ts / quiet.ts)
- `handleDeleteShipment`(구독 해제) 시, 그 **(device, shipment) 의 보류 `notification_queue` 행도 정리**한다.
- 이유: 구독 해제로 새 폴링·푸시는 이미 멈추지만, 조용시간에 **이미 적재된 보류분**이 나중에 flush 되면 휴지통(로컬)으로 보낸 송장에 지연 푸시가 갈 수 있다. 이를 막아 **"휴지통에 있는 배송은 알림을 보내지 않는다"** 불변을 보장한다.
- 다른 기기의 구독·보류분은 건드리지 않는다(per-device).

### 4. 송장 삭제 시 SET NULL 보장 (테스트로 잠금)
- 송장 행 삭제(구독 0)는 FK `ON DELETE SET NULL` 로 `notifications.shipment_id` 를 NULL 로 만든다(행 보존·이력 유지·딥링크만 무효). 코드 변경이 아니라 **동작을 테스트로 잠근다**(회귀 방지).

### 5. 문서 — HTTP 계약 반영
- `/docs/ARCHITECTURE.md` "HTTP API 계약" 의 `GET /notifications` 행이 실제와 일치하는지 확인(limit 기본·상한·정렬). 어긋나면 한 줄 정정.

## 테스트 (TDD)
- 워커 통합(`cloudflare:test` SELF·env·D1):
  - `GET /notifications` — 미인증 `401` / **이 device_id 행만**(타 device 행 비노출) / `sent_at DESC` / `limit`(기본·상한 적용) / denormalize 필드 존재 / `shipment_id` NULL 행도 표시.
  - `DELETE /me` — 그 device 의 `notifications` 가 함께 폐기(devices·subscriptions·tokens 와 batch).
  - **송장 삭제 → `notifications.shipment_id` SET NULL**(행은 **삭제되지 않음**·다른 컬럼 보존).
  - **삭제 시 보류 큐 정리** — 보류 적재 상태에서 `DELETE /shipments/:id` 후 그 device 로 flush 발송 0(휴지통 송장 미발송).
  - 토큰 양도(재설치) — `notifications` 는 device_id 키라 교차 누설 없음(E10).

## Acceptance Criteria
```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차
1. 위 AC 실행.
2. 체크리스트: `GET /notifications` 인가·device_id 필터·정렬·limit / `DELETE /me` notifications 포함 / 삭제 시 보류 큐 정리(휴지통 미발송) / 송장 삭제 SET NULL(행 보존) / ADR 스택·CLAUDE.md CRITICAL(비영속·$0) 위반 없음 / 기존 테스트 무파손.
3. `phases/07-backend-v0-v11-notifications/index.json` step 3 업데이트(성공→completed+summary / 3회 실패→error / 외부개입→blocked).

## 금지사항
- 타 device_id 의 `notifications` 를 노출하지 마라. 이유: device_id 가 인가 경계 — 교차 누설은 프라이버시 침해(E10).
- 송장 삭제 시 `notifications` **행을 DELETE** 하지 마라. 이유: 받은 알림 이력은 보존(SET NULL·딥링크만 무효)이며 90일/상한/`DELETE me` 로만 정리(ADR-023).
- 단건 삭제로 서버 `notifications` 이력을 지우지 마라. 이유: 단건 삭제 = 구독 해제일 뿐, 받은 알림 기록은 독립 보존(ADR-023).
- 보류 큐 정리에서 다른 기기의 구독/보류분을 건드리지 마라. 이유: per-device 격리.
- 기존 테스트를 깨뜨리지 마라.
