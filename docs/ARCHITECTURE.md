# 아키텍처

> 결정 근거는 `ADR.md`, 기획은 `PRD.md`, 화면/디자인은 `UI_GUIDE.md`. 이 문서는 **무엇을 어떻게 만드는가**와 **모든 계층의 에러/엣지 처리**를 기술한다.
> 미검증 외부 사실(tracker.delivery 쿼터 등)은 `ADR.md` Open Questions 참조.

## 디렉토리 구조

```
unboxing/
├── app/                    # Expo (React Native) 클라이언트 — iOS+Android 단일 코드베이스
│   └── src/lib/            # 순수 로직 (예: tracking.ts — 운송장 검증)
├── worker/                 # Cloudflare Worker 백엔드
│   ├── src/index.ts        # fetch(HTTP API) + scheduled(cron 폴링) 핸들러
│   ├── src/lib/            # 순수 로직 (예: polling.ts — 적응형 폴링 due 계산)
│   ├── test/               # Worker HTTP/D1 통합 테스트 (cloudflare:test)
│   ├── schema.sql          # D1 스키마
│   └── wrangler.toml       # 15분 cron + D1 바인딩 + 시크릿
├── docs/                   # PRD · ARCHITECTURE · ADR · UI_GUIDE (가드레일)
├── phases/                 # Harness 실행 단위 (index.json + step*.md)
└── scripts/                # execute.py — Harness 실행 엔진
```

## 패턴

```
[Expo 앱] ─등록/조회→ [Cloudflare D1] ←읽기─ [Cloudflare Workers Cron]
   ▲                   (송장·푸시토큰)         │ 주기 배치 폴링 (+webhook 수신)
   └── Expo Push ← 상태변화 푸시 ──────── [tracker.delivery API]
```

- **서버리스 cron 단일 배치** — 사용자별 타이머 ❌. cron(15분)이 떠서 due된 송장만 한 번에 폴링. (→ ADR-001)
- **due 기반 폴링** — `활성 AND now >= last_polled_at + interval(단계)` 인 송장만 외부 호출.
- **상태 정규화 매핑 (코드)** — 택배사 원문 상태 → 표준 단계 매핑을 Phase 1엔 코드 상수 맵으로. (→ ADR-009)
- **dedupe** — 동일 `(carrier, tracking_no)`는 shipments 1행. 월 고유-운송장 과금을 줄이는 핵심 레버.

## 데이터 흐름

```
[등록] 앱 → POST /shipments (Bearer device_id) → device upsert + shipment dedupe(INSERT ON CONFLICT)
        + subscription 연결 → 즉시 1회 track 조회 → 응답
[폴링] cron(15분) → due 조회(정렬·청크 ≤50) → track → 원문 상태 → 표준 단계 정규화
        → last_normalized_status 변경 시에만 Expo Push send(ticket) (멱등)
[수신] cron(별도) → getReceipts → DeviceNotRegistered면 토큰 삭제
[웹훅(최적화)] tracker.delivery → POST /webhooks/track {carrierId,trackingNumber} → 202
        → 큐/즉시 track → 위 정규화·푸시 경로 재사용
```

## 데이터 모델 (Phase 1, D1)

원본 스키마: `worker/schema.sql`.

- `devices`: `id`(=secret device_id, PK), `push_token`(UNIQUE, **nullable** — 푸시 거부/미허용도 기기 등록, QA-001), `platform`(ios|android), `created_at`.
- `shipments`: `id`(PK), `carrier`, `tracking_no`, `last_normalized_status`, `last_polled_at`(due 계산 기준), `active`(1/0), `created_at`, `status_changed_at`(현재 단계가 시작된 시각 — **단계 전환 시에만** 갱신, 폴링마다 ❌). `UNIQUE(carrier, tracking_no)` = dedupe 키.
- `subscriptions`: `device_id`↔`shipment_id` 다대다(PK 복합, FK ON DELETE CASCADE). dedupe 폴링 + 소유권 근거. `muted`(1/0, DEFAULT 0): per-구독 알림 음소거 — 이 구독만 모든 푸시 제외(타 구독자 무영향, → ADR-020).
- 인덱스 `idx_shipments_due (active, last_polled_at)` — due 조회용.
- `notifications`(**v1.1 신규**, → ADR-023): 서버가 발송한 알림 기록. `id`(PK), `device_id`(수신 기기 — 이 키로 `GET /notifications` 조회·`DELETE /me` 정리. token 양도 누설 회피), `shipment_id`(nullable, `REFERENCES shipments(id) ON DELETE SET NULL` — 송장 정리돼도 기록 유지·딥링크만 무효), `carrier`·`last4`·`body`·`stage`(표시용 denormalize — 비-PII, 행 자족), `sent_at`(epoch ms). 인덱스 `(device_id, sent_at)`. **읽음 여부는 비저장**(로컬 `lastSeenNotificationAt`). 보존: cron sweep(예: 90일)+디바이스당 상한.

**예고 컬럼 (구현 단계에서 추가, → 스키마 진화 섹션):**

| 테이블 | 컬럼 | 용도 |
|---|---|---|
| shipments | `registered_at` 또는 재사용 `created_at` | 30일 좀비 만료 기준 |
| shipments | `last_event_time` | 동일 단계 내 새 이벤트 판별/타임라인 신선도 (**현재 미사용** — 기록 안 함) |
| shipments | `status_changed_at` | **현재 단계가 시작된 시각**(단계 전환 시에만 갱신) — 앱 목록 "업데이트" 표시용. `last_event_time`(신선도용·미사용)과 의미가 다름 |
| shipments | `fail_count` / `next_retry_at` | 외부 오류 백오프 |
| shipments | `webhook_expires_at` | webhook 재등록 sweep 기준 (webhook 도입 시) |
| (신규) `tracker_token` | `access_token`, `expires_at` | tracker.delivery 토큰 캐시 (→ ADR-013) |
| (신규) `push_tickets` | `ticket_id`, `created_at` | receipt 확인 대기 (→ ADR-010, 확인 후 삭제) |

## HTTP API 계약

- 베이스: Worker `fetch` 핸들러. JSON only. 인증: `Authorization: Bearer <device_id>` (─/health 제외).
- **에러 응답 공통 포맷**: `{ "error": "<사람용 메시지>", "code": "<MACHINE_CODE>" }` + 적절한 HTTP status.
- 입력은 모두 검증, D1 접근은 **prepared statement**(SQLi 방지).

