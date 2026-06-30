# Step 27: store-prep (#12·#14 P1 · #15 P2 — 스토어 제출 준비물)

스토어 제출을 막는 준비물을 갖춘다 — 개인정보처리방침 문서, App Privacy/Data Safety 신고 초안, 앱 Privacy Manifest. **이슈 #12·#14·#15 해소**. (호스팅·콘솔 제출 같은 외부 행위는 범위 밖 — 산출물은 repo 문서·설정.)

## 읽어야 할 파일

- GitHub 이슈 **#12·#14·#15** 및 `/docs/QA_FINDINGS.md`의 **QA-009·011·012** 행
- `/docs/PRD.md` — "스토어 정책 & 컴플라이언스"(Apple·Google·한국 법규)
- `/docs/ADR.md` — ADR-005(비영속)·017(데이터 삭제)·018(거래성)
- `/Users/jinni/Developments/unboxing/app/app/settings.tsx` — `PRIVACY_POLICY_URL`
- `/Users/jinni/Developments/unboxing/app/app.json` — `expo.ios`
- `/Users/jinni/Developments/unboxing/docs/QA_TESTPLAN.md` — 제출 체크리스트
- **step0·step3 산출**: step0(토큰 없이 등록=푸시토큰 선택적)·step3(`notification_queue` 신규 테이블) — 방침·신고 데이터 인벤토리에 반영해야 함

## 작업

### 1. 개인정보처리방침 (#12, P1)

- `docs/PRIVACY_POLICY.md` — **한글** 방침 작성: 수집항목(운송장·푸시토큰), 목적, **제3자 제공**(tracker.delivery로 운송장 전송), **국외이전**(Cloudflare), 보유·삭제(인앱 `DELETE /me`·비영속), 문의처. (PRD 컴플라이언스·한국 PIPA 항목 충족.)
- `settings.tsx`의 `PRIVACY_POLICY_URL`: 실제 호스팅 URL로 갱신하되, 미배포 상태면 **확정 URL 자리 + 주석으로 "배포 시 호스팅 후 확정"** 명시(placeholder임을 코드 주석으로 분명히 — 더 이상 조용한 placeholder가 아니게).

### 2. App Privacy / Data Safety 신고 초안 (#14, P1)

- `docs/STORE_PRIVACY_FILING.md` — Apple App Privacy(Nutrition Labels)·Google Data Safety 입력용 초안: 수집 데이터(운송장·푸시토큰)·공유(제3자 SDK: tracker.delivery·Cloudflare·Expo Push)·국외이전·삭제 메커니즘(`DELETE /me`)·ATT/광고식별자 미사용·수령인 미저장(ADR-005). 콘솔 입력 시 그대로 옮길 표 형태.

### 3. 앱 Privacy Manifest / required-reason (#15, P2)

- `app/app.json`의 `expo.ios`에 Privacy Manifest·required-reason·클립보드 사유를 선언: `ios.privacyManifests`(필요한 `NSPrivacyAccessedAPICategory…` required-reason, 예 UserDefaults) + 클립보드 read 사유 문자열(`ios.infoPlist`). Expo 의존성 매니페스트와 병합되도록.

### 4. 배포 마이그레이션 노트 (N5 — 이 phase의 schema 변경 집계)

`docs/MIGRATION.md`(또는 QA_TESTPLAN 배포 섹션): 이 phase가 바꾼 D1 스키마를 **원격 적용 절차**로 정리 — ① `devices.push_token` nullable 화(기존 테이블 재생성 필요, SQLite는 NOT NULL drop 불가 → 테이블 rebuild) ② `notification_queue` 신규 CREATE. `CREATE IF NOT EXISTS`라 자동 반영 안 되는 항목을 명시(배포 시 수동).

### 5. 종료 범위 명확화 (N2)

- **#12·#14는 repo 산출물까지만 이 phase로 해소**(방침 문서·신고 초안·설정). **실제 호스팅(live URL)·콘솔 제출은 외부 행위라 미완** → 이 둘은 **완전 종료(close)하지 말고**, repo 산출물 완료를 코멘트로 남기고 "호스팅/제출" 잔여를 이슈에 유지하거나 별도 배포 체크리스트로 추적. #15는 app.json 설정이라 repo 내 해소(빌드 검증은 별도).

