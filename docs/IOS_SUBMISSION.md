# iOS App Store 제출 가이드 & 정책 검토

> Apple App Store 제출 절차 + 정책(App Review Guidelines) 검토 결과의 단일 출처.
> Android(Play) 측은 메모리 `play-store-submission-progress` + `docs/QA.md` D절. iOS 실기기 설치 경로는 `docs/ROADMAP.md` "실기기 설치·배포 경로".
> 콘솔 입력 신고 초안은 중복 작성하지 않고 `docs/QA.md`를 가리킨다(App Privacy=D절 §1, 리뷰 노트=C절).

## 0. 검토 결론 (2026-06-22)

**App Store 정책 위반으로 리젝될 항목 없음.** 익명(로그인 없음)·최소 권한(푸시 1개)·개인정보 비영속(수령인 정보 미저장) 구조라 심사 관점에서 깨끗하다.

> **⚠️ v1.1 재검증 필요 (이 결론은 v1.1 이전 기준)** — v1.1은 ① 서버 `notifications` 테이블(발송 알림 기록·비-PII·최대 90일) 신규 저장, ② `expo-haptics` 모듈. **새 리젝 위험 카테고리는 없다**(수령인 PII 여전히 미저장·추적 미사용·거래성 알림만, haptics는 required-reason API/추적 미해당이라 Privacy Manifest 무영향).
> - **`expo-haptics` 범위 메모(혼동 방지)**: haptics 는 **v1.1 범위** 항목이지만 MVP 스와이프 작업 때 **구현 순서가 앞당겨져(선행 구현)** 이미 코드(`app/package.json` `expo-haptics`, `ShipmentCard.tsx` 2단계 스와이프 햅틱)·**첫 제출 빌드에 포함**된다 — UI_GUIDE 가 "현재 기능(회귀 금지)"로 잠근 것과 모순 아님(범위=v1.1, 존재=이미 빌드). 따라서 haptics 의 Privacy Manifest 무영향은 **첫 제출 검토에서 이미 커버**되며 v1.1 별도 재검증 사유가 아니다. v1.1 재검증의 실질 델타는 **① `notifications` 테이블** 하나다. 단 **App Privacy(영양성분표)·Play Data Safety·개인정보처리방침에 발송 알림 기록을 추가 신고**해야 정확(누락 시 부정확 신고 리스크). 신고 초안은 `docs/QA.md` D절에 반영됨(*v1.1* 표시). 라이브 개인정보처리방침(`privacyPolicy.ts`)·콘솔 신고 동기화는 v1.1 구현 단계 작업. **별건(선재): `PRIVACY_POLICY.md`·라이브 정책의 "배송완료 즉시 삭제" 문구가 ADR-005 개정(보관)과 불일치 → 동기화 시 함께 정정.**

검증한 근거:
- 권한: `expo-notifications`(푸시) 1개뿐, priming 후 요청, 거부해도 동작(`app/src/lib/push.ts`).
- 추적: ATT/IDFA 미사용, `NSPrivacyTracking=false`. 외부 분석/크래시 SDK 0개(Firebase·Sentry 등 없음).
- ATS: `NSAllowsArbitraryLoads=false`(임의 HTTP 차단) — 정상.
- 백그라운드 모드 없음 — 온디바이스 폴링을 안 하고 서버 Cron으로 도는 아키텍처와 일치(불필요 권한 없음).
- 인앱결제 없음, 계정/로그인 없음 → Sign in with Apple·계정삭제(5.1.1) 의무 비해당.
- 거래성 알림만(광고성 푸시 없음) → Guideline 4.5.4 충족.
- 개인정보처리방침 공개 URL 라이브(HTTP 200): `https://unboxing-worker.dev-jinni520.workers.dev/privacy`.

## 1. app.json 적용 변경 (2026-06-22)

`app/app.json`만 수정한다. **`app/ios/`는 `expo prebuild` 생성물(gitignore)이라 직접 편집 금지** → 빌드 시 재생성됨(§4, ENGINEERING P-7).

