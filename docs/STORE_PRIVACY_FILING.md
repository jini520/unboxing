# App Privacy / Data Safety 신고 초안

> Apple **App Privacy(Nutrition Labels)** · Google Play **Data Safety form** 입력용 초안.
> 콘솔(App Store Connect / Play Console)에서 그대로 옮겨 입력한다. 실제 신고는 **사람이 콘솔에서** 수행(외부 행위).
> 내용은 **실제 구현·`docs/PRIVACY_POLICY.md`와 일치**해야 한다(허위 신고 금지) — 구현이 바뀌면 이 문서를 먼저 갱신.
> 데이터 인벤토리 출처: `worker/schema.sql`(D1 전체 스키마, 본 phase 종료 시점), ADR-002/005/017/018.

## 0. 데이터 인벤토리 (D1 실제 스키마 — 신고의 사실 근거)

신고가 반영해야 하는 **저장 데이터 전부**(본 phase 종료 시점):

| 테이블 | 저장 항목 | 개인정보성 | 신고 매핑 |
|---|---|---|---|
| `devices` | `id`(=익명 device_id) · `push_token`(**선택**, NULL 허용) · `platform` | 낮음(익명) | 기기 식별자·푸시 토큰 |
| `shipments` | `carrier` · `tracking_no` · `last_normalized_status` · `last_polled_at` · `active` · `last_event_time` · `fail_count` · `next_retry_at` | 낮음(운송장·상태) | 운송장 번호·배송 상태 |
| `subscriptions` | `device_id`↔`shipment_id` | 낮음 | (내부 소유권 매핑) |
| `push_tickets` | `ticket_id` · `push_token` · `created_at` | 낮음 | 푸시 토큰(발송 후 receipt 확인용 임시) |
| `tracker_token` | tracker.delivery access token(우리 자격) | — | (사용자 데이터 아님) |
| `rate_limits` | `ip` · 윈도 · count | 낮음 | (남용 방어용, 사용자 식별 미연계) |
| `notification_queue` | `push_token` · `title`·`body`(메시지 스냅샷: 택배사명·운송장 **끝 4자리**·안내문구) · `shipment_id` | 낮음(끝4자리·비식별) | 푸시 토큰·알림 스냅샷(조용시간 보류분, step3 신규) — 발송/`DELETE /me` 시 폐기 |

- **수령인 이름·주소·연락처**: 어느 테이블에도 저장하지 않음(화면 표시 후 폐기, ADR-005) → **"수집 안 함"**.
- **push_token 은 선택 수집**: 알림 권한 허용 시에만 저장(거부해도 등록·추적 가능, step0). `push_tickets`·`notification_queue` 의 토큰 사본은 `DELETE /me` 시 함께 즉시 폐기(ADR-017, step3).

## 1. Apple App Privacy (Nutrition Labels)

App Store Connect > App Privacy 에 입력. 각 데이터 타입별 **수집 여부 / 연결성(linked) / 추적(tracking) / 용도**.

| Apple 데이터 타입 | 수집 | 제3자 공유 | App과 연결(linked)? | 추적(tracking)? | 용도(Purpose) |
|---|---|---|---|---|---|
| Other Data Types — 운송장 번호 | 예 | 예(tracker.delivery) | 아니오(익명·계정 없음) | 아니오 | App Functionality(배송 조회) |
| Other Data Types — 배송 상태/택배사 | 예 | 아니오 | 아니오 | 아니오 | App Functionality |
| Identifiers — Device ID(앱 생성 익명) | 예 | 아니오 | 아니오 | 아니오 | App Functionality(내 송장 구분) |
| (Push token) | 예 — *Apple은 별도 타입 없음* | 예(Expo Push) | 아니오 | 아니오 | App Functionality(알림) |
| Contact Info(이름·주소·전화) | **아니오 (수집 안 함)** | — | — | — | — (ADR-005) |
| Location | **아니오** | — | — | — | — |
| Identifiers — IDFA / 광고 | **아니오** | — | — | — | — (ATT 미사용) |

- **Tracking(ATT)**: "이 앱은 추적하지 않음(Does Not Track)" 선언. `IDFA`·`AppTrackingTransparency` 미사용.
- 푸시 토큰은 Apple 데이터 타입에 직접 항목이 없어 일반적으로 **Identifiers / Other Data**로 신고하고 용도는 App Functionality 로 표기.

## 2. Google Play Data Safety

Play Console > App content > Data safety. **제3자 SDK(Expo Push·Cloudflare)도 수집/공유에 포함**해야 함.

| 데이터 | 수집(Collected) | 공유(Shared) | 처리 위치 | 용도 | 비고 |
|---|---|---|---|---|---|
| 운송장 번호 | 예 | 예 — tracker.delivery | 서버(Cloudflare) | 앱 기능(배송 조회) | 식별성 낮음 |
| 택배사·배송 상태 | 예 | 아니오 | 서버 | 앱 기능 | — |
| 기기 식별자(앱 생성) | 예 | 아니오 | 서버 | 앱 기능(내 송장 구분) | 광고 식별자 아님 |
| 푸시 토큰 | 예 | 예 — Expo Push | 서버 | 앱 기능(알림 전달) | 선택(알림 허용 시) |
| 수령인 이름·주소·연락처 | **아니오** | — | — | — | 저장 안 함(ADR-005) |
| 위치·광고 식별자 | **아니오** | — | — | — | — |