| 메서드 · 경로 | 설명 | 요청 | 성공 응답 | 주요 에러 |
|---|---|---|---|---|
| `GET /health` | 스모크 | — | `200 {ok:true}` | — |
| `POST /devices` | 기기 등록/갱신(upsert) — `push_token` 은 **선택**(없으면 토큰 없이 부트스트랩, QA-001) | `{platform, push_token?}` | `200 {device_id}` | `400 INVALID_BODY`(platform 누락), `422 INVALID_TOKEN` |
| `POST /shipments` | 운송장 등록(dedupe + 구독 + 즉시 1회 조회) | `{carrier, tracking_no}` | `201 {shipment}` / 이미 구독 시 `200 {shipment}`(멱등) | `400`, `422 INVALID_TRACKING`, `401`, `429 RATE_LIMITED`, `409 CARRIER_UNSUPPORTED`(딥링크 안내) |
| `GET /shipments` | 내 송장 목록 + 정규화 상태 | — | `200 {shipments:[...]}` | `401` |
| `GET /shipments/:id` | 상세 = 실시간 track 타임라인 + 수취인 패스스루 (→ ADR-011·005) | — | `200 {shipment, timeline:[...], recipient}` (`recipient`=`{name,regionName}` 또는 track 실패 시 `null`, **미저장**) | `401`, `403 NOT_OWNER`, `404`, `502 UPSTREAM_ERROR`(타임라인만 실패 시 캐시 상태 반환) |

- `shipment` 객체(목록·상세 공통)는 `id`·`carrier`·`tracking_no`·`status`·`active`·`created_at`·`status_changed_at`(현재 단계 시작 시각; 컬럼이 비면 `created_at` 으로 폴백)·`muted`(이 기기 구독의 음소거 여부, per-구독 — ADR-020)를 포함한다.
| `PATCH /shipments/:id` | 이 기기 구독의 알림 음소거 토글 (per-구독, → ADR-020) | `{muted: boolean}` | `204` | `400 INVALID_BODY`, `401`, `404`(미소유). 레이트리밋 미적용 |
| `DELETE /shipments/:id` | 구독 해제(마지막 구독이면 shipment도 정리) | — | `204` | `401`, `403 NOT_OWNER`, `404` |
| `DELETE /me` | **모든 데이터 삭제** — device + 구독 + orphan 송장 + 푸시 토큰 + **알림 기록** 폐기 (→ ADR-017, 스토어 정책) | — | `204` | `401` |
| `GET /notifications` | **(v1.1)** 이 기기가 받은 알림 기록(시간 역순, limit). 서버 SOT·로컬 캐시(ADR-023) | `?limit=` (기본 100·상한) | `200 {notifications:[{id,shipmentId?,carrier,last4,body,stage,sentAt}]}` | `401` |
| `POST /webhooks/track` | tracker.delivery 콜백 수신(웹훅 도입 시) | `{carrierId, trackingNumber}` (+서명) | `202` (1초 내) | 서명 불일치 `401`(조용히), 본문 오류 무시 |

- **멱등성**: 같은 `(device_id, carrier, tracking_no)` 재등록은 새 행 생성 없이 기존 구독 반환(`200`).
- **인가**: `:id` 접근은 호출 device가 해당 shipment를 구독 중일 때만(`subscriptions` 확인). 아니면 `403 NOT_OWNER` (404와 구분하되 존재 여부 누설 최소화하려면 둘 다 404로 통일하는 옵션도 가능 — 보안 섹션 참조).

## 디바이스 식별 & 인증/인가 (→ ADR-007)

- 앱이 최초 실행 시 **고엔트로피 secret `device_id`**(≥128bit) 생성, 보안 저장(iOS Keychain / Android Keystore-backed), 모든 요청에 `Bearer`.
- 서버는 `devices.id == device_id`로 식별, `subscriptions`로 소유권 인가.
- `device_id`는 **로그 금지**. 유출 시 영향=해당 기기 구독 노출(개인정보 비영속이라 운송장/상태뿐).
- 앱 삭제/초기화 시 device_id 소실 → 구독 복구 불가(Phase 2 계정으로 해결).

## 앱 아키텍처 (Expo)

- 화면(하단 탭 2개=택배함·설정 + 그 위로 push 되는 상세/등록/온보딩/개인정보처리방침). 네이티브 헤더 미사용(공용 `ScreenHeader`). UI 상세 → `docs/UI_GUIDE.md`. **(현재 출시 기준 2탭 — v1.1에서 대시보드 추가 → 3탭, 구현 시 본 줄을 3탭으로 갱신. 아래 "v1.1 … 네비게이션 / 화면 추가" 참조.)**
- 서버가 SOT, 앱은 **로컬 캐시로 오프라인 읽기만**(→ ADR-014). 변경(등록/삭제)은 온라인에서만.
- **메모(로컬 전용)**: tracker.delivery 에 상품명이 없어, 운송장별 사용자 메모를 **로컬 AsyncStorage 에만** 둔다(서버 미전송 — 마찰 최소·서버 비영속과 일관). 카드 표시·상세 편집. 송장 삭제분은 목록 동기화 시 정리(prune), "모든 데이터 삭제"에 포함.
- **서버 베이스 URL**은 빌드 시 `EXPO_PUBLIC_API_URL`로 주입(→ 환경변수 & 시크릿 섹션). 하드코딩 금지.
- **테마**: 시스템 외형(light/dark) 따름, 라이트 기준(→ ADR-016, 토큰은 UI_GUIDE). `app.json` `userInterfaceStyle`를 시스템 추종으로.
- 알림 처리: foreground(인앱 토스트/배지) / background·종료(시스템 알림) / **탭 → 해당 상세로 딥링크**.
- **백그라운드 fetch 사용 안 함** — 추적은 서버 cron이 담당(ADR-001). 앱은 포그라운드 진입/당겨서 새로고침 시에만 fetch.
- **데모/리뷰 경로**(→ ADR-019): 지정 **데모 운송장 번호**는 실제 폴링/외부 호출을 타지 않고 캔드 타임라인을 반환(앱 또는 Worker 분기). 스토어 제출 시 리뷰 노트에 샘플 번호·예상 동작 기재.

## tracker.delivery 연동

- 엔드포인트: `https://apis.tracker.delivery/graphql` (GraphQL).
- 인증: API Key(권장) 또는 OAuth2 **client_credentials → Bearer**. 현 스캐폴드는 `DELIVERY_TRACKER_CLIENT_ID/_SECRET` 시크릿(client_credentials). access token은 D1 캐시 + 만료 전 cron 재발급(→ ADR-013).
- **에러는 GraphQL 응답 본문**(`errors[]`)에 담기며 **HTTP status는 무의미**. 예: 토큰 만료 시 `UNAUTHENTICATED`.
- `track(carrierId, trackingNumber)` → `lastEvent`, `events[]`(시각·status.code·description·위치), `recipient`(수취인 이름·지역명=`location.name`). 권장 timeout **15s**. **수취인은 화면 전용 패스스루(미저장, ADR-005)** — `GET /shipments/:id` 응답에만 싣고 D1 에 저장 금지. `phoneNumber` 는 받지 않는다(PII 최소화). 상품명·사진 필드는 스키마에 없다.
- `carriers` 쿼리 → 지원 택배사 목록(자동인식 검증·미지원 판별).
- carrierId 형식 예: `kr.cjlogistics`, `kr.epost` 등.
- **CRITICAL(구현)**: `TrackerDeps.fetch` 에 전역 `fetch` 를 주입할 땐 **반드시 `fetch.bind(globalThis)`**. 맨 `fetch` 를 객체로 넘기면 호출 시 `this` 유실로 `Illegal invocation` throw → 모든 조회가 null("미등록")이 된다. mock fetch 를 쓰는 테스트는 이를 못 잡으므로 실 API 스모크로 확인(→ `docs/ENGINEERING.md` P-1). 주입 뿌리: `index.ts` `tryTrack`·`scheduled`.

