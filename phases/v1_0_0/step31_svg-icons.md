# Step 31: svg-icons — SVG 아이콘 시스템 (OS 이모지 전면 제거)

시스템 전체에서 **SVG 라인 아이콘을 적극 사용**한다. **OS 기본 이모지/유니코드 글리프(`○ • ▸ ✓ ! ▾ ▴ ✕ ✓` 등)를 절대 쓰지 않는다.** 적절한 아이콘이 없으면 직접 SVG로 만든다. 이 step은 아이콘 컴포넌트 세트를 만들고, 가장 먼저 `StageBadge` 의 텍스트 글리프를 SVG로 교체한다.

## 읽어야 할 파일
- `/docs/UI_GUIDE.md` — "단계 배지"(색+아이콘+라벨, 색 단독 금지), "아이콘"(라인 1.5, 둥근 배경 박스 금지), "테마 & 색상"(토큰), "접근성"(색단독 금지·터치타깃 44·스크린리더)
- `/docs/ADR.md` — ADR-016(테마)
- `app/AGENTS.md` — **Expo SDK 56. 코드 작성 전 https://docs.expo.dev/versions/v56.0.0/ 의 정확한 버전 문서를 확인.**
- `app/src/theme/tokens.ts`, `app/src/theme/ThemeProvider.tsx` — 색 토큰(`stage.*`, `text.*`)
- `app/src/components/StageBadge.tsx` — 교체 대상(현재 텍스트 글리프 맵 `STAGE_META`)
- `app/src/lib/api.ts` — `Stage` 유니온(미등록/등록/집화/이동중/배송출발/배송완료/예외/기타)

## 작업

### 1. 의존성
- `cd app && npx expo install react-native-svg` (SDK 56 호환 버전 자동 선택). `package.json` 직접 의존성에 추가됨을 확인.

### 2. 아이콘 컴포넌트 세트 — `app/src/components/icons/`
- 공통 시그니처: `({ size = 20, color, strokeWidth = 1.5, ...a11y }) => JSX`. `react-native-svg` 의 `Svg/Path/Circle` 등으로 라인 아이콘 구현(둥근 배경 박스로 감싸지 않음 — UI_GUIDE).
- 필요한 아이콘(이름 예시):
  - 네비/액션: `ChevronLeft`(뒤로가기), `Plus`(운송장 추가), `Trash`(삭제), `Bell`/`BellOff`(알림 켜짐/음소거), `Gear`(설정 탭), `Package`(택배함 탭).
  - 단계 글리프(StageBadge·상세 인디케이터 공용): `Clock`(미등록), `DotSmall`(등록/집화/이동중/기타 중립), `Truck`(배송출발), `CheckCircle`(배송완료), `AlertTriangle`(예외).
- 각 아이콘은 `color` 를 prop으로 받아 토큰 색을 주입받는다(하드코딩 hex 금지). 단색 라인.
- 배럴 `app/src/components/icons/index.ts` 로 export.

### 3. StageBadge SVG 교체
- `STAGE_META` 의 `glyph: string` → `icon: 아이콘 컴포넌트` 로 바꾼다. 단계→아이콘 매핑:
  - 미등록=`Clock`, 등록/집화/이동중/기타=`DotSmall`, 배송출발=`Truck`, 배송완료=`CheckCircle`, 예외=`AlertTriangle`.
- 색은 기존 `tokens.stage[meta.color]` 유지(색+아이콘+라벨 — 색 단독 금지 불변). 라벨 텍스트 유지.
- `accessibilityLabel={`단계: ${stage}`}` 유지. 아이콘에는 `accessibilityElementsHidden`/`importantForAccessibility="no"` 로 라벨 중복 방지(배지 컨테이너가 라벨 제공).

### 4. 접근성/일관성
- 아이콘 단독으로 의미를 전달하는 버튼은 반드시 `accessibilityLabel` 을 가진 부모 Pressable로 감싼다. 터치 타깃 ≥44×44(hitSlop 또는 패딩).

## 금지사항
- OS 이모지·유니코드 글리프(`○ • ▸ ✓ ! ▾ ✕` 등)를 UI에 쓰지 마라. 이유: 사용자 명시 요구 — 전면 SVG.
- 아이콘을 둥근 배경 박스로 감싸지 마라(UI_GUIDE 아이콘 규칙).
- hex 색을 아이콘에 하드코딩하지 마라 — 토큰 색을 prop으로 주입.
- 이 step에서 네비게이션 구조(Tabs)·화면 로직은 건드리지 마라(step1+에서). StageBadge 외 화면의 글리프 교체는 각 화면 step에서 그 화면과 함께 한다.
- 기존 테스트를 깨뜨리지 마라.

## Acceptance Criteria
```bash
npm run verify   # typecheck + test (app + worker + harness)
```
- 추가로: `grep -RnE "[○•▸✓✕▾▴]" app/src/components/StageBadge.tsx` 결과가 비어야 한다(글리프 잔존 없음).

## 검증 절차
1. AC 실행 + 위 grep 확인.
2. 체크리스트: react-native-svg 직접 의존성 / StageBadge 색+SVG아이콘+라벨 유지(색 단독 아님) / a11y 라벨 / 기존 테스트 무파손.
3. `phases/06-ui-v0-redesign-pages/index.json` step 0 업데이트(summary에 생성한 아이콘 목록·경로 기재 — 다음 step들이 재사용).
