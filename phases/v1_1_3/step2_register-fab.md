# Step 2: register-fab (#3 송장 등록 바로가기 FAB — 대시보드·택배함, 헤더 '+' 와 병존)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-042**(등록 FAB: 우하단 accent 원형, 헤더 '+' 와 병존, 빈 상태·멀티선택 숨김) 전문.
- `/docs/UI_GUIDE.md` — "v1.1.3" 섹션의 **송장 등록 FAB** 항(디자인·노출 조건·z-순서).
- `app/app/(tabs)/dashboard.tsx` — 루트 `<SafeAreaView edges={["top"]}>`(`122`, `safe`={flex:1} `264`) > header(`123~131`) > `<ScrollView>`(`144~201`). 기존 absolute 하단 요소 없음.
- `app/app/(tabs)/index.tsx` (택배함 목록) — 헤더 우상단 '+' 등록 버튼 `384~392`(`router.push("/register")`·`Plus size={24}`·`headerActions` 묶음 `382`). 빈 상태 분기 `426~465`(`shipments===null` 스피너 / `shipments.length===0` → `EmptyState` `431` / else FlatList). 멀티선택 상태 `selectedIds`(`96`)·`selectionMode`(`97`). 하단 absolute 패턴 참고: `styles.toast` `529~540`(`position:"absolute", bottom: spacing.xl`).
- `app/src/components/icons/icons.tsx` — `Plus`(`75~82`). 배럴 `app/src/components/icons`. 색은 `color` prop(hex 금지).
- `app/src/theme/tokens.ts`·`layout.ts` — `accent`·`onAccent` 색, `spacing.lg`(16). 그림자: **라이트만**(다크 그림자 금지 — 기존 카드 규칙 일관, `useTheme`/scheme 로 분기).
- 기존 컴포넌트 스타일 컨벤션 참고: `app/src/components/ShipmentCard.tsx`(StyleSheet·토큰 사용 패턴).

## 작업

### (A) 신규 공용 컴포넌트 `app/src/components/Fab.tsx`
- 시그니처(권장): `function Fab({ onPress, label }: { onPress: () => void; label: string })`.
- 디자인: 원형(지름 ≈56, `borderRadius: 28`), 배경 `tokens.accent`, 중앙에 `onAccent`(흰) `Plus` 글리프. `position:"absolute"`, `right: spacing.lg`, `bottom:` = 하단 inset + `spacing.lg`(하단 inset 은 `useSafeAreaInsets().bottom`; 탭 화면은 탭바가 화면 밖이라 화면 하단 기준이면 탭바 위에 위치 — 시뮬에서 겹침 확인은 step 5).
- **그림자**: 라이트 스킴만 옅은 그림자(`shadow*`/`elevation`), 다크는 그림자 0.
- a11y: `accessibilityRole="button"`, `accessibilityLabel={label}`. 터치 타깃 ≥44(지름 56이라 충족).
- 색은 토큰만(스플래시/adaptiveIcon 하드코딩 `#1b68eb` 와 혼동 금지 — UI accent = `tokens.accent`).

### (B) 대시보드 배선 — `app/app/(tabs)/dashboard.tsx`
- `<SafeAreaView>` 직계 자식으로 `<Fab onPress={() => router.push("/register")} label="운송장 등록" />` 추가(ScrollView 뒤·absolute 라 형제로 둠). 대시보드는 **항상 노출**(현황판).

### (C) 택배함 배선 — `app/app/(tabs)/index.tsx`
- `<SafeAreaView>` 직계 자식으로 동일 `<Fab>` 추가.
- **노출 조건**: `shipments` 가 있고(`shipments && shipments.length > 0`) **`!selectionMode`** 일 때만. 빈 상태(`EmptyState` = 중앙 등록 CTA 존재)·멀티선택 모드(선택 헤더 충돌)에선 숨김.
- **헤더 우상단 기존 '+' 버튼(`384~392`)은 그대로 유지**(병존 — 사용자 결정).
- 하단 토스트(`styles.toast`)와 **z-순서/위치 겹침 주의**(둘 다 우하단 근처면 토스트가 위로 보이도록, 또는 위치 분리).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

> ⚠️ FAB 위치/그림자/탭바 겹침은 시뮬에서만 확인(네이티브 레이아웃). 자동 AC는 typecheck/test green.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처/회귀 체크리스트:
   - `Fab.tsx` 공용 컴포넌트 1개를 두 화면이 재사용(중복 구현 없음).
   - 택배함 FAB 가 빈 상태·멀티선택 모드에서 숨김, 송장 있고 비선택일 때만 노출. 대시보드는 항상 노출.
   - 헤더 '+' 버튼 유지(병존).
   - 색 `tokens.accent`/`onAccent`, 그림자 라이트만, `Plus` 글리프 색은 `color` prop(hex 없음).
   - `onPress` → `router.push("/register")`.
3. 결과에 따라 `phases/v1_1_3/index.json` 의 step 2 를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "신규 Fab.tsx + 두 화면 배선·노출조건 명시"`.
   - 수정 3회 실패 → `"status": "error"`, `"error_message": "..."`.

## 금지사항

- 택배함 헤더 '+' 버튼을 제거하지 마라. 이유: 사용자 결정 "둘 다 유지"(ADR-042).
- 빈 상태·멀티선택 모드에서 FAB 를 노출하지 마라. 이유: 중앙 등록 CTA·선택 액션 헤더와 충돌(ADR-042).
- FAB 색에 `#1b68eb`(스플래시) 등 hex 를 박지 마라. 이유: UI accent 는 `tokens.accent`(=`#007aff`) — 단일 출처.
- 두 화면에 FAB 를 각각 인라인 구현하지 마라. 이유: `Fab.tsx` 단일 컴포넌트 재사용(중복 금지).
- 기존 테스트를 깨뜨리지 마라.