### 에러 분류 → 처리

| upstream 결과 | 처리 |
|---|---|
| `UNAUTHENTICATED` (토큰 만료) | 토큰 재발급 1회 후 재시도. 자격증명(21일) 만료면 운영 경고(→ ADR-013) |
| NOT_FOUND / 데이터 없음 | `미등록` 유지(앱 입력 직후엔 정상), 7일 미수신 시 비활성+"번호 확인" |
| RATE_LIMIT / 429 | 폴링 일시 중단, `배송출발` 우선, `last_polled_at` 미갱신(백오프) |
| 5xx · timeout(>15s) | 조용히 다음 cron 재시도, `last_polled_at` 미갱신, 사용자 비노출 |
| 미매핑 status.code | 표준 `기타`로 폴백(무알림) + 로그(매핑 보강) |

## 상태 정규화 & 알림

### 원문 status.code → 표준 7단계 매핑

> tracker.delivery `TrackEventStatusCode`(추정 enum) → 표준 단계. **정확한 enum 이름/집합은 구현 시 GraphQL 스키마(`carriers`/`track`)로 검증**(→ ADR.md Open Questions).

| 원문 status.code (추정) | 표준 단계 | 알림 |
|---|---|---|
| `INFORMATION_RECEIVED` | `등록` | ✅ |
| `AT_PICKUP` | `집화` | ✅ |
| `IN_TRANSIT` | `이동중` | ❌ 타임라인만 |
| `OUT_FOR_DELIVERY` | `배송출발` | ✅ |
| `DELIVERED` | `배송완료` | ✅ |
| `AVAILABLE_FOR_PICKUP` | `배송완료`(또는 `예외` 검토) | ✅ |
| `ATTEMPT_FAIL` / `EXCEPTION` | `예외` | ✅ |
| `UNKNOWN` / (그 외 미매핑) | `기타` | ❌ (+로그) |
| (track 데이터 없음) | `미등록` | ❌ |

### 알림 규칙
- **단계 전환에만** 알림. `이동중`/`기타`/`미등록`은 무알림(타임라인만).
- **멱등성**: `last_normalized_status` 비교해 단계가 바뀔 때만 1회 발송. 재독해도 중복 없음.
- **등록 직후 목록 표시(즉시 저장)**: 등록 시 즉시 1회 `track` 결과의 단계를 **`미등록` 만 제외하고 모두 `last_normalized_status` 에 저장**해 목록이 등록 직후 실제 상태를 보인다. 비종료 단계는 `last_polled_at`=NULL 유지 → cron 다음 틱에 재폴링(전환 감지). **`배송완료`(종료)도 저장**하되 `active=0` 으로 둔다(재폴링 중단) — 이미 배송완료된 송장을 등록하면 `미등록` 이 아니라 `배송완료` 로 보여야 하기 때문(cron 미실행 환경에서 `미등록` 고착되던 버그 수정). **트레이드오프**: 등록 시점 단계는 `prev==stored` 라 **푸시하지 않는다**(등록 이후 변화만 알림). 미허용/자격증명 없음/외부 실패 시엔 저장 안 함(`미등록` 유지) — 테스트 환경은 자격증명을 비워 즉시 track 을 no-op 으로 둔다(`docs/ENGINEERING.md` 외부경계 검증).

## 적응형 폴링 + cron 실행 모델

### 단계별 간격 (`worker/src/lib/polling.ts`: `pollIntervalMs`, `isDue`)

| 단계 | 폴링 간격 |
|---|---|
| `미등록` | 6h |
| `등록`·`집화`·`이동중`·`기타` | 4h |
| `배송출발` | 1h |
| `배송완료` | 중단 |
| `예외` | 12h |

### cron 실행 모델 (→ ADR-012)
- **due 조회·정렬**: `active=1 AND now >= last_polled_at + interval(stage)`, 정렬 `배송출발` 우선 → `last_polled_at ASC`.
- **청크/이월**: 1회 실행당 외부 subrequest **≤50**. 초과분은 다음 fire(15분 뒤)로 자연 이월.
- **중첩 방지**: 처리 시작 시 `last_polled_at` 선점 갱신(성공·실패 무관 재선택 방지). 단 외부 오류 시 백오프와 결합(아래).
- **시간대**: "배송출발=오늘 도착" 등 날짜 판정은 **KST(UTC+9)**.
- `ctx.waitUntil`로 푸시/정리 비동기 작업이 응답 이후에도 완료되도록.

### 만료/좀비 (데이터 수명주기와 통합)
- 미등록 7일·예외 7일 자동 비활성. 등록 후 30일 지나도 완료/예외 아니면 강제 비활성(분실 의심)+알림.

## 푸시 발송 파이프라인 (→ ADR-010)

- **2단계**: ① `send`(배치 ≤100) → ticket 수신, ticket id 임시 보관. ② **~15분 후** `getReceipts`(배치 ≤1000) → 최종 전달 결과.
- rate: 600/s(프로젝트). 초과 시 `TOO_MANY_REQUESTS` → 백오프.
- payload는 4096B 이하. 알림 데이터에 `shipment_id`(딥링크용) 포함.

### 푸시 에러 처리

| 에러 (ticket/receipt) | 처리 |
|---|---|
| `DeviceNotRegistered` | 해당 push_token **즉시 삭제**(device 정리) |
| `MessageTooBig` | payload 축소(본문 단축). 발생 시 로그·코드 수정 대상 |
| `MessageRateExceeded` | 지수 백오프 재시도 |
| `MismatchSenderId` / `InvalidCredentials` | 자격증명/`google-services` 점검 — 운영 경고(전체 발송 실패) |
| 요청단 `PUSH_TOO_MANY_NOTIFICATIONS`/`_RECEIPTS` | 배치 크기 위반 → 100/1000으로 분할 |

## Webhook 최적화 (검증된 권장 — Phase 1엔 폴백 보유, → ADR-015)

- `Mutation.registerTrackWebhook(carrierId, trackingNumber, callbackUrl, expirationTime)`로 등록. `callbackUrl=/webhooks/track`.
- 변화 시 tracker.delivery가 `{carrierId, trackingNumber}` POST → **1초 내 202** 반환, 실제 `track` 조회는 비동기(큐 패턴 권장).
- **24h마다 재등록 sweep**(만료 `expirationTime`을 48h 앞으로) — cron의 별도 due 작업. `webhook_expires_at` 컬럼 기준.
- **콜백 보안**: 추측 불가한 시크릿 경로 + (가능 시) 서명 검증. 미인증 콜백은 조용히 `401`/무시.
- **폴백**: webhook 미수신/실패/Free 미지원 시 폴링이 그대로 안전망. webhook은 **월 쿼터 절감 아님**(고유-번호 과금) — 이득은 신선도·subrequest.

