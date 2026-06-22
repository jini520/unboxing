# Step 0: stage-bucket-counts-filter — 단계→버킷 단일출처 + 대시보드 집계 + 택배함 필터

대시보드와 택배함 필터가 **같은 정의**를 쓰도록 `stageBucket` 단일 출처를 만들고, 이를 소비하는 순수 함수 `dashboardCounts`(집계)·`filterShipments`(필터)를 구현한다. 모두 외부 의존 없는 순수 로직이라 **test-first(TDD)** 로 먼저 빨간 테스트를 쓰고 통과시킨다. 화면 배선은 09 phase 다(여기선 함수+테스트만).

## 읽어야 할 파일

먼저 아래를 읽고 버킷 정의·집계/필터 사양·기존 순수 로직 패턴을 파악하라:

- `/docs/ARCHITECTURE.md` — "v1.1 설계 보강 ①"(단계→버킷 단일출처 표: 진행중/임박/완료/예외 정의·전수·배타·필터 우선순위), "데이터 흐름"의 대시보드 집계, 엣지(대시보드 오프라인·재집계·필터 0건)
- `/docs/PRD.md` — "v1.1 기능 명세" 1.대시보드(금액 teaser·오늘 도착 예정)·6.택배함 필터(칩·완료 숨기기 우선순위)
- `/docs/QA.md` — "E-1" `stageBucket`·`dashboardCounts`·`filterShipments` 케이스, "E-4" E15(hideCompleted+완료 칩)·E16(결과 0건)
- `app/src/lib/stage.ts` — 8단계 정규화 단계(`NormalizedStage` 등 — 버킷의 입력), `app/src/lib/sort.ts`(`sortShipments` — 필터와 별개), `app/src/lib/time.ts`(KST·이번 달·당일 헬퍼), `app/src/lib/api.ts`(`Shipment` 타입: stage·active·createdAt 등)

## 작업

### 1. `app/src/lib/bucket.ts` — `stageBucket` (단일 출처, 보강①)
- `type Bucket = "진행중" | "완료" | "예외"`.
- `stageBucket(stage): Bucket` — 진행중={미등록·등록·집화·이동중·배송출발·기타}, 완료={배송완료}, 예외={예외}. `active` 무관.
- `isImminent(stage): boolean` — `배송출발`(진행중의 **하이라이트 부분집합**, 별도 배타 버킷 아님).
- 전수성(8단계 모두 매핑·누락 0)·배타성(진행중/완료/예외 상호 배타, 임박만 진행중과 겹침)을 함수 구조로 보장.

### 2. `app/src/lib/dashboard.ts` — `dashboardCounts`
- `dashboardCounts(list, { trashCount, unreadCount, now, amounts }): DashboardCounts`
  - `DashboardCounts = { inProgress, completed, exception, arrivingToday, trash, unread, amountTeaser: { total, partial } }`.
  - `inProgress/completed/exception` = `stageBucket` 으로 집계(`active=0` 이 버킷을 바꾸지 않음).
  - `arrivingToday` = `isImminent`(배송출발) ∩ **KST 당일**(`time.ts` 헬퍼). — 오늘 도착 예정.
  - `trash`·`unread` = 인자 통과.
  - `amountTeaser`: `amounts`(`Record<shipmentId, number|undefined>` 주입)에서 **KST 이번 달 `createdAt` 건** 합, **휴지통 제외**(list 는 라이브 목록), **금액 미입력 제외**, `partial`=일부만 입력됨, 전부 미입력이면 `total=0`.
- **`amounts` 를 주입받는다 — 정보 스토어(step2)를 import 하지 않는다**(forward 의존 회피, 순수 유지).

### 3. `app/src/lib/filter.ts` — `filterShipments`
- `type ListFilter = "전체" | "진행중" | "임박" | "완료" | "예외"`.
- `filterShipments(list, filter, { hideCompleted }): Shipment[]`
  - 전체 → hideCompleted 면 `배송완료` 제외 / 진행중 → 진행중 버킷 / 임박 → 배송출발만 / 완료 → 배송완료만(**hideCompleted 무시·명시 우선**, E15) / 예외 → 예외만.
  - **순서·정렬을 바꾸지 않는다**(filter → sort 별개 — `sortShipments` 는 호출부에서 이후 적용).
  - **결과 0건과 입력 0건을 구분**할 수 있게(호출부가 "조건에 맞는 택배가 없어요" vs 빈 상태 분기) — 함수는 단순 배열 반환, 구분은 호출부가 `list.length` 와 비교.

## 테스트 (TDD)
- `bucket.test.ts`: 8단계 전수 매핑 / 진행중·완료·예외 배타 / `isImminent`=배송출발만 / 누락 0.
- `dashboard.test.ts`(`now` 고정): 빈 목록 → 전부 0 / 혼합 → 버킷별 정확 / `active=0` 무영향(비활성 미등록도 진행중) / trash·unread 통과 / teaser(이번 달 KST·월경계 UTC+9·휴지통 제외·미입력 제외·음수/undefined 제외·partial·전부 미입력 0) / `arrivingToday` KST 당일.
- `filter.test.ts`: 각 filter / E15 명시 완료 우선 / 결과 0 vs 입력 0 구분 가능 / 순서 불변(filter 후 입력 순서 유지).

## Acceptance Criteria
```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차
1. 위 AC 실행.
2. 체크리스트: `stageBucket` **단일 출처**(dashboard·filter 가 import·복제 없음) / 전수·배타 / teaser 규칙 / filter 순서 불변·명시 우선 / `now` 주입 / ARCHITECTURE 보강① 정의와 일치 / 기존 테스트 무파손.
3. `phases/08-ui-v0-v11-logic/index.json` step 0 업데이트(성공→completed+summary / 3회 실패→error / 외부개입→blocked).

## 금지사항
- `stageBucket` 로직을 `dashboard.ts`·`filter.ts` 에 **복제**하지 마라. 이유: 단일 출처가 깨지면 대시보드 카드와 필터 칩이 서로 다른 수를 보인다(드리프트).
- `filterShipments` 안에서 정렬하지 마라. 이유: filter 와 sort 는 별개 단계(보강①·기존 `sortShipments`).
- `dashboard.ts` 에서 정보/휴지통 스토어를 import 하지 마라. 이유: 순수 함수 유지·step 의존 역전 방지(`amounts`·`trashCount` 는 주입).
- `now` 를 `Date.now()` 로 직접 부르지 마라. 이유: 결정적 테스트(고정 시계 주입).
- 기존 테스트를 깨뜨리지 마라.
