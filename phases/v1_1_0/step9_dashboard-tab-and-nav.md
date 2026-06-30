# Step 9: 대시보드 탭 + 3탭 네비게이션

하단 탭에 **대시보드**(좌측)를 추가해 2탭 → 3탭으로 만들고, 진행 중·완료·예외 개수와 휴지통·새 알림·오늘 도착 예정·이번 달 금액 합계를 요약 카드로 보여준다. 집계는 **클라이언트**에서(새 서버 엔드포인트 없음, ADR-021). 순수 집계 로직은 phase 08 `dashboardCounts` 가 이미 제공한다 — **import 해 소비**하고 재구현하지 않는다.

## 읽어야 할 파일

- `/docs/UI_GUIDE.md` — "대시보드(하단 탭·좌측)"(line 174~179), "헤더 알림 종"(line 181~183), 네비게이션(line 42), 상태별 UI 표(line 207~212), 신규 글리프(line 281)
- `/docs/PRD.md` — "v1.1 기능 명세" 1(대시보드·금액 teaser·라우팅), 신규 제안 "오늘 도착 예정"(line 228)
- `/docs/ARCHITECTURE.md` — "v1.1 네비게이션/화면 추가"(line 225~228), ADR-021(집계 클라이언트), ADR-014(오프라인 캐시 집계)
- `/docs/ADR.md` — ADR-021(대시보드 집계 클라이언트), ADR-025(시작 화면)
- **08 산출물**: `app/src/lib/bucket.ts`(`dashboardCounts(list,{trashCount,unreadCount,now,amountOf})`·`arrivingToday`·금액 teaser 반환), `app/src/lib/trash.ts`(`loadTrash` → 휴지통 수), `app/src/lib/notif.ts`(`unreadCount`), `app/src/lib/info.ts`(`getInfo` → `amountOf`), `app/src/lib/amount.ts`(`formatAmount`)
- 코드: `app/app/(tabs)/_layout.tsx`(현 2탭), `app/app/(tabs)/index.tsx`(헤더 패턴 참고), step0 의 `app/src/components/HeaderBell.tsx`, `app/src/lib/api.ts`(listShipments), `app/src/lib/cache.ts`(오프라인 캐시), `app/src/components/icons/`(글리프 추가), `app/src/theme/tokens.ts`·`layout.ts`

## 작업

### 1. 대시보드 화면 — `app/app/(tabs)/dashboard.tsx`
- 헤더: 제목 "대시보드" + 페이지 설명 + 우상단 `HeaderBell`(step0, 미읽음 배지). 택배함과 동일한 헤더 위치/스타일.
- 요약 카드(2열 그리드 또는 행 스택): **진행 중 / 배송완료 / 예외(확인 필요)** + **휴지통 / 새 알림**. 각 카드 = 카드 토큰(`bg/surface`·옅은 보더) + 큰 숫자(`display`) + 라벨. 숫자 0 = 중립(`text/secondary`), **예외>0 = `stage.exception` 강조(색+라벨/아이콘 — 색 단독 금지)**.
- **오늘 도착 예정** 카드(`dashboardCounts.arrivingToday`).
- **이번 달 등록 금액 합계** teaser 카드: `formatAmount(amountTotal)`. `amountPartial` 이면 "일부 미입력" 캡션. 미입력 0건이면 카드 숨김 가능.
- 카드 탭 라우팅: 진행 중/완료/예외 → 택배함(해당 **필터 프리셋**을 route param 으로 전달, 예: `/(tabs)?filter=진행중`), 오늘 도착 → 택배함(오늘도착 필터), 휴지통 → `/trash`, 새 알림 → `/notifications`. (택배함이 route param 의 칩 프리셋을 초기 선택하도록 step0 의 칩 상태와 연동 — 본 step 에서 param 전달, 택배함 수신 처리.)
- 집계 입력: `listShipments`(또는 오프라인 시 `readCachedShipments`) + 휴지통 수(`loadTrash`) + 미읽음 수 → `dashboardCounts`. 빈(송장 0) → 가치 제안 + 등록 CTA(택배함 빈 상태와 일관). 오프라인 → 캐시 집계 + 신선도 표기 + 배너.

### 2. 3탭 네비게이션 — `app/app/(tabs)/_layout.tsx`
- 탭 **3개**: **대시보드(좌) · 택배함 · 설정**. 기존 택배함·설정 탭 구성 유지, 대시보드를 좌측에 추가.
- 대시보드 탭 아이콘: 신규 라인 글리프(`Grid`/`Squares` 류, strokeWidth 1.5, 둥근 배경 박스 금지) — `app/src/components/icons/icons.tsx` 에 추가하고 `index.ts` 에 export.
- **콜드스타트 초기 탭 결정은 step5(라우팅)** 에서 처리 — 본 step 은 탭 구성만(기본 진입 탭은 기존 동작 유지).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차
1. 위 AC 실행(대시보드 화면 통합 테스트는 보류 가능[E-3] — typecheck·기존 테스트 무파손).
2. 체크리스트: 집계는 `dashboardCounts`(08) 사용·새 서버 엔드포인트 없음(ADR-021) / 예외>0 강조는 색+라벨(색 단독 아님) / 오프라인 캐시 집계+신선도 / 카드 라우팅 프리셋 전달 / 글리프 strokeWidth 1.5·박스 없음 / 색 토큰만.
3. `phases/09-ui-v0-v11-screens/index.json` step 1 업데이트(성공→completed+summary / 실패→error / 외부개입→blocked).

## 금지사항
- 새 서버 집계 엔드포인트(`GET /stats` 등)를 만들지 마라. 이유: 대시보드 집계는 클라이언트에서(ADR-021) — 비영속·$0 모델 유지.
- 버킷 판정을 대시보드에서 다시 정의하지 마라. 이유: `stageBucket`/`dashboardCounts`(08)가 단일 출처 — 드리프트 금지.
- 상태를 색 단독으로 표현하지 마라(색+아이콘+텍스트). 글래스/그라데이션/네온/보라를 쓰지 마라. 이유: AI 슬롭 안티패턴(UI_GUIDE).
- 기존 테스트를 깨뜨리지 마라.
