# Step 0: dashboard-cards (대시보드 빈 목록에서 EmptyState 제거 → 항상 4카드)

phase 11(`11-qa-v0-v11-fixes`)의 B1 수정이 의도와 어긋난 것을 정정한다. B1 의도는 **"운송장 0건(빈 목록)이어도 대시보드가 4카드를 그대로 표시"**인데, 현재 구현은 빈 목록일 때 "운송장 등록" CTA 빈화면(EmptyState)을 띄운다(사용자 시뮬레이터 확인으로 발견). 이 step은 대시보드 화면 한 파일만 다룬다.

## 읽어야 할 파일

먼저 아래를 읽고 현재 렌더 분기·집계 계약을 파악하라:

- `/docs/UI_GUIDE.md` — "대시보드"(카드·빈상태 서술)
- `/docs/ADR.md` — ADR-021(클라이언트 집계, 빈/오프라인 캐시 집계)
- `/Users/jinni/Developments/unboxing/app/app/(tabs)/dashboard.tsx` — 이 step의 유일한 대상
- `/Users/jinni/Developments/unboxing/app/src/lib/dashboard.ts` — `dashboardCounts`(빈 목록 → 전부 0 카운트 반환). **이 step에서 수정 금지**. 빈 목록도 `counts`가 `null`이 아닌 0 객체로 나온다는 점 확인.

## 배경 (확정된 정정)

- 빈 목록에서도 대시보드는 **4카드(진행 중·배송완료·휴지통·새 알림)**를 그대로 보여준다. 카운트는 대부분 0이고, 휴지통/새 알림은 0이 아닐 수 있다(예: 송장 0건이어도 휴지통에 항목이 있을 수 있음 — 그래서 "등록 CTA 빈화면"은 부정확하다).
- **택배함(`app/app/(tabs)/index.tsx`)의 빈 상태(운송장 등록 CTA)는 그대로 둔다** — 목록 화면엔 빈 상태가 맞다. 정정 대상은 **대시보드뿐**.

## 작업 — `app/app/(tabs)/dashboard.tsx`

현재 렌더 분기(대략 다음 형태):

```tsx
{counts === null ? (
  <View style={styles.center}><ActivityIndicator .../></View>      // 로딩 — 유지
) : shipments !== null && shipments.length === 0 ? (
  <EmptyState />                                                    // ← 이 분기 제거
) : (
  <ScrollView ...> ...4카드 그리드 + 금액 teaser... </ScrollView>
)}
```

1. **빈 목록 분기 제거.** `shipments !== null && shipments.length === 0 ? <EmptyState /> :` 분기를 삭제해, `counts !== null` 이면 **항상 카드 그리드(ScrollView 블록)**가 렌더되도록 한다. 즉 분기는 `counts === null ? <스피너> : <ScrollView 카드>` 두 갈래만 남는다.
2. **고아가 된 `EmptyState` 컴포넌트 함수를 삭제**한다(대시보드 전용 로컬 컴포넌트, `router.push("/register")` CTA 포함). 이 컴포넌트는 이 한 곳에서만 쓰였다.
3. **고아가 된 스타일 삭제.** `EmptyState` 만 쓰던 스타일 키 `emptyTitle`, `cta`, `ctaLabel` 을 `StyleSheet.create` 에서 제거한다. **`center` 는 삭제하지 마라** — `counts === null` 스피너 분기가 계속 사용한다(공유).
4. **catch 폴백 주석 정정.** sync 의 `listShipments` catch 안 `setShipments((prev) => prev ?? [])` 폴백은 **그대로 유지**한다(그게 첫 로드 실패·빈 목록에서 `counts`를 0 객체로 만들어 무한 스피너를 막고 → 이제 0 카운트 카드를 띄운다). 다만 그 주석이 "→ EmptyState 표시(B1)" 라고 돼 있으면 "→ 0 카운트 카드 표시(B1: 무한 스피너 방지)" 취지로 한 줄만 갱신한다.
5. 위 변경으로 미사용이 된 import 가 생기면 정리한다(typecheck/noUnusedLocals 기준). 단 `router`(카드 onPress 에서 사용)·`ActivityIndicator`(스피너)·`ScrollView`/`RefreshControl`(카드 블록) 등은 계속 쓰이므로 남는다 — 실제 미사용만 제거.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 전부 green
```

## 검증 절차

1. AC 실행 green.
2. 체크리스트:
   - 대시보드 렌더가 `counts === null ? 스피너 : 카드` 두 갈래만 남았는가(빈 목록 EmptyState 분기 없음).
   - `EmptyState` 함수와 `emptyTitle`/`cta`/`ctaLabel` 스타일이 제거됐고, `center` 는 남았는가.
   - `setShipments((prev) => prev ?? [])` 폴백이 그대로 있는가(제거하면 빈 목록에서 무한 스피너 회귀).
   - `dashboard.ts`(집계)·`index.tsx`(택배함 빈상태)를 건드리지 않았는가.
   - 미사용 import 없음.
3. `phases/12-qa-v0-v11-dashboard-empty/index.json` 의 step0 갱신:
   - 성공 → `"status":"completed"`, `"summary"`: dashboard.tsx 빈목록 EmptyState 분기 제거(항상 4카드)·EmptyState 컴포넌트+emptyTitle/cta/ctaLabel 스타일 제거·center 유지·catch 폴백 유지(주석만 정정). npm run verify green.
   - 실패(3회) → `"error"` + `error_message`
   - 사용자 개입 필요 → `"blocked"` + `blocked_reason`

## 금지사항

- `setShipments((prev) => prev ?? [])` 폴백을 제거하지 마라. 이유: 첫 로드 실패(비-NETWORK)·빈 목록에서 `shipments`가 `null`로 남으면 `counts===null`로 무한 스피너 회귀(B1 원래 버그). 폴백이 `[]`로 확정해야 0 카운트 카드가 뜬다.
- 택배함(`index.tsx`)의 빈 상태(운송장 등록 CTA)를 제거·변경하지 마라. 이유: 목록 화면엔 빈 상태가 맞다. 이번 정정은 대시보드 전용.
- `dashboard.ts`의 집계 로직을 바꾸지 마라. 이유: 빈 목록 → 전부 0 카운트는 이미 올바르다. 화면 분기만 고친다.
- `center` 스타일을 삭제하지 마라. 이유: 스피너 분기가 공유한다.
- 기존 통과 테스트를 깨뜨리지 마라.