## 핵심 규칙 (벗어나면 안 됨)

- 방침·신고 내용은 **실제 구현과 일치**해야 한다(수령인 미저장·비영속 ADR-005, 데이터 삭제 ADR-017, 거래성 알림만 ADR-018, 국외이전 Cloudflare). 이유: 허위 신고 금지·심사 정합.
- `PRIVACY_POLICY_URL`을 조용한 placeholder로 두지 마라 — 실제 URL 또는 명시적 TODO 주석. 이유: #12의 근원(조용한 미배포).
- 외부 호스팅·콘솔 제출을 이 step에서 하려 하지 마라(불가) — repo 산출물(문서·설정)까지. 이유: 범위.

## 엣지케이스 & 에러 처리 (반드시 다룰 것)

- **(E3) `verify`가 Privacy Manifest를 검증 못 함**: `app.json` 의 `ios.privacyManifests` 는 typecheck/jest 대상이 아니라 **iOS 빌드(expo prebuild) 에서만** 실효 검증된다 → AC(verify) green ≠ 매니페스트 정상. 최소한 **`app.json` 이 유효 JSON·구조 sanity**(필수 키 존재)인지 확인하는 가벼운 테스트를 두고, "정식 검증은 iOS 빌드 시점"임을 명시.
- **required-reason 정확값**: 클립보드·UserDefaults(async-storage) 등 required-reason API 카테고리·코드는 **Expo SDK 56 문서 기준 정확한 `NSPrivacyAccessedAPICategory…` 값**을 써야 한다(임의 추정 금지) — https://docs.expo.dev/versions/v56.0.0/ 확인.
- **데이터 인벤토리 완전·최신**: 방침·신고 문서의 수집/저장 목록은 **이 phase 종료 시점의 실제 스키마 전부**를 반영해야 한다 — `devices`(id·push_token·platform)·`shipments`(carrier·tracking_no·status…)·`subscriptions`·`push_tickets`·`tracker_token`·`rate_limits`·**`notification_queue`(step3 신규, push_token 보관)**. 누락 시 허위·불완전 신고.
- **구현 일치 재확인**: step0(토큰 없이 등록·익명) 이후 "수집: 푸시토큰"은 *선택적*임을 반영, ADR-005(수령인 미저장)·ADR-017(삭제는 devices·push_tickets·notification_queue 모두)·ADR-018(거래성만)과 문구가 어긋나지 않게.

## 검증

```bash
npm run verify   # app.json 변경 후 typecheck·기존 테스트 green 유지
```

(이 step은 문서·설정 위주라 코드 테스트 변동이 적다 — `app.json` 변경이 expo typecheck/번들을 깨지 않는지 확인.)

## 검증 절차

1. AC 실행. 2. 체크리스트: `PRIVACY_POLICY.md`·`STORE_PRIVACY_FILING.md` 작성? `app.json` Privacy Manifest·클립보드 사유 선언? 내용이 구현(비영속·삭제·거래성)과 일치? 3. `phases/qa-fixes/index.json` step 5 업데이트(summary "prepares #12 #14 (repo 산출물), fixes #15") + phase 완료.
   - **이슈 자동 닫기(PR 본문)**: 코드/설정으로 **완전 해소된 것만** `Closes` — `Closes #3 #5 #6 #7 #10 #11 #13 #15`. **#12·#14는 `Closes` 금지**(호스팅/콘솔 제출 미완) → PR 본문에 "repo 산출물 완료, 호스팅/제출 잔여"로 참조만(`Refs #12 #14`).
   - 가능하면 `docs/QA_FINDINGS.md`의 해당 행 상태/이슈# 갱신.

## 금지사항

- 구현과 다른 수집/공유를 신고 문서에 적지 마라. 이유: 허위 신고·심사 리스크.
- `app.json` 변경으로 기존 typecheck/번들을 깨뜨리지 마라. 이유: 회귀 금지.
- 기존 테스트를 깨뜨리지 마라.
