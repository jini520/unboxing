# Step 1: dashboard-screen (대시보드 4카드+컬러 A1 · 빈 목록 진입 버그 B1)

대시보드 화면(`app/app/(tabs)/dashboard.tsx`) 한 파일을 다룬다. step0에서 정정된 `dashboardCounts` 새 shape 를 소비한다.

## 읽어야 할 파일

- `/docs/UI_GUIDE.md` — "대시보드", "테마 & 색상"(색 단독 의존 금지=아이콘+라벨 동반)
- `/docs/ADR.md` — ADR-021(클라이언트 집계)·ADR-025(시작 화면)
- `/Users/jinni/Developments/unboxing/app/app/(tabs)/dashboard.tsx` — 이 step의 대상
- `/Users/jinni/Developments/unboxing/app/src/lib/dashboard.ts` — **step0에서 변경됨**(필드: inProgress/completed/trash/unread/amountTeaser, 예외는 inProgress 포함). 먼저 읽어 새 shape 확인.
- `/Users/jinni/Developments/unboxing/app/src/theme/tokens.ts` — 색 토큰(`accent`, `stage.delivered`, `stage.inTransit`, `stage.exception`, `text.secondary`)
- `/Users/jinni/Developments/unboxing/app/app/(tabs)/index.tsx` — 빈 상태/`sync` 에러 처리 패턴 비교용(B1 가설 검증)
- `/Users/jinni/Developments/unboxing/app/app/_layout.tsx` — 콜드스타트 라우팅(B1 가설 H2)

## 작업 A1 — 카드 4개로 축소 + 의미색

현재 6카드(진행 중·배송완료·확인 필요·오늘 도착·휴지통·새 알림) → **4카드**로 줄인다.

- 제거: **"확인 필요"(exception)** 카드, **"오늘 도착"(arrivingToday)** 카드. 관련 `goList("예외")`/`goList("임박")` 호출, 그 주석, 이제 미사용이 된 아이콘 import(`AlertTriangle`, `Truck`)도 제거.
- 남기는 4카드와 **의미색**(count>0 일 때만 색 적용, count 0 이면 `text.secondary` 중립 — 기존 SummaryCard 패턴 계승). 색 단독 금지: 아이콘+라벨이 항상 의미를 동반한다.
  - **진행 중** → `tokens.accent` (블루), Icon=`Package`
  - **배송 완료** → `tokens.stage.delivered` (그린), Icon=`CheckCircle`
  - **새 알림** → `tokens.stage.inTransit` (골드), Icon=`Bell`
  - **휴지통** → `tokens.stage.exception` (레드), Icon=`Trash`
- `SummaryCard` 의 단색 emphasize(예외 전용) 패턴을 **카드별 색 인자**로 일반화한다(예: `tint?: string` 를 받아 count>0 이면 숫자·아이콘에 적용, 0이면 중립). 라벨은 기존대로 `text.secondary`.
- 카드 탭 네비(A2 필터 제거 반영): 필터 프리셋이 사라졌으므로 **`진행 중`·`배송 완료` 카드 → 택배함 탭으로 단순 이동**(`router.navigate("/")`, params 없음). `휴지통` → `router.push("/trash")`, `새 알림` → `router.push("/notifications")` 유지. `goList`/`ListFilter` import 제거.
- 2열 그리드 그대로 두면 4카드가 2×2로 정렬된다(레이아웃 변경 불필요).

## 작업 B1 — 빈 목록(운송장 미등록)에서 대시보드가 안 열리는 버그

**증상(사용자 발견):** 등록된 송장이 없을 때 대시보드 진입/렌더가 실패한다.

**현재 코드 분석:** `dashboard.tsx` 에는 이미 빈 상태 가드가 있다(`counts===null?스피너 : shipments!==null && length===0 ? <EmptyState/> : ...`). 따라서 단순 크래시는 아니며 다음 두 가설을 **반드시 코드로 검증**하라:

- **H1 (유력):** `sync()` 의 `listShipments` 가 NETWORK 외 에러를 던지면 `catch` 가 offline 만 처리하고 `shipments` 를 `null` 로 둔다 → `counts===null` 이 유지돼 **무한 스피너**(=안 열림으로 보임). `index.tsx` 와 달리 대시보드는 에러 폴백이 없다.
  - 수정: `sync` 의 `listShipments` 실패 시에도 화면이 멈추지 않도록 폴백을 둔다 — 캐시가 있으면 그 값을, 없고 첫 로드면 **빈 목록(`[]`)으로 확정**해 EmptyState 가 뜨게 한다(코드/기술 메시지 비노출, PRD 톤 유지). NETWORK 는 기존대로 캐시 유지 + 오프라인 배너.
- **H2:** 콜드스타트에서 `homePref="dashboard"` 일 때 `_layout.tsx` 의 `router.navigate("/dashboard")` 타이밍. 빈 목록과 무관하게 동작해야 한다. 코드로 확인하고, 빈 목록에서도 정상 진입하는지 점검.

근본 원인을 확정해 고치고, **가능하면 회귀 가드를 순수 로직 테스트로** 남겨라(예: sync 의 결정 로직을 작은 순수 함수로 추출할 수 있으면 `*.test.ts` 추가). 추출이 과하면 생략 가능.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) green
```

## 검증 절차

1. AC 실행 green.
2. **시뮬레이터 수동 스모크(중요 — mock verify 가 못 잡는 런타임 버그):** `npm --prefix app run ios` 로 띄워 **운송장 0건 상태**에서 대시보드 탭 진입 → EmptyState 가 정상 표시되는지 확인. (자동 구동이 불가하면 코드 경로로 H1/H2 가 닫혔음을 근거와 함께 summary 에 적고, 사용자 최종 시뮬 확인을 남긴다.)
3. 체크리스트: 색 단독 의존 없음(아이콘+라벨 동반), 카드 4개, 미사용 import 없음, 에러 코드/기술 메시지 비노출.
4. `index.json` step1 갱신:
   - 성공 → `"status":"completed"`, `"summary"`: 4카드+색 매핑(진행중=accent/완료=delivered/알림=inTransit/휴지통=exception), B1 근본원인(H1/H2 중 무엇이었는지)·수정 요지, 시뮬 확인 여부.
   - 실패(3회) → `"error"` + `error_message`
   - 사용자 개입 필요 → `"blocked"` + `blocked_reason`

## 금지사항

- `src/lib/dashboard.ts` 의 집계 로직을 다시 바꾸지 마라. 이유: step0에서 확정됐다(예외는 inProgress 포함). 이 step은 화면만.
- 색을 hex 로 하드코딩하지 마라. 이유: 색은 `tokens.*` 만(UI_GUIDE 단일 출처).
- 색만으로 상태를 전달하지 마라(접근성). 아이콘+라벨을 항상 동반한다.
- 서버 에러 코드·기술 메시지를 화면에 노출하지 마라(PRD 톤).
- 기존 테스트를 깨뜨리지 마라.
