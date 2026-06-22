# ENGINEERING (통합 문서)

> **비메인 참고 문서 — 실수 재발 방지가 목적이라 정밀하게 유지.** 런타임 함정(PITFALLS)·D1 마이그레이션 절차·운영 런북을 통합.
> 메인 설계 문서는 `PRD`·`ADR`·`ARCHITECTURE`·`UI_GUIDE`. 각 절은 원문 그대로(verbatim) 보존.
> 본문에 나오는 옛 파일명(`PITFALLS.md`·`MIGRATION.md`)은 모두 **이 문서의 해당 절(A·B)**을 가리킨다.

## 목차
- [A. 런타임 함정 & 재발 방지](#a-런타임-함정--재발-방지-구-pitfallsmd)
- [B. D1 마이그레이션 절차](#b-d1-마이그레이션-절차-구-migrationmd)
- [C. 운영 런북 — tracker.delivery 자격증명 재발급](#c-운영-런북--trackerdelivery-자격증명-재발급-21일)

<a id="a-런타임-함정--재발-방지-구-pitfallsmd"></a>

---

# A. 런타임 함정 & 재발 방지 (구 `PITFALLS.md`)

# 런타임 함정 & 재발 방지 (PITFALLS)

> 실제로 발생했던 버그와 **테스트가 못 잡은 이유**, 정확한 수정 패턴, 재발 방지 규칙을 기록한다.
> 핵심 교훈: **mock 기반 `npm run verify` green 은 순수 로직만 보증한다.** 외부 경계(tracker.delivery·Expo Push·D1 런타임·플랫폼 글로벌)는 green 이어도 깨질 수 있다 — 아래 "외부 경계 검증" 체크리스트로 별도 확인할 것.

---

## P-1. Workers: 플랫폼 글로벌(`fetch`)을 deps 로 주입할 때 `this` 유실

- **증상**: 실제 외부 호출이 전부 `Illegal invocation: function called with incorrect 'this' reference` 로 throw. `tryTrack`/cron 이 null 반환 → 운송장 상태가 항상 **"미등록"**. 등록 요청이 네트워크 왕복 없이 ~6ms 만에 실패(동기 throw).
- **원인**: `track(carrier, no, { fetch, ... })` 처럼 전역 `fetch` 를 객체 프로퍼티로 담아 나중에 `deps.fetch(url)` 로 호출하면 `this` 가 전역이 아닌 `deps` 가 되어 workerd 가 거부한다.
- **수정**: 주입 지점에서 바인딩한다 — `fetch: fetch.bind(globalThis)`. 뿌리는 둘:
  - `worker/src/index.ts` `tryTrack` (등록 즉시 1회 조회)
  - `worker/src/index.ts` `scheduled` (cron → `runPollingBatch`)
  - cron 내부(`cron.ts`)는 주입받은 `deps.fetch` 를 재사용하므로 뿌리만 바인딩하면 전파된다.
- **왜 테스트가 못 잡았나**: 모든 단위/통합 테스트가 **mock fetch(평범한 함수·클로저)** 를 주입한다 → `this` 문제가 없다. 전역 `fetch` 는 실제 런타임에서만 등장하므로 `verify` green 이 이 버그에 무의미했다.
- **재발 방지**:
  - 플랫폼 글로벌(`fetch` 등)을 객체 프로퍼티/콜백으로 넘길 땐 **항상** `*.bind(globalThis)` 또는 화살표 래퍼(`(...a) => fetch(...a)`).
  - 외부 호출을 하는 deps 주입 지점을 추가/수정하면 **실제 API 대상 스모크 1회**(아래 체크리스트)로 확인하기 전엔 "동작 확인" 처리 금지.

## P-2. SQLite `ALTER TABLE ... RENAME` 이 다른 테이블 FK 참조까지 전파

- **증상**: `devices` 재생성 마이그레이션 후 운송장 등록의 `INSERT INTO subscriptions` 가 `D1_ERROR: no such table: main.devices_old` 로 500.
- **원인**: 최신 SQLite(D1 포함) 기본값에서 `RENAME` 은 **다른 테이블·트리거·뷰의 참조까지 새 이름으로 자동 재작성**한다. `devices`→`devices_old` rename 시 `subscriptions.device_id` 의 FK 가 `REFERENCES devices_old(id)` 로 바뀌고, 직후 `DROP TABLE devices_old` 로 깨진다.
- **수정**: rename 전에 `PRAGMA legacy_alter_table=ON;` 으로 전파를 끈다. (본 문서 **B.1** 반영 완료.)
- **재발 방지**: 테이블 재생성 마이그레이션 후 `SELECT name FROM sqlite_master WHERE sql LIKE '%<old_name>%'` 로 **옛 이름 잔재 0** 을 검증. 로컬·원격 동일 절차.

## P-3. 로컬 D1 스키마 드리프트 (코드는 바뀌었는데 로컬 D1 는 옛날 생성분)

- **증상**: 코드/`schema.sql` 은 바뀌었는데 로컬 D1 가 이전 생성분 → `push_token NOT NULL`·`notification_queue` 누락으로 **로컬에서만** 데드락·500 재현.
- **원인**: `CREATE TABLE IF NOT EXISTS` 는 **기존 테이블을 변경하지 않는다**(존재 → skip). 또 `schema.sql` 의 `ALTER TABLE ... ADD COLUMN` 은 컬럼이 이미 있으면 `duplicate column` 으로 throw 하여 **그 뒤 문장이 통째로 미적용**된다(예: 뒤에 오는 `notification_queue` 생성이 안 됨).
- **수정/재발 방지**: 스키마 변경 시 **로컬도** 본 문서 **B절** 절차로 마이그레이션. 등록 같은 핫패스는 스키마 변경 후 **실제 요청 1회**로 검증. `npx wrangler d1 execute unboxing --local --command "PRAGMA table_info(<t>)"` 로 로컬 = `schema.sql` 일치 확인.

## P-4. Expo: 네이티브 모듈 추가 후 Metro 빌드가 babel 플러그인 누락으로 깨짐

- **증상**: `react-native-gesture-handler`(+svg) 직접 의존성 추가 후 시뮬레이터에서 빨간 화면 — `[Worklets] Babel plugin exception: Cannot find module '@babel/plugin-transform-shorthand-properties'`. jest(`npm run verify`)는 Metro babel 파이프라인을 안 타서 **green 인데도** 앱이 로드 불가.
- **원인**: `babel-preset-expo`(SDK56)가 gesture-handler 존재를 감지해 worklets babel 플러그인을 활성화하는데, 그 하위 의존(`@babel/plugin-transform-shorthand-properties`)이 설치 트리에 hoist 안 돼 있음.
- **수정/재발 방지**: 누락 플러그인을 `devDependencies` 로 추가(`npm i -D @babel/plugin-transform-shorthand-properties`). **네이티브 의존성을 추가하면 반드시 시뮬레이터 실구동 1회**로 Metro 번들이 뜨는지 확인(jest로는 못 잡음). gesture-handler 의 worklets 부담이 싫으면 RN 코어 `PanResponder` 로 대체 가능.

## P-5. expo-router v56: `headerTitle: () => null` 이 title 을 못 지운다

- **증상**: 루트 `Stack` `screenOptions` 에 `headerTitle: () => null` 을 줘도 stack 화면 헤더에 **route 이름**(`register`·`privacy` 등)이 그대로 표시됨. `headerLeft` 등 다른 screenOptions 는 적용되는데 title 만 남음.
- **원인**: 이 버전의 native-stack 은 함수가 null 을 반환하면 기본 title(route name)로 폴백한다.
- **수정/재발 방지**: title 을 비우려면 **`headerTitle: ""`**(빈 문자열) 또는 `title: ""` 을 쓴다. **헤더 변경은 시뮬 실구동으로 확인**(CI 모드 Metro 는 watch 비활성이라 편집이 반영 안 될 수 있음 → Expo Go 종료 후 재실행/`--clear` 로 강제 리빌드).

## P-6. Expo splash/icon: 가로형 워드마크가 Android 12 시스템 스플래시에서 잘림 + 아이콘 무여백

- **증상**: Play 빌드 첫 실행 스플래시에서 가로 로고("unboxing")의 오른쪽이 잘려 **"unboxir"** 로 표시. 앱 아이콘도 박스가 타일 가장자리까지 차서 **padding 없음**.
- **원인**:
  - expo-splash-screen v56 는 **Android 12 시스템 스플래시 API**(`windowSplashScreenAnimatedIcon` + `android:windowSplashScreenBehavior=icon_preferred`)를 쓴다. 플러그인은 로고를 **288dp 정사각 캔버스**(`288 * multiplier`)에 `imageWidth` 너비로 중앙 배치하고, 시스템은 그중 **지름 192dp(=2/3) 원** 안 콘텐츠만 보장한다(아이콘 배경색 미설정 시 규격). 즉 `imageWidth`/`resizeMode:contain` 은 이 시스템 스플래시에 그대로 적용되지 않는다(iOS 스토리보드·인앱에는 적용).
  - 기존 `imageWidth:300` 은 288dp 캔버스보다 **커서 하드 클립** + 가로 4.4:1 워드마크는 192dp 원도 초과 → 잘림.
  - 아이콘: `icon.png` 박스가 타일의 ~85% 를 채워 런처 마스크에서 가장자리에 붙음. adaptive `android-icon-foreground.png` 가 솔리드가 아닌 **외곽선**이라 다음 빌드에서 흐릿하게 나올 뻔함(중앙 안전영역 규칙·솔리드 불일치).
- **수정**:
  - 스플래시 로고를 **정사각 세로 락업**(박스 위 + 워드마크 아래)으로 재합성하고 콘텐츠를 **내접 원형 안전영역**(192dp 매핑) 안에 배치. `app/app.json` `imageWidth` 300 → **200**(콘텐츠 반경 ≤ 96dp).
  - adaptive foreground·monochrome 는 **솔리드 실루엣을 중앙 ~44%**(마스크+블리드 후 여백 확보), `icon.png`(iOS)는 콘텐츠 ~60% 로 여백.
- **왜 `verify` 가 못 잡나**: 아이콘·스플래시는 **빌드 타임 네이티브 에셋**이라 `npm run verify`(jest/typecheck)와 무관 — green 이어도 잘림. **실 빌드 + 실기기 첫 실행**으로만 최종 확인. 합성 단계는 PIL 로 192dp 원형 안전영역을 그려 **사전 시뮬레이션 검증** 가능.
- **재발 방지**:
  - 스플래시 로고는 **정사각 + 중앙 원형 안전영역(지름 2/3) 기준**으로 디자인. 가로 워드마크 단독 금지.
  - `imageWidth` 는 **≤ 192** 유지(288dp 캔버스·192dp 원 규격).
  - 아이콘 교체 시 adaptive foreground 콘텐츠는 중앙 ~2/3 안전영역의 **솔리드 실루엣**, iOS `icon.png` 는 불투명 풀블리드 + 여백.
  - **에셋·`app.json` 변경 후 로컬 `ios/`·`android/` 재prebuild 필수**: 이 둘은 CNG(gitignore된 prebuild 산출물)라 `app.json`/에셋만 바꾸고 `expo run:ios`(또는 android)를 그냥 돌리면 **stale 네이티브 폴더를 그대로 빌드** — 옛날 스플래시·아이콘·번들ID가 빌드에 박힌다. 반드시 `npx expo prebuild -p ios --clean`(또는 `-p android`) 후 재빌드. (실 사례: 세로 락업 교체 커밋 뒤 iOS 시뮬에 **가로 락업이 그대로** 떴고 번들ID도 옛 `com.anonymous.app` 잔존 → `prebuild --clean` 으로 해소.) 구워진 결과는 `ios/app/Images.xcassets/SplashScreenLogo.imageset/image@3x.png` 를 PIL 로 배경색 합성해 **눈으로 확인** 가능.
  - 관련 파일: `app/app.json`(splash 플러그인), `app/assets/{icon,splash-icon,android-icon-foreground,android-icon-monochrome}.png`.

## P-7. iOS 네이티브 설정: `app/ios/`는 prebuild 생성물(gitignore) — 직접 편집 금지

- **증상**: 스토어 검토 중 `app/ios/app/Info.plist`에서 `NSFaceIDUsageDescription`(영어·모호 문구)이 발견됨. "쓰지도 않는 권한 문자열 → 리젝, 그 줄을 지워라"고 판단하기 쉬움.
- **원인/오해**:
  - `app/ios/`는 `git check-ignore ios` = **gitignore된 `expo prebuild` 산출물(CNG)**. 거기서 `Info.plist`를 손으로 고쳐도 **다음 prebuild/빌드에서 재생성되어 사라진다**(P-6의 `prebuild --clean` 항목과 동일 원리). 네이티브 설정의 진짜 출처는 `app/app.json`(`ios.infoPlist`·`plugins`)이다.
  - `NSFaceIDUsageDescription`은 **코드 실수가 아니라** `expo-secure-store` 플러그인이 항상 주입하는 **기본값**(`node_modules/expo-secure-store/plugin/build/withSecureStore.js`의 `FACEID_USAGE` 상수). SecureStore가 생체인증을 쓸 *수* 있어서 붙는다. 현재 앱은 `requireAuthentication`/`LocalAuthentication` 미사용이라 **리젝 위험은 낮음**.
- **수정**:
  - iOS 네이티브 키는 **`app.json`에서** 바꾼다. 수출규정 면제: `ios.infoPlist.ITSAppUsesNonExemptEncryption=false`(HTTPS·Keychain만 → 표준 암호화 면제). Face ID 문구 개선: `["expo-secure-store", { "faceIDPermission": "<구체적 한국어 사유>" }]`.
  - iPad 심사 제외: `ios.supportsTablet=false`(iPhone 전용, iPad 레이아웃 미검증 리젝 회피).
- **왜 `verify`가 못 잡나**: `app.json`은 typecheck/jest 대상이 아니다(`app/src/lib/__qa__/app-config.test.ts`가 **유효 JSON·키 존재**만 sanity 확인). 실효 검증은 **`expo prebuild` 산출 `ios/.../{Info.plist,PrivacyInfo.xcprivacy}` 병합 결과 + 실 빌드**로만.
- **재발 방지**:
  - `app/ios/`·`app/android/` 안의 파일을 **직접 편집하지 말 것**(gitignore = 생성물 신호). 네이티브 변경은 `app.json`(infoPlist·plugins·privacyManifests)로.
  - `NS*UsageDescription`을 보면 먼저 **어느 플러그인이 주입했는지** 확인(`node_modules/<plugin>/plugin/build/*.js` grep) — 임의 삭제 금지.
  - 스토어 제출 절차·체크리스트: `docs/IOS_SUBMISSION.md`.

## P-8. EAS Android 빌드: 루트 `.gitignore`의 무앵커 디렉터리 패턴이 `app/assets/`를 삼켜 Prebuild 실패

- **증상**: 안드로이드 EAS 빌드가 **Prebuild 단계에서 `UNKNOWN_ERROR`로 ~38초 만에 실패**. `eas build:view`는 "See logs of the Prebuild build phase"만 주고, 웹 로그는 **인증이라 CLI·WebFetch로 못 본다**. 로컬 `expo prebuild`는 **성공**해서 더 헷갈린다(전엔 되던 게 회귀).
- **원인**: 루트 `.gitignore`에 **앵커 없는 `assets/`**(루트 `assets/play-store/` 스토어 스크린샷 무시 의도)가 들어가며 **`app/assets/`(앱 아이콘)까지 매칭**. EAS는 `cli.requireCommit:false`라도 프로젝트 복사 시 `.gitignore`를 존중하므로, **git-tracked 파일이어도** 무시 패턴에 걸리면 업로드 아카이브에서 빠진다 → prebuild `withAndroidIcons`가 `./assets/icon.png`를 못 열어 `ENOENT: ... open './assets/icon.png'`.
- **수정**: 루트 `.gitignore` `assets/` → **`/assets/`**(루트 앵커). `app/assets/`는 안 잡히고 보존된다.
- **진단법(핵심)**: 웹 로그가 막히면 **`eas build:inspect --platform android --profile <p> --stage pre-build --output <dir> --force --verbose`** 로 EAS prebuild를 **클린 체크아웃 기반으로 로컬 재현** → `[PREBUILD] Error: ... ENOENT ... icon.png` 실에러를 바로 확보. **일반 `expo prebuild`로는 재현 안 됨**(더티 워킹디렉터리·기존 에셋이 있어 통과). 회귀 추적은 `eas build:list -p android`로 마지막 FINISHED 시점과 비교.
- **왜 `verify` 가 못 잡나**: `.gitignore`·빌드 아카이브 구성은 typecheck/jest와 무관(P-6·P-7과 같은 "빌드 타임 네이티브 에셋" 부류). EAS 빌드 또는 `build:inspect` 클린 복사에서만 드러난다.
- **재발 방지**: 루트 디렉터리명 무시 패턴(`assets/`·`build/`·`dist/` 등)은 **반드시 앵커(`/`)** 를 붙여 하위 워크스페이스(`app/`)의 동명 폴더를 안 잡게 한다. 빌드가 원인 불명으로 prebuild에서 죽으면 **`eas build:inspect ... --stage pre-build --verbose` 로컬 재현이 1순위 도구**.

---

## 외부 경계 검증 체크리스트 (머지·배포 전 필수)

`npm run verify` 가 green 이어도 아래는 **수동/실호출**로 확인한다. 외부 경계는 mock 으로 가려져 단위테스트가 못 잡는다.

1. **tracker.delivery**: 실제 운송장 번호 1건을 로컬 worker(`wrangler dev`)에 등록 → 응답 status 가 실제 단계로 나오는지. (예: `522093451360`=CJ, `44593463530`=로젠 → `배송완료`.) `미등록` 만 나오면 `Illegal invocation`(P-1)·자격증명·NOT_FOUND 중 무엇인지 로그로 구분.
   - **수취인 패스스루(step2)**: `GET /shipments/:id` 응답의 `recipient`(이름·지역명)가 실제로 채워지는지·마스킹 형태 확인(쿼리 필드명 `recipient { name location { name } }` 변경은 외부 경계라 mock verify 가 못 잡음). 수취인은 **GET /:id track 패스스루(미저장, ADR-005)** — D1 저장·로그 금지, `phoneNumber` 미수신.
2. **cron 폴링**: `curl "http://localhost:8787/cdn-cgi/handler/scheduled"` 트리거 후 목록 status 가 저장·갱신되는지. (로컬 cron 은 자동 실행 안 됨.)
3. **Expo Push**(가능 시): 실제 토큰 1건으로 발송/리시트 경로 확인.
4. **로컬 D1**: `schema.sql` 과 로컬 스키마 일치(P-3).

## 설계(step) 단계 규칙

- "엣지/에러/테스트" 검토 시 **무엇이 테스트로 커버되고 무엇이 런타임에서만 드러나는지**를 명시한다. 후자(플랫폼 글로벌 바인딩·실 API 계약·D1 런타임 제약)는 **수동 검증 항목으로 AC 에 박는다**.
- 외부 의존을 mock 하는 테스트를 작성할 때, 그 mock 이 **숨기는 실패 모드**(바인딩·인증·rate limit·실제 응답 형태)를 주석/AC 로 남긴다.

## 관련 문서

- 본 문서 **B절** — D1 스키마 마이그레이션 절차(P-2·P-3 적용)
- `docs/ARCHITECTURE.md` "tracker.delivery 연동" — 통합 제약(fetch 바인딩 포함)
- `CLAUDE.md` 개발 프로세스 — 외부 경계 검증 규칙(요약 + 본 문서 포인터)


<a id="b-d1-마이그레이션-절차-구-migrationmd"></a>

---

# B. D1 마이그레이션 절차 (구 `MIGRATION.md`)

# 배포 마이그레이션 노트 (D1)

> 원격 D1 스키마를 코드와 일치시키는 **수동 적용 절차**. `qa-fixes` phase 가 바꾼 스키마를 집계한다.
> 스키마 단일 출처: `worker/schema.sql`(= `worker/src/schema.ts SCHEMA_STATEMENTS`, 1:1 유지).

## 적용 명령 (worker/ 에서)

```bash
npx wrangler d1 execute unboxing --file=./schema.sql --remote
```

`schema.sql` 은 idempotent(`CREATE TABLE/INDEX IF NOT EXISTS`)라 **반복 실행 안전**하다. 단, 아래 두 변경은 `IF NOT EXISTS` 만으로 **기존 원격 테이블에 자동 반영되지 않으므로** 주의한다.

## qa-fixes phase 스키마 변경

### 1. `devices.push_token` NOT NULL → nullable (step0, QA-001)

- **변경**: `push_token TEXT NOT NULL UNIQUE` → `push_token TEXT UNIQUE`(NULL 허용). 푸시 거부/미허용 기기도 등록 가능(등록 데드락 해소).
- **주의**: SQLite 는 `ALTER TABLE ... DROP NOT NULL` 을 지원하지 않는다. **이미 `NOT NULL` 로 생성된 원격 `devices` 테이블에는 `CREATE TABLE IF NOT EXISTS` 가 효과 없다**(이미 존재 → skip).
- **적용 절차(기존 테이블이 NOT NULL 인 경우만)** — 테이블 재생성:

  ```sql
  -- worker/ 에서 한 번만 실행. devices 데이터는 비영속(device_id 소실 허용, ADR-002/005)이라 보존 부담 작음.
  PRAGMA foreign_keys=OFF;
  PRAGMA legacy_alter_table=ON;   -- CRITICAL: RENAME 이 다른 테이블 FK 까지 새 이름으로 재작성하는 것을 막는다(아래 주의 참고).
  ALTER TABLE devices RENAME TO devices_old;
  CREATE TABLE devices (
    id          TEXT PRIMARY KEY,
    push_token  TEXT UNIQUE,            -- NULL 허용
    platform    TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  INSERT INTO devices (id, push_token, platform, created_at)
    SELECT id, push_token, platform, created_at FROM devices_old;
  DROP TABLE devices_old;
  PRAGMA legacy_alter_table=OFF;
  PRAGMA foreign_keys=ON;
  ```

  - **CRITICAL — `legacy_alter_table=ON` 필수**: 최신 SQLite(D1 포함)는 기본적으로 `ALTER TABLE ... RENAME` 시 **다른 테이블·트리거·뷰의 참조까지 새 이름으로 자동 재작성**한다. 이 PRAGMA 없이 `devices`→`devices_old` 로 rename 하면 `subscriptions.device_id` 의 FK 가 `REFERENCES devices_old(id)` 로 바뀌고, 직후 `DROP TABLE devices_old` 로 깨진다(이후 구독 INSERT 가 `no such table: devices_old` 로 500). `legacy_alter_table=ON` 으로 전파를 끄면 `subscriptions` FK 는 `devices(id)` 를 그대로 가리켜 재생성된 새 `devices` 에 정상 연결된다.
  - `subscriptions.device_id` 는 `devices(id)` 를 FK 참조한다 → `foreign_keys=OFF` 로 잠시 끄고 데이터 보존 후 다시 켠다. `id` 값은 보존되므로 구독 관계는 유지된다.
  - **신규 배포(아직 `devices` 미생성)**: 위 절차 불필요 — `schema.sql` 이 처음부터 nullable 로 생성한다.
  - **옛 스키마로 이미 존재 + 빈 테이블이면 더 간단(프로덕션 첫 실배포 2026-06-19 사례)**: `devices` 가 옛 `NOT NULL` 로 존재하지만 0행이면 데이터 보존이 불필요하므로 위 RENAME 절차 대신 `DROP TABLE devices; CREATE TABLE devices (id TEXT PRIMARY KEY, push_token TEXT UNIQUE, platform TEXT NOT NULL, created_at INTEGER NOT NULL);` 로 재생성한다(`legacy_alter_table` 불필요 — RENAME 이 아니라 FK 전파 이슈 없음). **CRITICAL**: 원격 D1 이 옛 `schema.sql` 로 생성됐다면 `schema.sql` **재실행은 누락 테이블·`ADD COLUMN` 만 채우고 이 테이블 재생성 마이그레이션(B.1)은 반영하지 않는다** → `devices.push_token` 이 `NOT NULL` 로 남아 `POST /devices`(토큰 없는 기기) 가 500. 배포 직후 `PRAGMA table_info(devices)` 로 `push_token notnull=0` 을 반드시 확인.

### 2. `notification_queue` 신규 테이블 (step3, 조용시간 보류 큐)

- **변경**: `CREATE TABLE IF NOT EXISTS notification_queue (...)` 추가(야간 보류 메시지 스냅샷).
- **적용**: `IF NOT EXISTS` 라 `schema.sql` 재실행 시 **자동 생성**된다(별도 수동 작업 불필요).
- `shipment_id` 는 `shipments(id) ON DELETE CASCADE` 참조 — 송장 삭제 시 보류분 자동 정리.

## 05-redesign-data phase 스키마 변경

### 3. `shipments.status_changed_at` 신규 컬럼 (step0, 상태 변경 시각)

- **변경**: `ALTER TABLE shipments ADD COLUMN status_changed_at INTEGER` 추가(현재 단계가 시작된 시각, epoch ms). 단계 전환 시에만 갱신한다(폴링마다 ❌).
- **주의**: `ALTER TABLE ... ADD COLUMN` 은 컬럼이 이미 있으면 `duplicate column` 으로 throw → `schema.sql` 전체 재실행으로 자동 반영되지 **않는다**. 기존 원격 `shipments` 에는 아래 명령을 **최초 1회만** 실행한다. 단순 ADD COLUMN 이라 RENAME 전파(P-2) 이슈는 없다.

  ```bash
  # worker/ 에서. 최초 1회만(재실행 시 duplicate column 에러).
  npx wrangler d1 execute unboxing --remote --command "ALTER TABLE shipments ADD COLUMN status_changed_at INTEGER"
  ```

- **backfill 안전**: 기존 행은 컬럼이 NULL 이 되지만 API 직렬화가 `status_changed_at ?? created_at` 으로 폴백하므로 backfill 없이도 안전하다(등록 시각을 단계 시작 시각으로 표시).
- **신규 배포(아직 `shipments` 미생성)**: 위 명령 불필요 — `schema.sql` 의 ALTER 가 처음 적용 시 컬럼을 만든다.

### 4. `subscriptions.muted` 신규 컬럼 (step1, ADR-020 송장별 음소거)

- **변경**: `ALTER TABLE subscriptions ADD COLUMN muted INTEGER NOT NULL DEFAULT 0` 추가(per-구독 알림 음소거, 1=음소거/0=켜짐). 기존 구독은 DEFAULT 0 으로 전부 알림 켜짐 유지(안전).
- **주의**: status_changed_at(§3)과 동일 — `ADD COLUMN` 은 컬럼이 이미 있으면 `duplicate column` throw → 기존 원격 `subscriptions` 에는 아래 명령을 **최초 1회만**. 단순 ADD COLUMN 이라 RENAME 전파(P-2) 이슈 없음.

  ```bash
  # worker/ 에서. 최초 1회만(재실행 시 duplicate column 에러).
  npx wrangler d1 execute unboxing --remote --command "ALTER TABLE subscriptions ADD COLUMN muted INTEGER NOT NULL DEFAULT 0"
  ```

- **NOT NULL+DEFAULT 0 안전**: SQLite 는 NOT NULL 컬럼도 DEFAULT 가 있으면 기존 행에 그 값을 채워 ADD COLUMN 이 성공한다.
- **신규 배포(아직 `subscriptions` 미생성)**: 위 명령 불필요 — `schema.sql` 의 ALTER 가 처음 적용 시 컬럼을 만든다.

## 07-backend-v0-v11-notifications phase 스키마 변경

### 5. `notifications` 신규 테이블 (step0, v1.1 ADR-023 알림 기록)

- **변경**: `CREATE TABLE IF NOT EXISTS notifications (...)` + `CREATE INDEX IF NOT EXISTS idx_notifications_device_sent` 추가(발송한 알림 기록 — `device_id`·`shipment_id`[nullable, `ON DELETE SET NULL`]·`carrier`·`last4`·`body`·`stage`·`sent_at`). 수령인 없는 비-PII.
- **적용**: `IF NOT EXISTS` 라 `schema.sql` 재실행 시 **자동 생성**된다(notification_queue·step3 과 동일 — RENAME·ADD COLUMN 함정 없음, P-2 무관). 로컬·원격 동일.

  ```bash
  # worker/ 에서. 멱등(IF NOT EXISTS)이라 재실행 안전.
  npx wrangler d1 execute unboxing --remote --file=schema.sql
  npx wrangler d1 execute unboxing --remote --command "PRAGMA table_info(notifications)"
  # 로컬도 동일: --local 로 교체
  ```

- `shipment_id` 는 `shipments(id) ON DELETE SET NULL` 참조 — 송장 정리돼도 기록 보존(딥링크만 무효). `src/schema.ts SCHEMA_STATEMENTS` 도 1:1 동기화(두 문장).
- **앱 로컬(AsyncStorage) 마이그레이션**: 구 `unboxing.memos`(메모 문자열) → `unboxing.shipment_info`(`{memo,category,amount}`) 변환은 D1 이 아니라 **앱 bootstrap 에서 1회·멱등** 수행된다(`migrateMemosToInfo`). 별도 적용 명령 없음 — 구 키 보유 상태로 v1.1 첫 실행 시 메모가 보존되는지 **E-5 스모크**(A절 외부 경계 체크리스트 연계)로 확인한다.

## 적용 후 확인

```bash
# 스키마 확인
npx wrangler d1 execute unboxing --command="SELECT name FROM sqlite_master WHERE type='table'" --remote
# devices.push_token 이 nullable 인지(notnull=0)
npx wrangler d1 execute unboxing --command="PRAGMA table_info(devices)" --remote
# shipments.status_changed_at 컬럼 존재 확인
npx wrangler d1 execute unboxing --command="PRAGMA table_info(shipments)" --remote
# subscriptions.muted 컬럼 존재 확인(notnull=1, dflt=0)
npx wrangler d1 execute unboxing --command="PRAGMA table_info(subscriptions)" --remote
# notifications 테이블 컬럼 확인(v1.1 — id·device_id·shipment_id·carrier·last4·body·stage·sent_at)
npx wrangler d1 execute unboxing --command="PRAGMA table_info(notifications)" --remote
```

`devices.push_token` 의 `notnull` 이 `0`, `notification_queue`·`notifications` 가 테이블 목록에 보이고, `shipments` 에 `status_changed_at`·`subscriptions` 에 `muted` 컬럼이 보이면 적용 완료.

## 관련 문서

- `docs/ARCHITECTURE.md` "스키마 진화 / 마이그레이션"·"데이터 모델"
- step0(register-fix)·step3(quiet-hours) 산출물 · `worker/schema.sql`


<a id="c-운영-런북--trackerdelivery-자격증명-재발급-21일"></a>

---

# C. 운영 런북 — tracker.delivery 자격증명 재발급 (21일)

> ADR-013: Free 플랜 client 자격증명은 **21일 만료**라 주기적 **수동 재발급**이 필요하다 — "$0 무인 운영의 유일한 균열". 만료되면 access token 재발급이 `UNAUTHENTICATED` 로 전부 실패해 **모든 폴링·등록 즉시 조회가 중단**(운송장이 일제히 "미등록")된다. 프로덕션 라이브(2026-06-19) 이후 실제 운영 항목이라 절차를 박아 둔다.

## 트리거
- 만료 임박(**권장 7일 전** — ADR-013) 또는 `wrangler tail` 에 tracker.delivery `UNAUTHENTICATED`/토큰 발급 실패 로그가 반복될 때.
- 증상: 신규 등록이 전부 `미등록`, cron 폴링이 상태를 못 갱신. (P-1 `Illegal invocation` 과 구분 — 그쪽은 ~6ms 동기 throw, 이쪽은 GraphQL `errors[].UNAUTHENTICATED`.)

## 절차 (worker/ 에서)
1. **tracker.delivery 콘솔**에서 client 자격증명을 재발급한다(신규 `CLIENT_ID`/`CLIENT_SECRET`).
2. Worker 시크릿 갱신 (ARCHITECTURE "환경변수 & 시크릿" 표 기준):
   ```bash
   npx wrangler secret put DELIVERY_TRACKER_CLIENT_ID
   npx wrangler secret put DELIVERY_TRACKER_CLIENT_SECRET
   ```
3. **캐시된 access token 무효화** — 다음 호출이 새 자격증명으로 재발급하도록 `tracker_token` 캐시를 비운다.
   ```bash
   npx wrangler d1 execute unboxing --remote --command "DELETE FROM tracker_token"
   ```
4. **검증(필수)**: 실 운송장 1건으로 외부 경계 스모크(A절 체크리스트 1) — 등록 후 status 가 실제 단계로 나오면 복구. `미등록` 만 나오면 자격증명/토큰을 재확인(콘솔에서 새 값이 맞는지·`tracker_token` 이 정말 비었는지).

## 자동화 여부 / 에스컬레이션
- Free 자격증명의 **API 자동 재발급 가능 여부는 미검증**(ADR Open Questions Q5). 가능하면 cron 으로 자동화해 이 런북을 폐기할 수 있다 — 콘솔 확인 후 ADR-013 갱신.
- 재발급 누락 시 폴링 전면 중단 위험 → 만료 임박 알림(로그/운영자 통지)을 둔다(ADR-013, 미구현 시 구현 대상).
- 재발급 운영 부담이 커지면 **Pro(무만료, 유료) 전환**이 최후 수단($0 제약 위반이라 마지막).

## 관련 문서
- `docs/ADR.md` ADR-013(토큰 캐싱·21일 수동 재발급)·Open Questions Q5
- `docs/ARCHITECTURE.md` "tracker.delivery 연동"·"환경변수 & 시크릿"(시크릿 이름)
- 본 문서 **A절** 외부 경계 검증 체크리스트(재발급 후 스모크)
