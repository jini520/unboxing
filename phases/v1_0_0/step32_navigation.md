# Step 32: navigation — 하단 탭 + 헤더 정리 + 아이콘-only 뒤로가기 + API 계약

공통 페이지 구조를 바꾼다: **하단 탭 네비게이션(택배함·설정)** 도입, **상단 헤더의 title 전체 삭제**, **뒤로가기 버튼은 아이콘만**(텍스트·기타 스타일 제거). 또한 백엔드 phase 05가 추가한 필드(`status_changed_at`·`muted`·`recipient`)를 소비하도록 **app API 클라이언트 계약**을 확장한다.

## 읽어야 할 파일
- `app/AGENTS.md` — **Expo SDK 56. 코드 전 https://docs.expo.dev/versions/v56.0.0/ 확인** (expo-router `Tabs`, `Stack` screenOptions, header 옵션의 정확한 v56 API).
- `/docs/ARCHITECTURE.md` — "앱 아키텍처 (Expo)", "HTTP API 계약"(phase 05에서 `status_changed_at`·`muted`·`recipient`·`PATCH /shipments/:id` 추가됨)
- `/docs/UI_GUIDE.md` — "화면 구성", "인터랙션", "접근성"
- `phases/05-backend-v0-redesign-data/` 의 step0~2 — **서버 계약의 단일 출처**. 응답 필드명(`status_changed_at`, `muted`, `recipient{name,regionName}`)과 `PATCH /shipments/:id {muted}` 를 그대로 따른다.
- `app/app/_layout.tsx`(루트 Stack), `app/app/index.tsx`(목록), `app/app/settings.tsx`(설정), `app/app/shipment/[id].tsx`, `app/app/register.tsx`, `app/app/onboarding.tsx`
- `app/src/lib/api.ts` + `app/src/lib/api.test.ts`
- `app/src/components/icons/`(step0 산출 — `ChevronLeft`, `Package`, `Gear`)

## 작업

### 1. API 클라이언트 계약 — `app/src/lib/api.ts`
- `Shipment` 에 `statusChangedAt: number` 와 `muted: boolean` 추가. `RawShipment` 에 `status_changed_at?: number | null`, `muted?: boolean` 추가.
- `toShipment` 매핑(구버전 서버 graceful): `statusChangedAt: raw.status_changed_at ?? raw.created_at`, `muted: raw.muted ?? false`.
- `getShipment` 반환에 `recipient: Contact | null` 추가. `export interface Contact { name?: string; regionName?: string }`. 응답 `recipient`(null 가능) 그대로 매핑.
- 신규 `muteShipment(id: string, muted: boolean, deps: ApiDeps): Promise<void>` — `PATCH /shipments/:id` 바디 `{ muted }`, 204 기대. `request` 헬퍼에 `PATCH` 가 통하는지 확인(method 문자열만 바꾸면 됨).
- `api.test.ts` 보강: 새 필드 매핑(폴백 포함), `muteShipment` 가 올바른 method/path/body 로 호출.

### 2. 하단 탭 네비게이션 — expo-router `Tabs`
- 라우트 그룹 `app/app/(tabs)/` 생성:
  - `app/app/(tabs)/_layout.tsx` — `<Tabs screenOptions={{ headerShown: false }}>`. 탭 2개:
    - `index` → 라벨 **"택배함"**, 아이콘 `Package`(활성=`text.primary`, 비활성=`text.secondary`).
    - `settings` → 라벨 **"설정"**, 아이콘 `Gear`.
  - `app/app/index.tsx` → `app/app/(tabs)/index.tsx` 로 이동, `app/app/settings.tsx` → `app/app/(tabs)/settings.tsx` 로 이동(파일 이동, 내용은 step2/step4에서 개편).
  - 탭바 색·보더는 토큰(`bg.surface`/`border`/`text.*`). 탭 라벨+아이콘 함께(색 단독 금지). 터치 타깃 ≥44.
- MVP에서는 이 **두 탭만**. (register/shipment/onboarding/privacy 는 탭이 아니라 그 위에 push 되는 stack 화면.)

### 3. 루트 Stack + 헤더 정리 — `app/app/_layout.tsx`
- 루트 `<Stack>` 의 children: `(tabs)`(헤더 없음) + `shipment/[id]` + `register` + `onboarding` + `privacy`(step4 신설).
- **헤더 title 전체 삭제**: stack 화면들의 `Stack.Screen options` 에서 `title` 을 제거하고 `headerTitle: () => null`(또는 빈 타이틀)로. 각 화면 파일의 `<Stack.Screen options={{ title: ... }} />` 도 title 제거.
- **뒤로가기 아이콘만**: `headerLeft: () => <Pressable><ChevronLeft/></Pressable>`(router.back), `headerBackVisible: false`(기본 chevron+텍스트 숨김), `headerBackTitle`/타이틀 텍스트 제거. v56에서 권장되는 정확한 옵션명은 versioned 문서로 확인하되 **결과는 "아이콘만, 텍스트·기타 스타일 없음"**.
- 헤더 배경/구분선은 토큰(혹은 `headerShadowVisible:false` 로 미니멀). 색 하드코딩 금지.

### 4. 딥링크 보존 (회귀 주의)
- 푸시 탭 → `shipment/:id` 딥링크가 탭 그룹 도입 후에도 동작해야 한다(payload `shipment_id`). `usePushNotifications`/라우팅 경로(`/shipment/${id}`)가 그대로 유효한지 확인. 목록 라우트가 `(tabs)` 그룹으로 가도 경로 `/` 와 `/shipment/[id]` 는 유지된다(그룹은 URL에 안 나타남).

## 금지사항
- 화면 내부 로직(목록 카드·상세 타임라인 등)을 이 step에서 재작성하지 마라 — 구조(라우팅/헤더/계약)만. 이유: scope 분리(다음 step들).
- 헤더에 title 텍스트를 남기지 마라(요구사항). 뒤로가기에 텍스트/커스텀 배경을 붙이지 마라 — 아이콘만.
- 서버 응답 필드명을 임의로 바꾸지 마라 — phase 05 계약(`status_changed_at`/`muted`/`recipient`)을 그대로 매핑.
- 구버전 서버 응답(필드 누락)에서 크래시하지 마라 — `?? createdAt`/`?? false`/`?? null` 폴백.
- 기존 테스트를 깨뜨리지 마라.

## Acceptance Criteria
```bash
npm run verify
```
- 라우터 구조상 `/`(택배함)·`/settings` 가 탭, `/shipment/[id]`·`/register`·`/onboarding` 가 stack 으로 분리됨.

## 검증 절차
1. AC 실행.
2. 체크리스트: 탭 2개(택배함·설정) / 헤더 title 없음 / 뒤로가기 아이콘만 / api 계약 매핑+폴백+muteShipment 테스트 통과 / 딥링크 경로 유지 / 토큰 색만.
3. `phases/06-ui-v0-redesign-pages/index.json` step 1 업데이트(summary에 라우트 트리·api 시그니처 기재 — 다음 step들이 의존).
