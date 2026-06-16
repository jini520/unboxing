# Step 3: local-cache (오프라인 읽기 캐시)

서버가 SOT이고 앱은 마지막 응답을 로컬 캐시로 두어 **오프라인 읽기**만 지원한다(ADR-014). AsyncStorage 기반, 주입 가능, test-first.

## 읽어야 할 파일

- `/docs/ADR.md` — ADR-014(앱은 서버 SOT, 로컬은 캐시만), ADR-005(개인정보 비영속), ADR-011(타임라인 미저장)
- `/docs/ARCHITECTURE.md` — "앱 아키텍처", "에러 처리 매트릭스 → 앱(네트워크 오프라인)"
- `/docs/UI_GUIDE.md` — "상태별 UI"(로딩/오프라인 캐시 우선 렌더)
- step2: `app/src/lib/api.ts`(`Shipment` 타입)
- **https://docs.expo.dev/versions/v56.0.0/** → `@react-native-async-storage/async-storage` 사용법

## 작업

`app/src/lib/cache.ts` 와 `app/src/lib/cache.test.ts`.

```ts
export interface KeyValueStore { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void>; }

export function cacheShipments(list: Shipment[], deps: { store: KeyValueStore; now: number }): Promise<void>;
export function readCachedShipments(deps: { store: KeyValueStore }): Promise<{ list: Shipment[]; cachedAt: number } | null>;
export function clearCache(deps: { store: KeyValueStore }): Promise<void>;
export const cacheStore: KeyValueStore; // 운영용 AsyncStorage 어댑터
```

- 목록(`Shipment[]`)과 캐시 시각만 저장. 상세 타임라인은 캐시하지 않는다.

## 핵심 규칙 (벗어나면 안 됨)

- **목록의 비개인 필드만 캐시**한다(carrier·끝자리·정규화 상태·시각). 수령인 이름·연락처·주소를 캐시하지 마라. 이유: ADR-005 개인정보 비영속.
- **타임라인(상세 이벤트)을 캐시하지 마라.** 이유: ADR-011(실시간 조회·미저장). 오프라인 상세는 "마지막 알려진 단계"만.
- 캐시는 **읽기 전용 오프라인 뷰**. 서버가 SOT. 변경은 온라인에서만. 이유: ADR-014.
- `now` 주입. `Date.now()` 직접 호출 금지(테스트 결정성).

## 테스트 (인메모리 KeyValueStore)

- `cacheShipments` → `readCachedShipments` 라운드트립(list·cachedAt 보존).
- 빈 캐시 → `null`.
- `clearCache` 후 → `null`.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트: 개인정보/타임라인 미캐시? 라운드트립·clear 동작? `now` 주입?
3. `phases/app-ui/index.json` 의 step 3 업데이트(규칙은 step0 동일).

## 금지사항

- 수령인 정보·전체 타임라인을 캐시하지 마라. 이유: ADR-005/011.
- 캐시를 쓰기 SOT로 쓰지 마라(오프라인 등록/삭제 큐). 이유: ADR-014.
- `Date.now()` 직접 호출 금지. 이유: 결정적 테스트.
- 기존 테스트를 깨뜨리지 마라.
