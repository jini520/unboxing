# Step 8: foundation (expo-router + 테마 + env)

Expo 앱의 토대. expo-router 도입(파일 기반 라우팅·딥링크), 시스템 추종 테마 시스템(시맨틱 토큰·라이트/다크), 서버 URL env, 폴더 구조를 세운다. **화면 내용·데이터 로직은 만들지 않는다**(이후 step).

## 읽어야 할 파일

먼저 아래를 읽고 Expo SDK 56 idiom·앱 아키텍처·디자인 토큰을 파악하라:

- **https://docs.expo.dev/versions/v56.0.0/** — SDK 56 정확한 API (AGENTS.md 지시: 코드 작성 전 필수)
- **https://docs.expo.dev/router/introduction/** — expo-router 구조·entry·딥링크
- `/Users/jinni/Developments/unboxing/app/AGENTS.md` — "Expo HAS CHANGED" 경고
- `/docs/ARCHITECTURE.md` — "앱 아키텍처 (Expo)", "환경변수 & 시크릿 → App (Expo)"
- `/docs/ADR.md` — ADR-016(테마: 시스템 추종·라이트 기준), ADR-014(서버 SOT)
- `/docs/UI_GUIDE.md` — "테마 & 색상 (시맨틱 토큰)", "AI 슬롭 안티패턴"
- `/Users/jinni/Developments/unboxing/app/app.json` · `package.json` · `App.tsx` · `index.ts` — 현재 bare 스캐폴드
- `/Users/jinni/Developments/unboxing/app/src/lib/tracking.ts` · `tracking.test.ts` — 유지할 기존 코드·테스트 스타일(`@jest/globals`)

## 작업

### 1. 의존성 설치 (SDK 56 호환 버전)

`app/` 에서 `npx expo install` 로 한 번에 설치(버전 자동 해석):

```
expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants \
expo-crypto expo-secure-store @react-native-async-storage/async-storage expo-notifications expo-clipboard
```

(이후 step들이 쓰는 모듈을 미리 깐다. 이 step에서 코드로 쓰는 것은 router·constants·async-storage 정도.)

### 2. expo-router 전환

- `package.json` 의 `"main"` 을 `"expo-router/entry"` 로 변경.
- `app.json` 의 `expo` 에: `"scheme": "unboxing"`(딥링크), `"userInterfaceStyle": "automatic"`(시스템 추종 — ADR-016), `"plugins": ["expo-router"]` 추가.
- 라우트 디렉토리 `app/app/` 생성:
  - `app/app/_layout.tsx` — 루트 레이아웃. `SafeAreaProvider` + 아래 `ThemeProvider` 로 감싼 expo-router `<Stack>`. (개별 화면 옵션은 각 화면 step에서.)
  - `app/app/index.tsx` — 목록 화면 **플레이스홀더**(유효한 최소 화면, step5가 교체).
- **불필요해진** `app/App.tsx` · `app/index.ts` 를 제거한다(expo-router/entry가 등록을 대신하므로 orphan). 이유: 이 변경이 만든 orphan만 정리(surgical).

### 3. 테마 시스템 `app/src/theme/`

- `tokens.ts` — UI_GUIDE "시맨틱 토큰"의 라이트/다크 값을 `light`·`dark` 토큰 객체로. (배경/보더/텍스트/단계색.) hex는 **여기에만**, 컴포넌트는 토큰명 참조.
- `ThemeProvider.tsx` — 테마 선호(`'system' | 'light' | 'dark'`, 기본 `'system'`)를 AsyncStorage에 영속하는 컨텍스트. `useColorScheme()`과 결합해 활성 토큰 세트를 결정.
- `useTheme()` 훅 — 활성 토큰 + 현재 선호 + `setPreference(pref)` 반환. (설정 화면 step7이 `setPreference` 사용.)
- 순수 함수 `resolveTokens(preference, systemScheme)` 분리 → 테스트.

### 4. env `app/src/config.ts`

- `EXPO_PUBLIC_API_URL` 을 읽어 `API_URL` 로 export. **하드코딩 금지**(ARCHITECTURE 환경변수). 미설정 시 개발 편의를 위한 안전한 기본(`http://localhost:8787` 등)만 허용하되 주석으로 명시.
- `app/.env.example` 에 `EXPO_PUBLIC_API_URL=` 문서화. `app/.gitignore` 에 `.env.local` 추가(없으면).

### 5. 테스트

`app/src/theme/tokens.test.ts`(`@jest/globals`): `resolveTokens('light', 'dark')` → light 토큰, `resolveTokens('system', 'dark')` → dark 토큰 등.

## 핵심 규칙 (벗어나면 안 됨)

- `userInterfaceStyle` 은 **`automatic`**(시스템 추종). `dark`/`light` 고정 금지. 이유: ADR-016.
- 색은 **시맨틱 토큰**으로만. 컴포넌트에 hex 하드코딩 금지. 이유: UI_GUIDE, 라이트/다크 동등 지원.
- 서버 URL 하드코딩 금지 — `EXPO_PUBLIC_API_URL`. 이유: ARCHITECTURE 환경변수.
- `EXPO_PUBLIC_` 변수에 어떤 비밀도 넣지 마라(번들 인라인 노출). 이유: ARCHITECTURE.
- AI 슬롭 안티패턴(글래스모피즘·그라데이션 텍스트·보라 브랜드·글로우·균일한 큰 radius) 도입 금지. 이유: UI_GUIDE.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

설치 후 `npm --prefix app run typecheck` 가 expo-router 타입을 인식해야 한다(필요 시 `npx expo customize` 없이도 expo가 생성하는 타입 사용).

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `app.json userInterfaceStyle` = `automatic`, `scheme`·`expo-router` plugin 설정됐는가?
   - `package.json main` = `expo-router/entry`, `App.tsx`/`index.ts` orphan 제거됐는가?
   - 토큰이 UI_GUIDE 라이트/다크 값과 일치하는가?
   - 기존 `tracking.test.ts` 가 여전히 통과하는가?
3. `phases/app-ui/index.json` 의 step 0 을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 3회 실패 → `"status": "error"`, `"error_message"`
   - 사용자 개입 필요(예: SDK 호환 깨짐) → `"status": "blocked"`, `"blocked_reason"` 후 중단

## 금지사항

- 화면 UI·데이터 fetch·푸시 로직을 구현하지 마라. 이유: 각 화면/데이터 step의 책임. 여기는 토대만.
- 색을 컴포넌트에 hex로 박지 마라. 이유: 시맨틱 토큰 단일 출처.
- 기존 `app/src/lib/tracking.ts` 와 그 테스트를 변경·삭제하지 마라. 이유: 등록 step이 재사용한다.
- 기존 테스트를 깨뜨리지 마라.
