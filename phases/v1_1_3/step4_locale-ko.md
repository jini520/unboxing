# Step 4: locale-ko (#5 앱 지원 로케일 선언 — 네이티브 편집 메뉴 한국어화)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/app/AGENTS.md` — **Expo는 바뀌었다. v56 문서 확인.** 특히 config plugin·`expo-localization`·`app.json` plugins 배열.
- `/docs/ADR.md` — **ADR-044**(`expo-localization` supportedLocales 선언 — 시스템 UI 한국어, 런타임 i18n 라이브러리 없음) 전문.
- `/docs/ENGINEERING.md` — **P-11**(로케일 선언은 네이티브 리빌드 필요 + `app.json` 단일 출처 — 증상·수정·함정). **P-7**(`app/ios/` 산출물 직접 편집 금지 — prebuild 재생성으로 사라짐).
- `/docs/ARCHITECTURE.md` — "v1.1.3" 절의 **로케일 선언(#5)** 항.
- `app/app.json` — 현재 `expo.plugins` 배열: `expo-router`·`expo-secure-store`·`expo-splash-screen`·`expo-image-picker`. **로케일/`CFBundleLocalizations` 선언 전무**(이게 문제 — iOS 가 base 영어로 시스템 UI 그림).
- `app/package.json` — dependencies(현재 `expo-localization` 없음).

## 작업

빌드 설정만 변경. 런타임 코드·i18n 라이브러리 도입 **없음**(앱 문자열은 이미 전부 한국어 하드코딩).

### (A) 의존성 설치
- `expo-localization` 을 **SDK 56 호환 버전으로** 설치: `npx --prefix app expo install expo-localization`(또는 `cd app && npx expo install expo-localization`). **임의 버전 `npm install` 금지** — `expo install` 이 SDK에 맞는 버전을 고른다.

### (B) `app/app.json` plugins 에 로케일 선언 추가
- `expo.plugins` 배열에 추가:
  ```json
  ["expo-localization", { "supportedLocales": { "ios": ["ko", "en"], "android": ["ko", "en"] } }]
  ```
- 결과: iOS `CFBundleLocalizations` 에 `ko` 등록 → 시스템 제공 UI(텍스트 선택 메뉴 복사/붙여넣기/전체 선택, 시스템 다이얼로그)가 기기 언어(한국어)를 따른다.

**핵심 규칙:**
- **`app.json` 이 단일 출처** — `app/ios/Info.plist`(`CFBundleLocalizations`/`CFBundleDevelopmentRegion`)를 손으로 고치지 마라(P-7 — prebuild 재생성으로 사라짐).
- **런타임 i18n 라이브러리(i18next 등) 도입 금지** — 번역이 필요한 게 아니라 시스템 UI 로케일만 문제(ADR-044).
- 이 변경은 **config plugin** 이라 JS만으론 반영 안 됨 → **네이티브 리빌드 필요**(step 5 스모크에서 dev build 로 확인).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

> ⚠️ `verify`(jest/typecheck)는 **로케일 적용을 못 잡는다**(네이티브 빌드 산출물 — P-11). 자동 AC는 의존성 설치 후 typecheck/test green + `app.json` 에 plugin 선언 존재까지. 실제 편집 메뉴 한국어는 step 5 의 dev build 스모크.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처/회귀 체크리스트:
   - `app/app.json` plugins 에 `["expo-localization", { supportedLocales: { ios:["ko","en"], android:["ko","en"] } }]` 존재.
   - `app/package.json` 에 `expo-localization`(SDK56 호환 버전) 추가, lockfile 갱신.
   - `app/ios/`·`app/android/` 산출물을 직접 편집하지 않음(있다면 — `app.json` 단일 출처).
   - 런타임 i18n 라이브러리 미도입.
3. 결과에 따라 `phases/v1_1_3/index.json` 의 step 4 를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "app.json expo-localization plugin + dep — 리빌드 후 편집메뉴 한국어 스모크는 step 5"`.
   - 수정 3회 실패 → `"status": "error"`, `"error_message": "..."`.

## 금지사항

- `app/ios/Info.plist` 등 네이티브 산출물을 직접 편집하지 마라. 이유: prebuild 재생성으로 사라진다(P-7) — `app.json` 단일 출처.
- 런타임 i18n 라이브러리를 추가하지 마라. 이유: 앱 문자열은 이미 한국어 — 시스템 UI 로케일만 선언하면 됨(ADR-044).
- `expo-localization` 을 `npm install <임의버전>` 으로 넣지 마라. 이유: SDK56 호환 버전을 `expo install` 이 고른다(버전 미스매치 방지).
- 기존 테스트를 깨뜨리지 마라.
