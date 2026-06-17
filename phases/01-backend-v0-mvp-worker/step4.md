# Step 4: tracker-client (tracker.delivery GraphQL 클라이언트)

tracker.delivery Tracking API(GraphQL) 클라이언트. access token 캐싱 + 데모 분기 포함. 외부 호출은 **주입된 `fetch`** 로 하여 mock 테스트한다. 실제 네트워크 호출 금지.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — "tracker.delivery 연동", "에러 분류 → 처리" 표, "데모/리뷰 경로"
- `/docs/ADR.md` — ADR-013(토큰 캐싱·21일 자격증명), ADR-019(데모 경로)
- `/Users/jinni/Developments/unboxing/worker/src/index.ts` — `Env`(client_id/secret, DEMO_TRACKING_NUMBER)
- `/Users/jinni/Developments/unboxing/worker/src/schema.ts` — step0의 `tracker_token` DDL
- `/Users/jinni/Developments/unboxing/worker/src/lib/polling.ts` — `Stage`(여기선 직접 안 써도 됨, 참고)

## 작업

`worker/src/tracker.ts` 와 `worker/src/tracker.test.ts` 를 만든다.

### 타입

```ts
export interface TrackEvent {
  time: string;            // ISO 시각
  statusCode: string | null; // 원문 status.code (step1 normalizeStatus 입력)
  description?: string;
  location?: string;       // 허브명(비개인정보)
}
export interface TrackResult {
  lastEvent: TrackEvent | null;
  events: TrackEvent[];    // 최신순 또는 원문순 — 주석으로 명시
}
export interface CarrierInfo { id: string; name: string }
```

### 토큰 저장 추상화 (D1 결합 분리 → 단위 테스트 가능)

```ts
export interface TokenStore {
  get(): Promise<{ token: string; expiresAt: number } | null>;
  set(token: string, expiresAt: number): Promise<void>;
}
/** D1 tracker_token 테이블 기반 구현(운영용). 단위 테스트는 인메모리 TokenStore 를 주입한다. */
export function d1TokenStore(db: D1Database): TokenStore;
```

### 함수

```ts
interface TrackerDeps { fetch: typeof fetch; now: number; store: TokenStore; clientId: string; clientSecret: string; }

/** 캐시된 토큰을 반환. 없거나 만료 임박이면 client_credentials 로 재발급 후 store.set. */
export async function getAccessToken(deps: TrackerDeps): Promise<string>;

/** track(carrierId, trackingNumber). 데모 번호면 캔드 결과 반환(외부 호출 우회). */
export async function track(
  carrierId: string,
  trackingNumber: string,
  deps: TrackerDeps & { demoTrackingNumber?: string },
): Promise<TrackResult>;

/** 지원 택배사 목록(자동인식 검증·미지원 판별용). */
export async function carriers(deps: TrackerDeps): Promise<CarrierInfo[]>;
```

엔드포인트: `https://apis.tracker.delivery/graphql` (GraphQL POST). 토큰 발급 엔드포인트는 client_credentials 흐름(ARCHITECTURE 연동 섹션 참조, 정확 URL은 구현 시 확인하되 주입 fetch라 테스트는 mock).

## 핵심 규칙 (벗어나면 안 됨)

- **GraphQL 에러는 응답 본문 `errors[]` 에 있고 HTTP status 는 무의미하다.** 본문을 파싱해 분류한다. 이유: ARCHITECTURE "에러는 GraphQL 응답 본문".
- `UNAUTHENTICATED`(토큰 만료) → **토큰 재발급 1회 후 1회 재시도**. 재시도도 실패하면 throw(상위에서 운영 경고). 이유: ADR-013, 무인 운영.
- 토큰은 만료 전 캐시 재사용(`now < expiresAt - 여유`). 매 호출마다 재발급 금지. 이유: 자격증명 보호·호출 절약.
- **데모 번호**(`deps.demoTrackingNumber` 와 일치)는 외부 호출 없이 캔드 `TrackResult` 반환. 이유: ADR-019, 심사 경로가 실폴링을 타면 안 된다.
- 요청 timeout **15s** (AbortController 등, 주입 가능하게). 이유: ARCHITECTURE 권장.
- `clientId`·`clientSecret`·토큰을 **로그에 남기지 마라.** 이유: 시크릿 보호.
- carrierId 형식 예: `kr.cjlogistics`, `kr.epost`.

## 테스트 (mock fetch + 인메모리 TokenStore)

- 정상 track → `errors` 없는 본문을 mock → `TrackResult` 파싱 검증.
- `UNAUTHENTICATED` 본문 1회 → 토큰 재발급 후 재시도 성공 검증(fetch 호출 횟수).
- 캐시 토큰 유효 → `getAccessToken` 이 재발급 fetch 를 호출하지 않음.
- 캐시 만료 → 재발급 fetch 호출 + `store.set` 갱신.
- 데모 번호 → fetch 미호출, 캔드 결과 반환.

> `d1TokenStore` 는 얇은 D1 어댑터다. 단위 테스트는 인메모리 store 로 충분하며, D1 결선은 step7(cron) 통합에서 확인된다.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 에러를 `errors[]` 본문에서 읽는가(HTTP status 의존 금지)?
   - `UNAUTHENTICATED` 재인증이 정확히 1회 재시도인가(무한 루프 금지)?
   - 데모 번호가 외부 호출을 우회하는가?
   - 시크릿/토큰이 로그에 없는가?
3. `phases/worker-backend/index.json` 의 step 4 를 업데이트한다(규칙은 step0 과 동일).

## 금지사항

- 테스트에서 실제 tracker.delivery 로 네트워크 호출하지 마라. 이유: 외부 의존은 mock(주입 fetch). 자격증명도 없고 비결정적.
- 매 호출마다 토큰을 재발급하지 마라. 이유: 자격증명/쿼터 낭비, ADR-013 캐싱 위반.
- `UNAUTHENTICATED` 에 무한 재시도하지 마라. 이유: 자격증명이 실제 만료(21일)면 루프에 빠진다 — 1회만.
- 정규화(status.code→단계)·푸시·폴링 로직을 여기서 구현하지 마라. 이유: 레이어 분리(정규화는 step1, 발송은 step7).
- 기존 테스트를 깨뜨리지 마라.