## 동시성 & 원자성

- **dedupe race**(동시 같은 송장 등록): `INSERT ... ON CONFLICT(carrier, tracking_no) DO NOTHING` 후 SELECT, 또는 D1 batch로 원자 처리.
- **알림 멱등**: `last_normalized_status` **compare-and-set**(UPDATE ... WHERE last_normalized_status = <이전>)으로 단계 전환을 원자 갱신 → 중복/경쟁 실행에도 1회만 발송.
- **cron 중복**: `last_polled_at` 선점 갱신(ADR-012).
- D1은 단일 리전 SQLite라 강한 일관성. 여러 statement는 `db.batch()`로 묶는다.

## 데이터 수명주기 & 만료

| 트리거 | 동작 |
|---|---|
| `배송완료` 감지 | 알림 발송 → **보관**(`active=0` 재폴링 중단, 레코드 유지) → **사용자가 수동 삭제**(ADR-005 개정). 자동 삭제는 옵트인 설정으로 다음 phase(`docs/ROADMAP.md`) |
| 미등록 7일 / 예외 7일 | 자동 비활성(`active=0`) + 안내 |
| 등록 30일 경과(완료/예외 아님) | 강제 비활성 + "분실 의심" 알림 |
| 마지막 구독 DELETE | orphan shipment(구독 0) 정리 |
| `DeviceNotRegistered` | push_token 삭제, device 정리 |
| 사용자 "모든 데이터 삭제"(`DELETE /me`) | device + 구독(CASCADE) + 푸시 토큰 + **알림 기록(`notifications` device_id)** 폐기, orphan 송장 정리 (→ ADR-017, 스토어 정책) |
| **(v1.1)** 알림 기록 보존 만료 | cron sweep — `sent_at < now-90일`(또는 디바이스당 상한 초과 오래된 행) 삭제 (→ ADR-023) |
| **(v1.1)** 휴지통 30일 경과 | **로컬** 자동 영구 삭제(`pruneTrash`, 앱 진입·휴지통 열람 시) — 서버 무관(이미 구독 해제) (→ ADR-022) |

## v1.1 마이너 업데이트 — 데이터·흐름·마이그레이션·엣지

> 기획 `PRD.md` "v1.1 …", 결정 `ADR.md` ADR-021~025, 화면 `UI_GUIDE.md`. 핵심 불변: **서버 SOT·앱은 캐시/로컬 전용 데이터**(ADR-014), **비영속·$0**. 신규 서버 표면은 `notifications` 테이블 + `GET /notifications` **단 하나**다(나머지는 전부 클라이언트).

### 네비게이션 / 화면 추가
- 하단 탭 **3개**: **대시보드 · 택배함 · 설정**(대시보드 신규·좌측). 콜드스타트 초기 탭은 "시작 화면" 로컬 preference(기본 택배함, ADR-025).
- 탭 위 Stack push 화면: 기존(상세·등록·온보딩·개인정보처리방침) + **알림 기록(`/notifications`)** · **휴지통(`/trash`)**.
- **헤더 알림 종 + 미읽음 배지**(택배함·대시보드). 대시보드 카드 → 각 화면(택배함은 필터 프리셋 포함).

### 로컬 스토어 (서버 미전송 — AsyncStorage)
| 스토어 | 키 | 형태 | 용도 |
|---|---|---|---|
| 택배 정보 | `unboxing.shipment_info`(v2) | `Record<shipmentId, { memo?, category?, amount? }>` | 메모+카테고리+금액(ADR-024). 구 `unboxing.memos`에서 1회 마이그레이션 |
| 휴지통 | `unboxing.trash` | `Record<"carrier:tracking_no", { carrier, trackingNo, status, createdAt, statusChangedAt, info?, deletedAt }>` | 소프트 삭제 스냅샷(ADR-022). 키=dedupe 키 |
| 알림 읽음 | `unboxing.notif_last_seen` | `number`(epoch ms) | 미읽음 = `sentAt > lastSeen` 수(ADR-023) |
| 시작 화면 | `unboxing.home_screen` | `"list" \| "dashboard"` | 기본 `"list"`(ADR-025) |
| 택배함 필터 | `unboxing.list_filter` | `{ hideCompleted: boolean }` | "완료 숨기기"만 지속(상태 칩은 세션 UI 상태) |

- 모두 `KeyValueStore` 주입(결정적 테스트)·`cacheStore` 재사용(키만 다름) — 기존 `memo.ts`/`cache.ts` 패턴.
- "모든 데이터 삭제"(`wipeAllData`)는 위 **로컬 스토어 전부 + 서버 `DELETE /me`**를 폐기.

### 데이터 흐름 (신규)
```
[삭제] 스와이프 2단계/버튼/일괄 → 확인 다이얼로그 → 확인 시 DELETE /shipments/:id(구독 해제) + 로컬 휴지통 적재(스냅샷+info)
[복구] 휴지통 → POST /shipments(carrier,tracking_no) 재등록(멱등 dedupe + 즉시 track) → info 라이브 복원 → 휴지통 항목 제거
[영구삭제] 휴지통 항목 + info 스냅샷 로컬 제거(서버 호출 없음 — 이미 구독 해제)
[수정] 상세 "수정"에서 택배사·번호 변경 → POST /shipments(새 carrier,번호)[먼저] → info old_id→new_id 이관 → DELETE old_id → 새 상세 (새 엔드포인트 없음·ADR-027. 같은 조합이면 no-op, 이미 추적 중이면 그 상세로)
[알림 기록] cron 전환 푸시 발송 시(+조용시간 flush 시) notifications INSERT(device_id별) → 앱 GET /notifications → 로컬 캐시·표시
[대시보드] GET /shipments(또는 캐시) → dashboardCounts(목록) + 휴지통 수 + 미읽음 수(로컬)
```

### 알림 기록 write 지점 (서버)
- cron 알림 fan-out(`subscriberTokens` 경유)에서 **실제 발송되는 (device_id, shipment_id, 메시지)별로 `notifications` 1행 INSERT**. 음소거(ADR-020) 구독은 fan-out에서 빠지므로 기록도 안 생김(일관).
- 조용시간 보류(`notification_queue`)분은 **flush(실제 발송) 시점**에 기록(적재 시점 아님 — 사용자가 받는 시점 기준).
- title/body는 `buildMessage`와 동일 소스(`carrier`·`last4`·`stage`·`body`). 표시용 택배사 **한글명 변환은 앱**에서(서버는 carrierId 저장 — 이슈 `#9`와 동일 원칙). `ctx.waitUntil`로 푸시 경로에 묶어 비동기 완료.

