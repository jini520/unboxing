# ROADMAP & 진행 현황

> **비메인 참고 문서.** 메모리가 없어도 **무엇을 했는지(진행 현황)·무엇을 해야 하는지(예정 작업)**를 한 파일에서 파악하기 위한 문서.
> 권위 출처: 완료 단계는 `phases/index.json`·git 히스토리, 결정은 `ADR`, 발견 갭은 `QA`. 본 문서는 그 요약 + 예정 작업 계획.

## 진행 현황 (무엇을 했는가)

**Phase 1 (MVP) — 국내·익명·tracker.delivery Free.** 핵심 경로 구현·QA·런타임 버그 수정까지 완료, 로컬 iOS 시뮬레이터 + 로컬 worker 로 동작 확인됨.

완료 단계(`phases/` — 상세는 각 phase index.json·step):
- `01-backend-v0-mvp-worker` — Cloudflare Worker HTTP API + cron 폴링 + 멱등 푸시 + D1 (PR #1)
- `02-ui-v0-mvp-app` — Expo 앱: 목록/상세/등록/온보딩/설정 (PR #2)
- `03-qa-v0-mvp` — MVP QA: E2E 시나리오 + 사양 감사 (발견 12건, PR #4)
- `04-qa-v0-mvp-fixes` — P0~P2 수정: 등록 데드락·택배사·조용시간·데모·스토어 준비 (PR #16)

QA 이후 런타임 버그·UX 수정(main 머지):
- PR #17 — `fetch` this-binding(`Illegal invocation`) 수정: 실제 tracker.delivery 호출 복구. 재발 방지 문서화(`ENGINEERING` A절).
- PR #18 — CI flaky 타임아웃 해소(테스트 즉시 track no-op) + 목록·상세 **택배사 한글명** 표기.
- PR #19 — 등록 직후 목록에 **실제 상태 즉시 표시**(비종료 단계 저장).
- PR #20 — **배송완료 시 보관**(자동 삭제 폐기, 사용자 수동 삭제 — ADR-005 개정).

**프로덕션 배포 (2026-06-19):**
- **Worker 배포** → `https://unboxing-worker.dev-jinni520.workers.dev` (cron `*/15` 등록). 원격 D1 스키마 최신화(누락 테이블·컬럼 + `devices` 재생성으로 `push_token` nullable, ENGINEERING B.1) · tracker.delivery 시크릿 등록 · **실호출 스모크 green**(실 CJ 운송장 → `배송완료`, 시뮬레이터 앱 → 워커 `GET /shipments` Ok).
- **앱**: 번들ID `com.jinni.unboxing`(iOS·Android) · 표시명 `언박싱` · EAS 프로젝트 `@jinni520/app`(projectId 연결) · `eas.json` 내부배포(internal) 프로파일 · `EXPO_PUBLIC_API_URL`=prod.
- **iOS 실기기 빌드**: Apple Developer 멤버십 결제 완료, **활성화(team 생성) 대기 중** — 활성화 후 `eas device:create` → `eas build -p ios --profile preview`. 상세 경로 → 아래 "실기기 설치·배포 경로".
- **iOS App Store 출시 준비 (2026-06-22):** 멤버십 활성. 정책 검토 완료 — **리젝 항목 없음**. `app.json` 패치 적용(`ITSAppUsesNonExemptEncryption=false`·`supportsTablet=false` iPhone 전용·`expo-secure-store faceIDPermission`). 절차·콘솔 체크리스트 → **`docs/IOS_SUBMISSION.md`**. `eas submit -p ios`는 **사용자 지시 대기**.

**v1.1 마이너 업데이트 (phase 07~11) — 구현·설계정정·버그수정 완료 (2026-06-23):**
- **07~10 구현·main 머지 완료** — 대시보드·휴지통(30일 로컬 복구)·알림 기록(서버 로그+로컬 캐시)·택배 정보(메모+카테고리+금액)·시작 화면 설정·완료 숨기기. 머지 커밋: `07`→`eb3030a`, `08`→`f7a11c6`, `09`→`b9c5f83`, `10`→`7c1b560`. 실행 순서: `07-backend-v0-v11-notifications`(notifications·#9 한글명·휴지통 알림차단) → `08-ui-v0-v11-logic`(순수 로직 test-first) → `09-ui-v0-v11-screens`(삭제UX[확인 다이얼로그+햅틱] 복원) → `10-qa-v0-v11-release`(라이브 `privacyPolicy.ts` 정정). 설계: `PRD`/`ARCHITECTURE` "v1.1 …", `ADR` ADR-021~025, `UI_GUIDE` "v1.1 화면 …".
- **11-qa-v0-v11-fixes 구현·설계정정 완료** — iOS 시뮬 스모크 후속 수정(권위 출처 `phases/index.json`·git):
  - **A1(설계 정정)** 대시보드 6→**4카드**(진행 중·배송완료·휴지통·새 알림) + 항목별 의미색. "확인 필요(예외)"·"오늘 도착" 카드 폐기, 예외는 진행 중에 흡수(`dashboardCounts`·`filter.ts`). `PRD`·`UI_GUIDE`·`ADR-021` 사양 동기화.
  - **A2(설계 정정)** 택배함 필터 칩(전체/진행중/임박/완료/예외) **전면 제거** + "배송 완료된 항목 감추기" 토글을 **설정→택배함 상단**으로 이동. `filterShipments`는 `hideCompleted` 전용. `PRD`·`UI_GUIDE`·`ADR-021`(필터 라우팅 철회) 사양 동기화.
  - **B1(버그)** 빈 목록 시 대시보드 무한 스피너 — `sync` 의 `listShipments` catch 가 실패 시 shipments 를 null 로 방치하던 것을 `setShipments(prev=>prev??[])` 폴백으로 수정(빈 상태 진입).
  - **B2(버그)** 알림·휴지통 헤더 상단 여백 과다(top inset 이중 적용) — `notifications.tsx`·`trash.tsx` `SafeAreaView edges` `["top"]`→`["bottom"]`(register/detail 과 통일).
- **iOS 시뮬레이터 재캡처 (2026-06-23, dev build)**: **A1**(대시보드 4카드+의미색)·**A2**(택배함 완료숨기기 토글, 필터칩 제거)·**B2**(알림·휴지통 헤더 여백) 확인 완료. **B1**(빈 목록 대시보드 진입)은 무한 스피너는 해소됐으나, 빈 목록에서 카드가 아니라 "운송장 등록" CTA를 띄우는 게 의도와 달라 **#1로 정정**(아래 예정 §"v1.1 추가"). 동시에 사용자 추가 요청 **#2~#4** 접수.
- ⚠️ **배포 전 외부 경계 실호출 스모크 미완**(미해소): 원격 D1 `notifications` 마이그레이션 + 실 운송장 전환 푸시·한글명·`GET /notifications` 기록 확인.

## 예정 작업 (무엇을 해야 하는가)

**열린 이슈(GitHub):**
- `#8` (P3) 알림 그룹화/요약 — 과알림 방지.
- `#9` (P3) 푸시 **title** 의 택배사 id(`kr.cjlogistics`) → 한글명. (목록·상세는 PR #18에서 해결, **푸시 발송 문구는 worker `buildMessage` 쪽 별개** — **v1.1 phase 07 step1에 포함**.)
- `#12` (P1·제출차단) 개인정보처리방침 URL — repo 방침 문서(`PRIVACY_POLICY.md`) 완료, **호스팅·URL 확정은 배포 시 외부 작업**.
- `#14` (P1·제출차단) App Privacy/Data Safety 신고 — 초안(`QA` D절) 완료, **콘솔 제출은 외부 작업**.

**계획된 기능(아래 §상세):**
- **v1.1 추가 (2026-06-23 #1~#4 — 설계 완료·구현 대기):** 시뮬레이터 스모크/사용자 요청에서 발견. 설계 SoT: `PRD`/`UI_GUIDE`/`ARCHITECTURE` "v1.1 추가", `ADR-026`(택배사 자동선택)·`ADR-027`(식별자 수정=재등록).
  - **#1 대시보드 빈 목록 = 항상 4카드** — EmptyState 제거(현황판). → harness **phase 12 `12-qa-v0-v11-dashboard-empty`**(설계·step 작성 완료, 실행 대기).
  - **#3 택배사 자동선택 보수화** — 추정 후보 ≥2면 자동선택 없이 드롭다운 명시 선택(오선택 방지). → harness **phase 13**(`carrier` 로직·`register.tsx`).
  - **#2 상세 "택배 정보"·"수정" 아이콘 분리** + **#4 택배사·번호 수정=재등록**(POST 새등록 먼저→정보 old→new id 이관→DELETE 기존, 새 서버 엔드포인트 없음). → harness **phase 14**(상세 화면·재등록 로직 test-first·신규 `FileText` 글리프).
  - 의존: 12·13·14 각각 독립(13·14 동시 가능), 14의 택배사 선택 UI는 #3 컴포넌트 재사용. 각 phase 후 시뮬 재캡처 검증.
- 배송완료 **자동 삭제 옵트인 설정** — 현재 기본은 보관(ADR-005 개정), 자동 삭제는 다음 phase 설정으로.

> v1.1 마이너 업데이트(phase 07~11)는 구현·설계정정·버그수정 완료 → **위 "진행 현황"** 으로 이동. **배포 전 외부 경계 실호출 스모크는 여전히 미완**(진행 현황 ⚠️ 항목 참조).

**Phase 2 (이후):** 해외·계정 동기화(CLAUDE.md). 별도 phase 설계 필요.

---

## 실기기 설치·배포 경로 (iOS)

> 앱을 **실제 폰**에 올리는 경로. 유료 Apple Developer 계정 발급 전/후 2단계. 공통 설정은 이미 완료:
> - `app/app.json`: 번들 ID `com.jinni.unboxing` (iOS `bundleIdentifier` + Android `package`), 표시 이름 `언박싱`.
> - `app/eas.json`: `preview`(distribution: internal)·`production` 프로파일 — 유료 단계의 ad hoc 내부배포용. `EXPO_PUBLIC_API_URL`은 **배포 후 실제 workers.dev URL로 교체 필요**(현재 `FILL-AFTER-DEPLOY` placeholder).

### 현재 단계 — 무료 Apple ID + USB 직결 (개발 설치)
**전제:** Mac + Xcode(설치됨), iPhone을 USB로 연결, Xcode > Settings > Accounts 에 **무료 Apple ID** 로그인.

**절차:**
1. iPhone USB 연결 → 기기에서 "이 컴퓨터를 신뢰" 허용.
2. **백엔드 도달성**: 실기기에선 `localhost`가 폰 자신을 가리킴 → `app/.env.local`의 `EXPO_PUBLIC_API_URL`을 **배포된 workers.dev URL**(권장) 또는 **Mac의 LAN IP**(`http://<mac-ip>:8787`, 로컬 worker를 `wrangler dev --ip 0.0.0.0`로 실행)로 바꿔야 등록·조회가 동작.
3. 빌드·설치: `cd app && npx expo run:ios --device` → 연결된 기기 선택. (첫 빌드 시 Xcode에서 free personal team 서명 선택)
4. 기기에서 신뢰: 설정 > 일반 > VPN 및 기기 관리 > 개발자 앱 > 신뢰.

**제약 (이 단계의 한계):**
- ⏳ **7일 후 서명 만료** → 앱 실행 안 됨. `expo run:ios --device` 재실행으로 재설치.
- 🔕 **iOS 원격 푸시(APNs) 불가** — 무료 personal team은 Push Notifications capability를 켤 수 없음. 이 앱의 핵심(백그라운드 폴링 → 푸시)은 이 경로로 **검증 불가**. UI·등록·목록·상세·로컬 동작까지만 확인 가능. (`registerForPush`의 `getExpoPushTokenAsync`가 엔타이틀먼트 부재로 throw할 수 있음 — 앱은 계속 동작해야 함, ADR-018.)
- ✅ **푸시 포함 end-to-end 검증이 지금 필요하면** → 안드로이드 EAS 빌드(FCM, 무료, Apple 무관)로 우회: `eas build --platform android --profile preview`로 APK 받아 설치(FCM 설정 1회 필요).

### 다음 단계 — 유료 Apple Developer($99/yr) 발급 시 (자동 전환)
계정 생기면 위 공통 설정(번들 ID·`eas.json`) 그대로 이어받아 전환. 절차:
1. `npm i -g eas-cli && eas login`(Expo 무료 계정) → `eas init` → `app.json`에 `extra.eas.projectId`·`owner` 자동 기입(푸시 토큰 발급 전제).
2. `app/eas.json`의 `EXPO_PUBLIC_API_URL`을 **배포된 workers.dev URL**로 교체(placeholder 제거).
3. `eas device:create` → iPhone UDID 등록(1회, 유료 계정 필요).
4. `eas build --platform ios --profile preview` → QR/링크로 설치. **서명 1년 유지**(7일 만료 해소).
5. 푸시: `eas credentials`가 APNs 키 자동 생성 → **원격 푸시 동작**. 실기기 스모크로 등록→cron→푸시 1회 확인(`docs/ENGINEERING.md` 실호출 체크리스트).
6. (정식 출시 시) `#12` 개인정보처리방침 URL 호스팅 · `#14` App Privacy 신고 — `예정 작업` 참조.

<a id="plan-auto-delete"></a>

---

# 계획: 배송완료 자동 삭제 (옵트인 설정) — 구 `PLAN_AUTO_DELETE_COMPLETED.md`


> **상태**: 계획(미구현). 본 phase에서 **기본 사양을 "완료 시 보관(active=0) + 사용자 수동 삭제"로 변경**했고(ADR-005 개정), 자동 삭제는 **옵트인 설정**으로 다음 phase에 추가한다.
> 관련: `docs/ADR.md` ADR-005 · `worker/src/cron.ts` `pollOne`(배송완료 처리) · `app/app/settings.tsx` · `worker/src/index.ts`(devices 등록·삭제).

## 1. 목표 & 기본값
- 설정에 **"배송완료 시 자동 삭제"** 토글 추가. **기본값 OFF**(= 현재 기본 사양: 완료 건 보관).
- ON이면 배송완료된 운송장이 **자동으로 목록에서 제거**된다(사용자가 일일이 삭제 안 해도 됨).
- 비영속 원칙(ADR-005)과 충돌 없음 — 보관 데이터는 운송장·택배사·상태뿐(수령인 PII 아님). 자동 삭제는 편의 기능.

## 2. 핵심 제약 (왜 단순하지 않은가)
- **익명·무로그인 + dedupe**: 한 shipment 행을 **여러 device가 공유**(같은 운송장 등록 시 `subscriptions`로 N:1). "삭제"는 곧 **내 구독 제거**이고, 행 자체는 **구독이 0이 될 때만** 삭제해야 한다(타인 구독 보호).
- **삭제 주체는 서버 cron**: 완료 감지는 cron(`pollOne`)에서 일어난다. device별 설정을 cron이 알아야 한다 → 설정을 **서버에 저장**해야 앱이 꺼져 있어도 자동 삭제가 동작한다.
- **per-device 설정**: 같은 shipment를 구독한 두 device가 서로 다른 설정일 수 있다 → **구독 단위**로 판정해야 한다.

## 3. 구현안

### 권장: 서버측 per-device 설정 (앱이 꺼져 있어도 동작)
**데이터 모델**
- `devices`에 컬럼 추가: `auto_delete_completed INTEGER NOT NULL DEFAULT 0`.
- 마이그레이션: `ALTER TABLE devices ADD COLUMN auto_delete_completed INTEGER NOT NULL DEFAULT 0;` (기존 행은 DEFAULT 0 = 현 기본값 유지, 안전). `docs/ENGINEERING.md`에 추가. **주의(PITFALLS P-2)**: 단순 ADD COLUMN이라 RENAME 전파 이슈 없음.

**API**
- 설정 저장: `POST /devices` 바디에 `auto_delete_completed?: boolean` 수용(기존 upsert에 컬럼 추가), 또는 전용 `PATCH /me/settings`. 마찰 최소 원칙상 기존 `/devices` upsert 확장이 간단.

**cron `pollOne` 배송완료 분기 변경** (현재: `active=0` 보관 단일 처리)
1. 전환 CAS 승리 시 알림 발송(종전과 동일).
2. 그 shipment의 구독자별로 `devices.auto_delete_completed` 조회:
   - `=1`인 구독은 `DELETE FROM subscriptions WHERE shipment_id=? AND device_id=?`.
   - `=0`인 구독은 유지.
3. 남은 구독이 0이면 `DELETE FROM shipments WHERE id=?`(FK CASCADE로 잔여 정리), 1건↑이면 `active=0` 보관.
- **원자성/멱등**: 알림은 전환 CAS로 정확히 1회(종전 보장 유지). 구독 정리·행 삭제는 알림 발송 뒤 별도 batch. 재실행돼도 `prev==배송완료`라 재진입 없음.

### 대안(단순·MVP): 클라이언트측 (앱 열렸을 때만)
- 설정을 로컬(`expo-secure-store`)에만 저장.
- 목록 로드 시 `배송완료` 항목이 보이고 설정 ON이면 앱이 `DELETE /shipments/:id`를 자동 호출.
- 장점: 서버 스키마·cron 변경 없음. 단점: **앱이 열릴 때만** 삭제(진정한 백그라운드 자동 아님), 푸시로 완료 안 뒤 앱 안 열면 목록에 남음.
- → 빠른 출시용. 백그라운드 자동까지 원하면 권장안(서버측).

## 4. UX (설정 화면)
- `app/app/settings.tsx` "알림" 또는 신규 "보관" 섹션에 토글 행: **"배송완료 시 자동 삭제"** (보조설명: "완료된 택배를 목록에서 자동으로 지워요. 기본은 직접 삭제예요.").
- 토글 변경 → (권장안) `registerDevice`/설정 API로 서버 반영 + 로컬 캐시. 실패 시 조용히 롤백(앱 계속 동작).
- 색·컴포넌트는 토큰만(UI_GUIDE). 광고성 아님(ADR-018 무관).

## 5. 테스트 계획
- **worker(cron)**: 단위/e2e —
  - 설정 OFF(기본): 완료 시 보관(active=0)·구독 유지(현 테스트 유지).
  - 설정 ON·단일 구독: 완료 시 구독+shipment 삭제(count 0), 알림 1회.
  - 설정 ON·**다중 구독 혼합**(A=ON, B=OFF): A 구독만 제거, shipment·B 구독 유지(active=0), 알림 1회.
  - 멱등: 재실행 시 재삭제·재발송 없음.
- **app**: 설정 토글 렌더·저장 호출(jest-expo, api mock). 순수 로직 없으니 통합 수준.
- 외부 경계는 실호출 스모크로 별도 확인(`docs/ENGINEERING.md`).

## 6. Acceptance Criteria
```bash
npm run verify   # 위 테스트 포함 green
```
- 마이그레이션 적용 후 `PRAGMA table_info(devices)`에 `auto_delete_completed` 존재(notnull=1, dflt=0).
- 설정 ON에서 실 배송완료 번호 등록·cron 후 목록에서 제거(다중 구독 시 본인 것만), 실 API 스모크로 확인.

## 7. 미결정 / 논의거리
- 설정 저장 방식: `/devices` upsert 확장 vs 전용 엔드포인트 — 마찰·단순성 기준으로 결정.
- "자동 삭제"를 완료 **즉시** vs **N일 유예 후**로 둘지(유예 두면 사용자가 푸시 보고 앱에서 한 번 더 확인 가능). 기본은 즉시 제안.
- 권장안 vs 대안: 백그라운드 자동이 필요하면 서버측, 빠른 출시면 클라이언트측.