- **전송 중 암호화**: 예(모든 통신 HTTPS).
- **데이터 삭제 요청 가능**: 예 — 앱 내 "모든 데이터 삭제"(`DELETE /me`) 제공. (선택: 웹 삭제 요청 URL은 미운영.)
- **데이터 수집 필수 여부**: 운송장/상태/기기 식별자는 필수, **푸시 토큰은 선택**.

## 3. 한국 PIPA — 국외 이전 고지

- 백엔드: **Cloudflare**(해외 리전) / 조회: **tracker.delivery** / 알림: **Expo Push**.
- 이전 항목·목적·시점·방법은 `docs/PRIVACY_POLICY.md` §4·§5에 명시 → 방침과 본 신고를 동일하게 유지.

## 3-A. iOS Privacy Manifest / Required-reason API (QA-012)

`app/app.json` `expo.ios.privacyManifests` 에 선언(빌드 시 `PrivacyInfo.xcprivacy` 로 산출). 의존성 각자의 매니페스트는 Apple이 정적 CocoaPods 의존성에서 항상 정확히 병합하지 못하므로(Expo SDK 56 권고) **앱 레벨에서 명시**한다.

| 선언 | 값 | 근거 |
|---|---|---|
| `NSPrivacyTracking` | `false` | ATT/추적 미사용 |
| `NSPrivacyTrackingDomains` | `[]` | 추적 도메인 없음 |
| `NSPrivacyCollectedDataTypes` | `[]` | 매니페스트 차원의 수집 데이터 미선언(App Privacy 신고는 §1에서 별도 수행) |
| `NSPrivacyAccessedAPICategoryUserDefaults` | `["CA92.1"]` | React Native 코어·AsyncStorage가 UserDefaults 사용. `CA92.1` = Expo SDK 56 공식 문서 예시값 |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `["C617.1"]` | AsyncStorage 등 앱 컨테이너 내 파일의 타임스탬프 접근(`C617.1` = 앱 컨테이너 내부 파일 메타데이터) |

- 정확값 출처: Expo `guides/apple-privacy`(UserDefaults `CA92.1` 예시) + Apple "Describing use of required reason API"(FileTimestamp `C617.1`). **임의 추정 아님.**
- ⚠️ **정식 검증은 iOS 빌드 시점**: `app.json` 의 이 키는 typecheck/jest 대상이 아니다. `expo prebuild` 산출 `ios/.../PrivacyInfo.xcprivacy` 로 병합 결과를 확인해야 실효 검증된다(QA_TESTPLAN §3-C). repo 테스트는 `app.json` 의 **유효 JSON·키 존재**만 sanity 확인(`app/src/lib/__qa__/app-config.test.ts`).

### 클립보드(expo-clipboard) 사유 — Info.plist 키 불필요 (정확성 기록)

QA-012 제안의 "클립보드 사유 문자열(`ios.infoPlist`)"은 **검토 결과 추가하지 않는다**:

- iOS에는 클립보드 **읽기용 Info.plist usage description 키가 없다**(`NSPasteboardUsageDescription` 은 macOS 전용). iOS 14+는 붙여넣기 시 **시스템 배너를 자동 표시**하고, iOS 16+는 사용자가 거부하면 `getStringAsync` 가 `null` 을 반환한다.
- 클립보드는 **required-reason API 카테고리에도 해당하지 않는다**(UserDefaults·FileTimestamp 등 5종에 포함 안 됨).
- Expo SDK 56 `expo-clipboard` 문서도 iOS용 Info.plist/매니페스트 설정을 요구하지 않는다.
- 앱은 등록 화면에서 **명시적 시점에만 1회 읽고 제안만** 한다(자동 등록 없음, PRD 클립보드 정책) — 권한 문자열 없이 시스템 배너로 충분.
- → 존재하지 않는 키를 임의로 넣지 않는다(허위/부정확 선언 금지). 동일 사유로 `expo-secure-store`(Keychain)·`expo-notifications`(푸시)도 별도 usage 문자열이 필요 없다.

## 4. 공통 선언 요약 (체크 항목)

- [x] 수령인 개인정보(이름·주소·연락처) **저장 안 함**(ADR-005)
- [x] 광고 식별자·위치 **미사용**, ATT **미사용**
- [x] 전 통신 **HTTPS** (Apple 수출규정 표준 면제 선언 대상)
- [x] **인앱 데이터 삭제** 경로 제공(`DELETE /me`, ADR-017)
- [x] 알림은 **거래성만**(광고성 아님, ADR-018)
- [x] 제3자 SDK(Expo Push·Cloudflare·tracker.delivery) **공유 신고 포함**

## 관련 문서

- `docs/PRIVACY_POLICY.md` (방침 단일 출처) · `docs/QA_FINDINGS.md` QA-011 · `docs/QA_TESTPLAN.md` §3-B
- ADR-002(익명)·005(비영속)·017(삭제)·018(거래성) · `docs/PRD.md` "스토어 정책 & 컴플라이언스"