### 마이그레이션 (꼼꼼히)
**D1 (서버):**
- `notifications` 테이블 — `CREATE TABLE IF NOT EXISTS`(+인덱스 `IF NOT EXISTS`)라 `schema.sql` 재실행으로 **자동 생성**(notification_queue와 동일 — RENAME·ADD COLUMN 함정 없음). `src/schema.ts SCHEMA_STATEMENTS`도 1:1 동기화. 적용 절차·확인은 구현 step에서 `docs/ENGINEERING.md` B에 추가.
- 파괴적 변경 없음(신규 테이블만). 구버전 서버에 `GET /notifications` 호출 시 `404` → 앱이 빈 목록으로 graceful(아래 에러 처리).

**로컬 AsyncStorage (앱) — 메모 → 택배 정보:**
- 구 `unboxing.memos`(`Record<string,string>`) → 신 `unboxing.shipment_info`(`Record<string, {memo?,category?,amount?}>`).
- **1회·멱등·무손실**: 신 키가 있으면 그대로 사용; 없고 구 키가 있으면 `{ [id]: text }` → `{ [id]: { memo: text } }`로 변환·신 키 기록 후 구 키 제거. 손상 JSON·비객체는 빈 객체로 안전 처리(기존 `loadMemos` 규칙 유지). 변환은 순수 함수(`migrateMemosToInfo`)로 분리해 단위 테스트.
- `defaultMemoText`·카드/타이틀 표시 규칙은 불변(회귀 금지 — UI_GUIDE). 단방향(구버전 롤백 호환 미보장 — 데이터 저민감).
- 신규 로컬 키(휴지통·읽음·시작화면·필터)는 기본-빈값이라 마이그레이션 불필요.

### 동시성 & 멱등
- **알림 기록**: 전환 푸시는 CAS로 정확히 1회(기존) → 기록도 1행. cron 재실행/중복 발송 방어가 그대로 기록 중복을 막는다(`id`=UUID, 발송 단위 1행).
- **휴지통 복구 재등록**: `POST /shipments`의 dedupe·멱등(기존 구독이면 200)로 안전. orphan 정리로 행 id가 바뀌어도 키가 `(carrier,tracking_no)`라 무영향.
- **수동 재등록 vs 휴지통**: 사용자가 휴지통과 별개로 같은 `(carrier,tracking_no)`를 등록하면 등록 성공 시 휴지통에서 그 키를 제거(중복 표시 방지).

### v1.1 추가 (2026-06-23): 식별자 수정 (재등록) · 택배사 자동선택
> 상세 "수정"에서 택배사·운송장번호 편집(ADR-027) + 등록 택배사 자동선택 정책(ADR-026). 새 서버 엔드포인트 없음 — 기존 `POST`/`DELETE` 재사용.

**식별자 수정 = 재등록 (서버 행 PATCH 아님 — ADR-027):**
- 흐름: 상세 헤더 **연필("수정")** → 모달에서 택배사·번호 편집(택배사 선택은 등록 화면과 동일 컴포넌트·정책 재사용) → 저장 시 `POST /shipments(새 carrier, 새 tracking_no)` → 반환 `shipment.id` 로 **info(메모·카테고리·금액) old_id→new_id 이관** → `DELETE /shipments/{old_id}` → 새 상세로 교체 진입.
- **순서 = 등록-먼저·삭제-나중**(중간 실패 시 기존 구독 보존 — 휴지통 삭제의 "스냅샷 먼저"와 동형). 등록 실패(429/409/NETWORK)면 기존 송장·구독 그대로 두고 안내, 삭제 안 함.
- **no-op**: 새 `(carrier,tracking_no)`가 기존과 동일하면 호출 없이 닫는다.
- **이미 추적 중**(POST 가 dedupe hit 으로 사용자가 이미 가진 다른 송장 id 반환): 새 구독 만들지 않고 "이미 추적 중인 운송장" 안내 후 그 상세로 이동(old 송장은 사용자 판단으로 유지/삭제 — 자동 삭제하지 않음).
- **info 이관**: `setInfo(new_id, getInfo(old_id))` 후 `old_id` 엔트리 제거. info 키는 `shipment.id`라 number/carrier가 바뀌어도 id 이관으로 보존(휴지통 복구의 info 복원과 동일 원리). 휴지통 스냅샷(키=`carrier:tracking_no`)은 수정 경로와 무관 — 갱신하지 않는다.
- **폴링/타임라인**: 새 번호는 등록 즉시 1회 track + 이후 cron 폴링(새로 시작). 옛 번호 타임라인은 이어지지 않음(잘못된 번호였으니 의도와 일치). 옛 번호의 `notifications` 기록은 서버 `ON DELETE SET NULL`로 보존(딥링크만 비활성).

**택배사 자동선택 정책 (ADR-026):**
- `estimateCarriers(trackingNo)` 후보 **길이 ≥ 2 → 자동선택 없음**(`picked=null` 유지), UI는 "택배사를 선택하세요" + 드롭다운 펼침으로 명시 선택 유도. **길이 == 1 → 자동선택**. 추정 불가(빈 배열) → 전체 목록에서 수동 선택.
- 등록/수정 **공통 컴포넌트**(택배사 선택 UI)로 같은 정책 적용. 등록 버튼·수정 저장은 택배사 미선택 시 비활성.

### 엣지 케이스 (계층별)
| 영역 | 케이스 | 처리 |
|---|---|---|
| 휴지통 | 복구 재등록이 `429`(레이트/상한) | 순차 복구·실패분 유지 + 안내("잠시 후 다시"), 휴지통에 그대로 둠 |
| 휴지통 | 복구 시 `409 CARRIER_UNSUPPORTED`(지원 목록 변경) | 안내 + 항목 유지(딥링크 폴백 안내) |
| 휴지통 | 같은 키 수동 재등록됨 | 등록 성공 시 휴지통 키 제거 |
| 휴지통 | 30일 경과 | 로컬 자동 영구 삭제(서버 호출 없음) |
| 알림 | 딥링크 대상 송장 삭제/정리됨 | `shipment_id` NULL 또는 상세 `404` → "정리된 택배" 안내, 목록 표시는 유지(denormalize) |
| 알림 | 토큰 양도(재설치) | `notifications`는 device_id 키라 교차 누설 없음 |
| 알림 | `lastSeen` 미설정(첫 실행) | 전부 미읽음 취급 또는 첫 동기화 시 `now`로 초기화(택1·문서화) |
| 정보 | 손상 JSON / 부분 필드 / 레거시 문자열 | 빈 객체·필드 누락 graceful, 마이그레이션이 흡수 |
| 정보 | 금액 음수·비정수·과대·빈문자 | `parseAmount`로 검증(0 이상 정수만 저장, 그 외 미저장) |
| 정보 | 카테고리 미설정/목록 외 값 | 미설정=칩 없음(의사값 없음), 목록 외 레거시 값도 표시는 허용(보강 ⑥) |
| 수정 | 새 `(carrier,번호)` == 기존 | no-op(호출 없이 닫음) |
| 수정 | 등록 실패(`429/409/NETWORK`) | 기존 송장·구독 그대로 유지, `DELETE` 안 함, 안내(ADR-027) |
| 수정 | 등록(POST) 성공·삭제(DELETE) 실패 | 새 구독은 생김, 옛 구독만 남음 → 다음 sync/재시도에서 옛 id `DELETE` 재시도(중복 보이면 수동 삭제 가능) |
| 수정 | 새 조합이 이미 추적 중(dedupe hit) | 새 구독 안 만들고 "이미 추적 중" 안내 + 그 상세로 이동, 옛 송장 자동 삭제 안 함 |
| 등록/수정 | 택배사 추정 후보 ≥2 | 자동선택 안 함 — 드롭다운 명시 선택 유도, 미선택 시 등록/저장 비활성(ADR-026) |
| 대시보드 | 오프라인 | 캐시 목록으로 집계(ADR-014), 신선도 표기 |
| 대시보드 | 다른 탭/기기에서 삭제·등록됨 | 포커스 복귀·당겨서 새로고침 시 목록 기준 **재집계**(낙관 변경도 반영) |
| 휴지통 | 기기 시계 변경/오차 | `deletedAt`·만료는 **로컬 시각** 기준 — 시계 급변 시 30일 경계 어긋날 수 있음(로컬 편의 기능이라 허용·문서화) |
| 알림 | 송장 orphan 삭제 시 보류 큐 | `notification_queue` FK `ON DELETE CASCADE` 로 보류분 자동 정리(기존). `notifications` 는 SET NULL(이력 보존) |
| 필터 | 결과 0건 | "조건에 맞는 택배가 없어요" 안내(빈 목록과 구분) |

