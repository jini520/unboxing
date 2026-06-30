# Step 15: logic-counts (순수 로직 — 필터·대시보드 집계 정정)

v1.1 출시 후 시뮬레이터 스모크에서 발견된 **설계 정정 2건(A1·A2)의 순수 로직 부분**을 test-first 로 처리한다.
화면(`.tsx`)은 건드리지 않는다 — 이 step은 `src/lib/` 로직 + 테스트만. 화면은 step1·step2.

## 읽어야 할 파일

먼저 아래를 읽고 단일 출처(버킷 정의)·드리프트 금지 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — "v1.1 설계 보강 ①"(버킷 단일 출처), "데이터 흐름"
- `/docs/ADR.md` — ADR-021(클라이언트 집계, 새 서버 엔드포인트 없음)
- `/Users/jinni/Developments/unboxing/app/src/lib/bucket.ts` — `stageBucket`/`isImminent`(단일 출처, **이 step에서 수정 금지**)
- `/Users/jinni/Developments/unboxing/app/src/lib/filter.ts` + `filter.test.ts`
- `/Users/jinni/Developments/unboxing/app/src/lib/dashboard.ts` + `dashboard.test.ts`
- `/Users/jinni/Developments/unboxing/app/src/lib/prefs.ts` — `ListFilterPref`/`loadListFilter`/`saveListFilter`(이름이 비슷하지만 **`{hideCompleted}` 영속용**, 칩 필터와 무관 — **건드리지 마라**)

## 배경 (확정된 설계 정정)

- **A2 — 택배함 필터 칩 전면 제거.** 칩(전체/진행중/임박/완료/예외) 기능을 없애고 "완료 숨기기" 토글만 남긴다. 따라서 `filter.ts`는 칩이 아니라 `hideCompleted` 전용으로 단순화한다.
- **A1 — 대시보드 4카드 축소 + 예외 흡수.** 카드를 `진행 중·배송 완료·휴지통·새 알림` 4개로 줄인다. "확인 필요(예외)"·"오늘 도착" 카드 제거. **예외 건은 "진행 중"에 포함**(inProgress = 배송완료가 아닌 전체). 따라서 `dashboard.ts`에서 `exception`·`arrivingToday` 카운트 산출을 제거한다.

## 작업

### 1. `app/src/lib/filter.ts` — hideCompleted 전용으로 단순화

- `ListFilter` 타입과 칩 분기(`전체/진행중/임박/완료/예외`)를 **전부 제거**한다.
- 새 시그니처(예시):
  ```ts
  export function filterShipments(
    list: Shipment[],
    { hideCompleted }: { hideCompleted: boolean },
  ): Shipment[]
  ```
- 동작: `hideCompleted` 가 true면 `배송완료` 만 제외, false면 입력 그대로(얕은 복사). **정렬하지 않는다**(filter→sort 는 별개 단계, 호출부가 sortShipments 적용). 입력 배열 비파괴(Array.filter / spread).
- 이제 불필요해진 import 제거: `stageBucket`·`isImminent`(이 파일에서 미사용이 된다). `Shipment` 타입만 남는다.

### 2. `app/src/lib/filter.test.ts` — 새 시그니처로 갱신

- 칩 기반 케이스(`진행중`/`임박`/`완료`/`예외`/E15 명시완료/결과0건 칩)는 **삭제**한다.
- 남기거나 새로 쓸 케이스(새 시그니처):
  - `hideCompleted:false` → 입력 전부(순서 보존)
  - `hideCompleted:true` → `배송완료` 만 빠지고 나머지 순서 보존
  - 빈 입력 → `[]`
  - 입력 배열 비파괴(원본 id 순서 불변)

### 3. `app/src/lib/dashboard.ts` — exception·arrivingToday 제거, 예외→진행중 흡수

- `DashboardCounts` 에서 `exception`·`arrivingToday` 필드를 제거한다. 남는 필드: `inProgress`, `completed`, `trash`, `unread`, `amountTeaser`.
- 집계 규칙: `completed = stageBucket(s.status) === "완료"` 건수, `inProgress = 그 외 전부`(예외 포함). 즉 `inProgress + completed === list.length`.
- `arrivingToday` 산출 루프와 그 주석을 제거한다. 그로 인해 미사용이 된 import 제거: `isImminent`, `dateKST`(당일 키 산출용이었음). **`monthKST` 와 금액 teaser 로직은 그대로 유지**한다.

### 4. `app/src/lib/dashboard.test.ts` — 새 shape 로 갱신

- "빈 목록" 기대값에서 `exception`·`arrivingToday` 제거.
- "혼합 목록": 예외가 진행 중에 포함되도록 기대값 수정(예: 이동중·배송출발·예외·미등록·배송완료 → `inProgress=4`, `completed=1`). `exception` 단언 제거하고 **"예외 건이 inProgress 에 포함된다"** 단언을 명시적으로 추가한다.
- "active=0" 케이스: 미등록(비활성)+예외(비활성) → `inProgress=2` 로 수정(예외 흡수). `exception` 단언 제거.
- `arrivingToday` 전용 테스트 블록은 **삭제**한다.
- 금액 teaser describe 블록은 변경 없이 유지(통과해야 한다).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 전부 green
```

## 검증 절차

1. 위 AC 커맨드를 실행해 green 확인.
2. 체크리스트:
   - `filter.ts`/`dashboard.ts` 에 미사용 import 가 남지 않았는가(typecheck/noUnusedLocals 기준).
   - 버킷 정의를 `dashboard.ts` 안에서 재정의하지 않고 `stageBucket`(bucket.ts)만 사용했는가(드리프트 금지).
   - `prefs.ts`·`bucket.ts` 를 수정하지 않았는가.
3. `phases/11-qa-v0-v11-fixes/index.json` 의 step0 을 갱신:
   - 성공 → `"status": "completed"`, `"summary": "filter.ts hideCompleted 전용·dashboard.ts 예외→진행중 흡수(exception/arrivingToday 제거), 테스트 갱신. filterShipments 새 시그니처=(list,{hideCompleted}); DashboardCounts={inProgress,completed,trash,unread,amountTeaser}"`
   - 실패(3회) → `"status": "error"`, `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason"` 후 중단

## 금지사항

- 화면(`.tsx`)을 수정하지 마라. 이유: 이 step은 로직만, 화면은 step1·step2에서 새 시그니처를 소비한다. 화면을 함께 고치면 step 격리가 깨진다.
- `bucket.ts` 의 `isImminent` 함수와 `bucket.test.ts` 를 삭제하지 마라. 이유: 문서화된 순수 헬퍼이고 sort 우선순위 의미와 연결돼 있어 제거는 본 phase 범위 밖이다. **import 만 정리**한다.
- `prefs.ts` 의 `loadListFilter`/`saveListFilter`/`ListFilterPref` 를 건드리지 마라. 이유: 칩 `ListFilter` 와 이름만 겹칠 뿐 `{hideCompleted}` 영속 저장용이며 step2 가 그대로 사용한다.
- 기존 통과 테스트(금액 teaser 등)를 깨뜨리지 마라.
