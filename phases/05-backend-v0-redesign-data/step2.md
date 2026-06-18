# Step 2: recipient-passthrough — 상세 페이지 수취인 정보(화면 전용·미저장)

배송 상세 페이지에 **수취인 정보**를 보여주기 위한 백엔드다. **CRITICAL(ADR-005)**: 수령인 이름·연락처·주소는 **D1에 절대 저장하지 않는다.** 실시간 track 응답에서 `GET /shipments/:id` 응답으로 **그대로 패스스루만** 한다(화면 표시 후 폐기). 상품명·사진은 tracker.delivery 스키마에 존재하지 않으므로 다루지 않는다.

> **GraphQL 스키마는 실측(introspection)으로 확정됨.** `track(...)` 반환 타입 `TrackInfo` 의 필드: `trackingNumber`, `lastEvent`, `events`, `sender`(ContactInfo), `recipient`(ContactInfo). `ContactInfo` = `{ name: String, phoneNumber: String, location: Location }`, `Location` = `{ countryCode, postalCode, name }`. 아래 쿼리 필드명은 이 실측 스키마와 정확히 일치해야 한다. (상품명·사진 필드는 스키마에 **없음** — 넣으면 GraphQL 에러.)

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-005(수령인 정보 비영속 — CRITICAL)**, ADR-011(타임라인 미저장), ADR-013(토큰 캐시), ADR-019(데모 경로)
- `/docs/ARCHITECTURE.md` — "tracker.delivery 연동", "HTTP API 계약"(GET /:id), "에러 분류 → 처리", "데모/리뷰 경로", "관측성 & 로깅"(수령인 로깅 금지)
- `/docs/ENGINEERING.md` — 외부 경계 실호출 검증 규칙(머지 전 실 운송장 스모크 필수)
- `worker/src/tracker.ts` — `TRACK_QUERY`, `TrackResult`, `TrackEvent`, `RawEvent`, `toEvent`, `track`, `demoResult`, `TrackQueryData`
- `worker/src/index.ts` — `handleGetShipment`, `tryTrack`, `serializeShipment`
- `worker/src/tracker.test.ts`, `worker/test/api.test.ts`
- step 1 결과(`muted`) — `handleGetShipment` 응답에 muted 가 추가됐을 수 있으니 읽고 충돌 없이 합쳐라.

## 작업

### 1. tracker.ts — track 쿼리에 recipient(선택 sender) 추가
- `TRACK_QUERY` 의 `track(...)` 선택에 추가(필드명 실측 일치):
  ```graphql
  recipient { name location { name } }
  ```
  - `phoneNumber` 는 받지 않는다(불필요한 PII 최소화 — 표시 가치 낮고 위험만 큼).
  - `sender` 는 받지 않아도 된다(상세 표시는 recipient 중심). 받더라도 §3에서 응답·로그·D1에 넣지 마라.
- 타입 추가:
  - `export interface Contact { name?: string; regionName?: string }` (`regionName` = `location.name`)
  - `TrackResult` 에 `recipient?: Contact` 추가.
  - `TrackQueryData.track` 타입에 `recipient` 추가.
- 파싱 헬퍼 `toContact(raw): Contact | undefined` — `name`/`location.name` 둘 다 비면 `undefined`.
- `track()` 에서 `data.track?.recipient` 를 `toContact` 로 매핑해 `TrackResult.recipient` 에 담는다.

### 2. demoResult — 데모 경로에도 캔드 수취인
- 심사/데모 번호가 상세에서 수취인 영역을 보여줄 수 있도록 `demoResult(now)` 가 `recipient: { name: "홍**", regionName: "서울 강남" }` 같은 **마스킹된 캔드 값**을 반환하게 한다(실 PII 아님).

### 3. index.ts — GET /shipments/:id 응답에 recipient 패스스루
- `handleGetShipment` 에서 `tryTrack` 결과의 `recipient` 를 응답에 포함:
  - `recipient: result?.recipient ?? null` 을 응답 JSON에 추가(`{ shipment, timeline, recipient }`).
  - `tryTrack` 이 null(자격증명 없음·외부 실패·502)일 때 `recipient` 는 `null` — 앱이 graceful 처리(섹션 숨김). timeline 이 `[]` 인 기존 동작과 일관.
- **D1에 recipient/sender 를 INSERT/UPDATE 하는 코드를 절대 추가하지 마라.** 응답 JSON에만 실어 보낸다. shipments 스키마는 불변(recipient 컬럼 추가 금지).

### 4. 문서 갱신 (변경되는 서버 사양)
- `/docs/ADR.md` ADR-005 본문(또는 개정 노트)에 한 줄: 수취인 정보는 `GET /shipments/:id` track **패스스루(화면 전용·미저장)** — 본 ADR 핵심(비영속)과 일관. phoneNumber 는 받지 않음.
- `/docs/ARCHITECTURE.md` "tracker.delivery 연동" 의 `track(...)` 설명에 `recipient`(이름·지역명) 반환 추가. "HTTP API 계약" `GET /shipments/:id` 성공 응답에 `recipient` 추가(미저장 명시).
- `/docs/ENGINEERING.md` 한 줄: 수취인은 GET /:id track 패스스루(미저장, ADR-005), phoneNumber 미수신, 로그 금지.

### 5. 테스트
- `tracker.test.ts`: mock GraphQL 응답에 `recipient { name location { name } }` 있을 때 `track()` 결과 `recipient.name`/`regionName` 매핑. recipient 없거나 빈 값이면 `undefined`. 데모 번호는 캔드 recipient 반환.
- `api.test.ts`:
  - `GET /shipments/:id` 응답에 `recipient` 포함(mock track).
  - `tryTrack` 실패/자격증명 없음 → `recipient: null`.
  - **D1 비저장 보장**: shipments 테이블에 recipient 관련 컬럼이 없고(스키마 불변), 상세 조회 후에도 어떤 INSERT/UPDATE에도 수령인 값이 들어가지 않음(저장 경로 부재).

## Acceptance Criteria

```bash
npm run verify
```

> 주의(worker CLAUDE.md): mock verify green 은 순수 로직만 보증한다. GraphQL 쿼리 필드 변경은 외부 경계라 **머지 전 실 운송장으로 상세 조회 스모크 1회**가 필요하다(recipient 가 실제로 채워지는지·마스킹 형태 확인). 이 스모크는 사람이 수행한다 — step에서 실 네트워크 호출을 하지 마라(테스트는 mock).

## 검증 절차
1. 위 AC 실행.
2. 체크리스트: recipient 가 D1 어디에도 저장되지 않음(ADR-005 CRITICAL) / 쿼리 필드명이 실측 스키마와 일치(상품·사진 필드 없음) / phoneNumber 미수신 / 로그에 수령인 미기록 / tryTrack 실패 시 recipient=null / ADR-005·ARCHITECTURE·ENGINEERING 문서 갱신 / 기존 테스트 무파손.
3. `phases/05-backend-v0-redesign-data/index.json` step 2 업데이트.

## 금지사항
- recipient/sender 를 D1 어떤 테이블에도 저장하지 마라(ADR-005 CRITICAL). track 응답 → HTTP 응답 패스스루만.
- 로그/에러 메시지에 수령인 이름·지역을 남기지 마라(ARCHITECTURE 관측성).
- 상품명·사진 등 스키마에 없는 필드를 쿼리에 넣지 마라(GraphQL 에러 유발). 이유: TrackInfo/TrackEvent 에 해당 필드 없음(실측).
- 실 네트워크 호출을 step 내에서 하지 마라 — 테스트는 주입 mock fetch.
- 기존 테스트를 깨뜨리지 마라.