### v1.1 설계 보강 (확정 정의 — 갭 해소)

> 1차 설계의 모호/누락을 확정한다. 대시보드·필터·알림·휴지통이 같은 정의를 쓰도록 **단일 출처**를 둔다.

**① 단계→버킷 단일 출처 (대시보드 카드 = 필터 칩 = 동일 정의):**

| 버킷 | 정의(`status` 기준, 8단계 중) | 비고 |
|---|---|---|
| **진행 중** | `미등록`·`등록`·`집화`·`이동중`·`배송출발`·`기타` | `active` 무관(정지·분실의심도 "아직 안 끝남"). `배송완료`·`예외` 제외 |
| **임박** | `배송출발` | **진행 중의 하이라이트 부분집합**(별도 배타 버킷 아님). 필터 칩 전용 포커스 뷰 |
| **완료** | `배송완료` | |
| **예외** | `예외` | `active` 무관 |

- 진행 중·완료·예외 셋은 **8단계 전수를 배타·망라**(`임박`만 진행 중과 겹침). 구현은 순수 함수 `stageBucket(stage)` 하나로 두고 `dashboardCounts`·`filterShipments`가 공유(드리프트 금지). 대시보드 카드=진행중/완료/예외(+휴지통·새알림), 필터 칩=전체/진행중/임박/완료/예외.
- **필터 우선순위**: "완료 숨기기"(지속 토글) ON은 `전체`·`진행 중` 뷰에서 `배송완료`를 뺀다. 단 **`완료` 칩을 명시 선택하면 그 토글을 무시하고 완료를 보여준다**(명시 선택 우선). 대시보드 카드→택배함 진입은 route param 으로 칩 프리셋 전달.

**② 알림 로깅 시점·멱등 (ADR-023 구체화):**
- 로깅 단위 = **전환 CAS 승리 후 fan-out 에서 실제 메시지가 만들어지는 (device_id, shipment) 쌍**. fan-out 은 `subscriptions`(device_id)⋈`devices`(token)를 돌므로 device_id 를 바로 안다 → `notifications` 1행. 전환 CAS 가 전환당 fan-out 1회를 보장하므로 **재독·중복 cron 에도 중복 로깅 없음**.
- **send 재시도(MessageRateExceeded 등)는 재로깅하지 않는다** — 로깅은 메시지 구성(fan-out) 시점 1회, send HTTP 재시도 루프와 분리. (트레이드오프: 최종 전달 실패[DeviceNotRegistered]분도 "발송 시도"로 기록될 수 있음 — 드물고 무해, 단순성 우선.)
- **조용시간 보류분**: `notification_queue` 는 token 키 스냅샷 → **flush(실제 발송) 시점에 로깅**, device_id 는 그 token 의 현재 소유자로 해석. token 이 양도됐으면 보류분은 steal 시 이미 정리(F3)되어 flush·로깅 안 됨(교차 누설 없음).
- **best-effort(에러 격리)**: `notifications` INSERT 실패는 **푸시 발송·전환 CAS 를 막지 않는다** — 로깅은 부수효과라 try/catch + `ctx.waitUntil` 로 격리(로깅 실패로 알림이 안 가면 더 나쁨).
- **운송장 삭제와 독립**: 단건 삭제(구독 해제)는 서버 `notifications` 를 지우지 **않는다** — 받은 알림 이력은 90일/상한/`DELETE /me` 로만 정리. `shipment_id` 는 송장 정리 시 `SET NULL`(이력·표시는 유지, 딥링크만 무효). 개인정보처리방침에 이 보존을 명시(QA D절·PRIVACY_POLICY §6).

**③ 콜드스타트 라우팅 우선순위 (ADR-025 구체화):**
- ① **알림 탭으로 콜드스타트**(`getLastNotificationResponseAsync`) → 해당 상세 딥링크가 **최우선**. ② 아니면 "시작 화면" preference(택배함/대시보드). ③ preference 미로드/실패 → 택배함. 딥링크가 항상 시작 화면 설정을 이긴다.

**④ 휴지통 정합성 (ADR-022 구체화):**
- 삭제 확정 시 순서: 라이브 info 읽기 → **휴지통에 스냅샷(키 `carrier:tracking_no`, info 포함) 기록** → 서버 `DELETE` → (다음 sync 의 `pruneMemos` 가 라이브 info 정리). 스냅샷이 prune 보다 **먼저**라 info 유실 없음.
- **sync reconciliation**: 서버 목록에 다시 나타난 `carrier:tracking_no`(수동 재등록·타 기기 복구)는 휴지통에서 제거(중복 표시 방지).
- **복구**: `POST /shipments` 성공 시 info 를 **반환된 shipment.id 로** 라이브 복원(orphan 정리로 id 가 바뀌어도 정확) → 휴지통 항목 삭제. 실패(429/409/오프라인 NETWORK)는 항목 유지 + 안내(일괄은 실패분만 유지). **복구의 즉시 track 은 `prev==stored`(등록 직후 규칙)라 푸시·알림 기록을 만들지 않는다**(중복 알림 없음).
- `pruneTrash(now)` = bootstrap(앱 시작)·휴지통 열람 시 `deletedAt < now-30일` 영구 삭제. **용량 상한**(예 200건) 초과 시 오래된 것부터 정리(무한 증식 방지).