| 변경 | 값 | 이유 |
|---|---|---|
| `ios.infoPlist.ITSAppUsesNonExemptEncryption` | `false` | HTTPS·Keychain 등 **표준 암호화만** 사용 → 수출규정 면제 대상. 미설정 시 TestFlight 빌드·제출 때마다 "암호화 사용?" 질문이 뜨고 오답 시 빌드가 심사 대기에 묶임. 키로 자동 처리. |
| `ios.supportsTablet` | `true` → **`false`** | iPad가 심사 대상에서 빠짐. MVP는 iPhone 전용 출시(iPad 레이아웃 미검증 → Guideline 4.0/2.1 리젝 리스크 회피). iPad 지원 시 실 iPad 검증 후 `true`로 복귀. |
| `plugins` `expo-secure-store` | `faceIDPermission` 한국어 사유 지정 | 플러그인이 자동 주입하는 `NSFaceIDUsageDescription` 기본 문구가 영어·모호("...access your Face ID biometric data"). Apple은 구체적 사유 문자열을 선호 → 한국어 사유로 교체. (현재 생체인증 미사용이라 리젝 위험은 낮음 — 선택적 개선.) |

검증: `npx jest src/lib/__qa__/app-config.test.ts` green + JSON 유효.

## 2. 콘솔 수동 입력 체크리스트 (App Store Connect — 코드 아님, 누락 시 리젝)

- [ ] **App Privacy(영양성분표)**: App Store Connect > App Privacy. 신고 내용은 `docs/QA.md` D절 §1 표 그대로 입력(운송장번호·기기식별자·푸시토큰 = App Functionality 용도, "추적 안 함" 선언). *PrivacyInfo.xcprivacy의 `NSPrivacyCollectedDataTypes`가 빈 건 정상 — 영양성분표는 별도 웹 폼이다.*
- [ ] **App Review Information → 데모 + 리뷰 노트** *(가장 흔한 리젝 원인 — Guideline 2.1/4.2)*: 데모 번호 `00000000000000`(운영 Worker `wrangler.toml [vars] DEMO_TRACKING_NUMBER`에 배포 확인됨)과 `docs/QA.md` C절 리뷰 노트를 그대로 붙여넣어야 심사자가 실배송 없이 핵심 가치(상태 변화→알림)를 검증한다. **비우면 "기능 확인 불가"로 리젝.**
- [ ] **개인정보처리방침 URL**: `https://unboxing-worker.dev-jinni520.workers.dev/privacy` (라이브 확인됨).
- [ ] **연령 등급**: 4+.
- [ ] **수출규정(Export Compliance)**: §1의 `ITSAppUsesNonExemptEncryption=false` 적용 시 자동 처리(추가 답변 불필요).
- [ ] **앱 메타**: 이름(언박싱)·스크린샷·지원 URL·카테고리·키워드.

## 3. App Privacy 영양성분표 ≠ Privacy Manifest (혼동 주의)

- **Privacy Manifest**(`PrivacyInfo.xcprivacy`, `app.json ios.privacyManifests`): 빌드 산출물. required-reason API(UserDefaults `CA92.1`·FileTimestamp `C617.1` 등)·추적 여부 신고. `NSPrivacyCollectedDataTypes`는 비어 있어도 됨.
- **App Privacy 영양성분표**: App Store Connect 웹 폼. 실제 수집 데이터(운송장·기기식별자·푸시토큰)를 **여기서 별도 신고**(§2 첫 항목). 둘은 다른 채널이며 **둘 다** 필요.

## 4. 빌드 & 제출 명령

```bash
# 빌드 (production 프로파일 — appVersionSource:remote 로 buildNumber 자동 증가)
eas build -p ios --profile production

# 제출 (⏸ 지금은 대기. 지시 시 실행)
eas submit -p ios
```

- ⚠️ `app/eas.json`의 `submit.production`에는 현재 **android만** 있음. `eas submit -p ios` 첫 실행 시 Apple ID·App Store Connect 앱(ascAppId)·팀 정보를 인터랙티브로 묻거나, `submit.production.ios`(`appleId`·`ascAppId`·`appleTeamId`)를 추가해야 한다. **App Store Connect에 앱 레코드 생성 선행 필요.**
- 제출 전 **실기기 스모크 1회**: 멤버십 활성 후 APNs 키 자동 생성(`eas credentials`) → 등록→cron→푸시 1회 확인(`docs/ENGINEERING.md` 외부 경계 체크리스트). mock verify green은 외부 경계를 보증하지 않음.

## 5. 관련 문서

- `docs/QA.md` — C절(리뷰 노트·데모 번호), D절(App Privacy/Data Safety 신고 초안·iOS Privacy Manifest)
- `docs/PRIVACY_POLICY.md` — 개인정보처리방침 본문(공개 URL의 단일 출처)
- `docs/ROADMAP.md` — "실기기 설치·배포 경로 (iOS)"(개발 설치 단계)
- `docs/ENGINEERING.md` P-7 — `ios/` 직접편집 금지·Face ID 플러그인 기본값 함정
- 메모리 `play-store-submission-progress` — Android(Play) 측 진행