**⑤ 알림 읽음 첫 실행 (ADR-023 확정):**
- `lastSeen` 미설정 시 **첫 `/notifications` fetch 에서 `now` 로 초기화**(기존 기록이 한꺼번에 미읽음 배지로 폭주하는 것 방지). 이후 미읽음=`sentAt > lastSeen` 수. 알림 화면 열람 시 `lastSeen = max(now, 최신 sentAt)`. 배지 표시는 `99+` 상한.

**⑥ 카테고리·금액 규칙 (ADR-024 확정):**
- 카테고리: **선택**. **미설정 = 값 없음(기본·칩 없음)** — 별도 "미지정" 의사값을 두지 않는다. 고정 목록의 마지막 `기타`는 실제 catch-all 카테고리(미설정과 구분). 목록 외 레거시 값도 표시는 허용.
- 금액: **선택**, **0 이상 정수(원)**. 음수·비정수·빈값·상한 초과(예 ≥ 10^10)는 저장 안 함(인라인 안내). `parseAmount → number | undefined`.

**⑦ 마이그레이션 트리거 & wipe 커버리지:**
- `migrateMemosToInfo()` 는 **bootstrap 에서 1회**(목록·info 첫 읽기 전) 멱등 실행. 신규 로컬 키(휴지통·읽음·시작화면·필터)는 기본-빈값이라 트리거 불필요.
- `wipeAllData` 는 **신규 로컬 키 전부**(`shipment_info`·`trash`·`notif_last_seen`·`home_screen`·`list_filter`) + 기존(cache·device_id·memo 잔여) + 서버 `DELETE /me`(→`notifications` 정리)를 폐기. 누락 시 잔존 데이터 — 회귀 금지.

## 보안 & 공개 API 남용 방어

- **시크릿**: tracker.delivery 자격증명·서명키는 `wrangler secret`. 코드/로그/리포지토리에 평문 금지.
- **입력 검증 + prepared statements**: 모든 D1 쿼리 파라미터 바인딩(SQLi 차단). 운송장/택배사 형식 검증(`app/src/lib/tracking.ts` 규칙과 서버 재검증).
- **device_id**: 로그 금지, 충분한 엔트로피.
- **남용 방어 (→ ADR-008)**: 서버측 **silent throttle**(디바이스/IP별 등록 레이트) + **디바이스당 활성 송장 상한**(예 100) → 초과 `429`. CAPTCHA 없음(마찰 최소). 지속 공격 시 Cloudflare WAF/Turnstile를 Phase 2 에스컬레이션.
- **존재 누설 최소화**: `:id` 미소유 접근은 정책에 따라 `403` 또는 `404`로 통일(택1, 일관 적용).

## 환경변수 & 시크릿 (단일 출처)

> 모든 설정값의 정본. 코드/문서에 값을 흩지 말고 이 표를 기준으로 한다. **secret은 repo·코드·로그에 평문 금지**(보안 섹션). 새 secret/var 추가 시 이 표를 먼저 갱신하고 `Env`/설정을 맞춘다.

### Worker (Cloudflare)

| 이름 | 종류 | 등록 위치 | 용도 | 상태 |
|---|---|---|---|---|
| `DB` | binding (D1) | `wrangler.toml [[d1_databases]]` | 송장·구독·푸시토큰 저장 | 필수 |
| `DELIVERY_TRACKER_CLIENT_ID` | secret | `wrangler secret put`(prod) · `.dev.vars`(local) | tracker.delivery client_credentials | 필수 |
| `DELIVERY_TRACKER_CLIENT_SECRET` | secret | 〃 | 〃 | 필수 |
| `EXPO_ACCESS_TOKEN` | secret | `wrangler secret put` | Expo Push 서버 발송 인증 — Enhanced Security 활성화 시 **필수**(권장, → ADR-010) | 선택(권장) |
| `WEBHOOK_SIGNING_SECRET` | secret | `wrangler secret put` | `/webhooks/track` 콜백 서명 검증(+추측불가 경로, → ADR-015) | Phase1 선택(webhook 도입 시) |
| `DEMO_TRACKING_NUMBER` | var (비밀 아님) | `wrangler.toml [vars]` 또는 코드 상수 | 심사용 데모 분기(실폴링 우회, → ADR-019) | 선택 |

- **로컬 dev**: `worker/.dev.vars`(KEY=VALUE)에 위 secret을 둔다. **gitignore됨 — 커밋 금지.** Vitest(`@cloudflare/vitest-pool-workers`)도 `.dev.vars`를 읽는다.
- `Env` 인터페이스(`worker/src/index.ts`)를 이 표와 일치시킨다. 미구현 기능의 secret(`EXPO_ACCESS_TOKEN` 등)은 해당 기능 구현 step에서 `Env`에 추가한다.

### App (Expo)

| 이름 | 종류 | 등록 위치 | 용도 | 상태 |
|---|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | 공개 env (빌드 시 번들 인라인) | `app/.env*`(local) · EAS env(빌드/배포) | Worker 베이스 URL(예: `https://unboxing-worker.<acct>.workers.dev` 또는 커스텀 도메인). 앱의 모든 API 호출 기준 | 필수 |

- **`EXPO_PUBLIC_` 접두어**는 Expo가 클라이언트 번들에 인라인하는 공개 변수다(SDK 49+) → **어떤 비밀도 넣지 않는다**(디컴파일로 노출). Worker URL은 공개라 무방.
- 환경 분리(dev/prod)를 위해 `app/.env.local`은 gitignore 권장. 앱에서 URL은 하드코딩하지 말고 이 변수로 주입.
- `device_id`는 환경변수가 아니라 **앱 최초 실행 시 생성 → Keychain/Keystore 보관**(디바이스 식별 섹션). env로 다루지 않는다.

## 에러 처리 매트릭스 (전 계층 — 누락 금지)

### 앱(클라이언트)
| 상황 | 처리 |
|---|---|
| 네트워크 오프라인 | 로컬 캐시로 목록/마지막 상태 표시 + 오프라인 배너. 변경은 차단·안내 |
| 등록 API 실패(5xx/타임아웃) | 재시도 버튼 + 에러 토스트. 입력값 보존 |
| 푸시 토큰 발급 실패(Expo) | 등록·조회는 계속, "알림 비활성" 상태 표시 + 재시도 |
| 푸시 권한 거부 | 등록/조회 가능, 알림 불가 명시 + 설정 유도(재요청) |
| 잘못된/미지원 택배사 | 수동 드롭다운 / 미지원이면 딥링크 카드 |
| 클립보드 오탐 | 제안만(자동 등록 금지), 사용자가 확인 |
| (v1.1) 알림 기록 조회 실패(`GET /notifications` 404/5xx/오프라인) | 로컬 캐시 표시 + 조용히(코드 비노출). 구버전 서버 404는 빈 목록 |
| (v1.1) 휴지통 복구 실패(429/409/네트워크) | 항목 유지 + 안내, 일괄 복구는 부분 실패분만 남김 |
| (v1.1) 알림→상세 딥링크 대상 없음(404) | "정리된 택배예요" 안내(목록 항목은 유지) |
| (v1.1) 금액 입력 형식 오류 | 인라인 검증(0 이상 정수만), 그 외 저장 안 함·안내 |

### HTTP API
| 상황 | status·code |
|---|---|
| 잘못된 JSON/필드 누락 | `400 INVALID_BODY` |
| 형식 검증 실패(운송장 등) | `422 INVALID_TRACKING` |
| 미인증/잘못된 device_id | `401 UNAUTHORIZED` |
| 음소거 토글 바디 누락/`muted` 비-boolean (PATCH) | `400 INVALID_BODY` |
| 타인 리소스 접근 | `403 NOT_OWNER`(또는 통일 404) |
| 없는 리소스 | `404 NOT_FOUND` |
| 중복 등록 | `200`(멱등, 기존 반환) |
| 레이트리밋 초과 | `429 RATE_LIMITED` |
| 미지원 택배사 | `409 CARRIER_UNSUPPORTED`(딥링크 정보 포함) |
| upstream 타임라인 실패(GET 상세) | `200` + 캐시 상태(타임라인 생략) 또는 `502 UPSTREAM_ERROR` |
| (v1.1) `GET /notifications` 미인증 | `401 UNAUTHORIZED` |
| (v1.1) `GET /notifications` 정상 | `200 {notifications:[...]}`(이 device_id 행만, `sent_at DESC`, limit 적용) |

### cron / 외부 API (tracker.delivery)
→ 위 "tracker.delivery 에러 분류" 표 참조 (UNAUTHENTICATED 재인증 / NOT_FOUND 미등록 / 429·5xx·timeout 백오프 / 미매핑 `기타`).

### 푸시 (Expo)
→ 위 "푸시 에러 처리" 표 참조.

### Webhook
| 상황 | 처리 |
|---|---|
| 콜백 서명/시크릿 불일치 | 조용히 `401`, 처리 안 함 |
| 동일 콜백 중복 수신 | 멱등(같은 정규화 경로, compare-and-set) |
| 콜백 후 track 실패 | 폴링 폴백이 다음 due에 흡수 |
| webhook 만료 | 24h sweep이 재등록; 누락돼도 폴링이 폴백 |

## 관측성 & 로깅

- `wrangler tail`로 실시간 로그. 무료 범위 메트릭만(외부 APM 없음).
- **반드시 로깅**: 미매핑 status.code(매핑 보강용), 푸시 발송 실패/무효 토큰, upstream 에러율, 자격증명 만료 임박.
- **로깅 금지**: device_id, push_token, 수령인 등 개인정보.

## 스키마 진화 / 마이그레이션

- 스키마는 **idempotent**(`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`)로 작성, `wrangler d1 execute --file=schema.sql --remote`로 적용.
- 컬럼 추가는 `ALTER TABLE ... ADD COLUMN`(SQLite는 NOT NULL+DEFAULT 또는 nullable). 위 "예고 컬럼"을 구현 단계에서 단계적으로 추가.
- 파괴적 변경(컬럼 삭제/타입 변경)은 SQLite 제약상 테이블 재생성 필요 → Phase 1 데이터는 저민감(운송장·택배사·상태, 수령인 PII 없음)·사용자 삭제 가능이라 영향 작음.
- **(v1.1)** `notifications` 테이블은 `CREATE TABLE/INDEX IF NOT EXISTS`라 `schema.sql` 재실행으로 자동 생성(RENAME·ADD COLUMN 함정 없음). **로컬 메모→택배 정보 마이그레이션**은 AsyncStorage에서 1회·멱등 수행 — 상세는 위 "v1.1 … 마이그레이션" 참조. 적용/확인 절차는 구현 step에서 `docs/ENGINEERING.md` B에 추가.

## 테스트 전략

(요약은 CLAUDE.md `## 개발 프로세스`.)

### 도구
- `app/`: **jest-expo** + (컴포넌트 단계에서) React Native Testing Library. 테스트는 `@jest/globals`에서 import.
- `worker/`: **Vitest + `@cloudflare/vitest-pool-workers`** — workerd 런타임 + wrangler.toml 바인딩(D1). config `vitest.config.mts`(ESM). **v4 주의**: `defineWorkersConfig`(`/config`) 제거 → `vitest/config`의 `defineConfig` + `cloudflareTest()` 플러그인.

### 우선순위
- **필수(순수 로직)**: 상태 정규화 매핑(전수 + 미매핑→`기타`), 알림 트리거·멱등(`이동중` 무알림·재독 무발송·compare-and-set), 폴링 due 계산, 만료 정책, 운송장 검증.
- **권장(통합)**: HTTP API + D1 — 등록 dedupe·멱등·**인가(타인 리소스 403/404)**·목록·삭제·throttle(429), 푸시 receipt 처리(무효 토큰 정리), webhook 콜백 멱등.
- **(v1.1) 필수(순수 로직)**: `stageBucket`(단계→버킷 **단일 출처** — 전수·배타·망라 검증), 이를 쓰는 `dashboardCounts`·`filterShipments`(완료숨김 vs 명시 `완료` 칩 **우선순위**), `pruneTrash`(30일·`now` 주입·용량 상한)·휴지통 add/restore(반환 id 귀속)/permanent/reconcile, `migrateMemosToInfo`(구→신·멱등·손상안전)·정보 set/get, `parseAmount`(0이상 정수·경계 거부), 미읽음 수(`lastSeen` 미설정 시 `now` 초기화), 콜드스타트 라우팅 우선순위(딥링크 > 시작화면).
- **(v1.1) 권장(통합)**: 워커 — 전환 푸시 시 `notifications` 1행 기록(**fan-out 시점 1회·send 재시도 무중복**·음소거 제외·flush 시점), `GET /notifications`(인증·`device_id`별·정렬·limit), `DELETE /me`가 `notifications` 정리, 보존 sweep(90일/상한), 송장 삭제 시 `shipment_id` SET NULL. 앱 — 대시보드/휴지통/알림/정보 모달 렌더·api mock(jest-expo).
- **보류(Phase 2)**: 앱 화면 컴포넌트 E2E(Maestro), 가계부 서버 집계.
- **(v1.1) 상세 테스트 케이스·에러 케이스 카탈로그·실호출 스모크는 `docs/QA.md` E절**(구현 착수 전 사전 설계 — Harness TDD 가 빨간 테스트로 먼저 소비).

### 방식
- 핵심 로직 **test-first**. 외부 의존(tracker.delivery·Expo Push)은 **mock**(실제 호출 금지). 시간 의존은 `now` 주입(고정 시계). 강제 커버리지 숫자 없음, 단 "필수"는 비어 있으면 안 됨.

### 위치 / CI / 명령
- 유닛: 소스 옆 `*.test.ts`. Worker 통합: `worker/test/*.test.ts`(`cloudflare:test`의 `SELF`·`env`).
- CI: `.github/workflows/ci.yml`가 push/PR마다 `npm run verify`.
- 전체 `npm run verify` / 개별 `npm --prefix app test` · `npm --prefix worker test`.
