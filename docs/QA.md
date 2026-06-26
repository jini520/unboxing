# QA (통합 문서)

> **비메인 참고 문서.** QA 발견사항·수동 테스트플랜·리뷰노트·스토어 신고 초안을 한 파일로 통합.
> 메인 설계 문서는 `PRD`·`ADR`·`ARCHITECTURE`·`UI_GUIDE`. 각 절은 원문 그대로(verbatim) 보존.
> 본문에 나오는 옛 파일명(`QA_FINDINGS.md`·`QA_TESTPLAN.md`·`REVIEW_NOTES.md`·`STORE_PRIVACY_FILING.md`)은 모두 **이 문서의 해당 절(A~D)**을 가리킨다.

## 목차
- [A. QA 발견사항](#a-qa-발견사항-구-qa_findingsmd)
- [B. 수동 테스트플랜](#b-수동-테스트플랜-구-qa_testplanmd)
- [C. 리뷰 노트](#c-리뷰-노트-구-review_notesmd)
- [D. 스토어 개인정보 신고](#d-스토어-개인정보-신고-구-store_privacy_filingmd)
- E. v1.1 TDD 테스트 계획 (구현 착수 전 사전 설계)
- F. webhook-first 전환 TDD 테스트 계획 (ADR-028·029)

<a id="a-qa-발견사항-구-qa_findingsmd"></a>

---

# A. QA 발견사항 (구 `QA_FINDINGS.md`)

# QA 발견 기록 (Findings) — 단일 출처

> `qa-mvp` phase가 MVP를 E2E로 QA하며 발견한 갭을 누적한다. 단위·통합 테스트(green)가 못 잡는
> 실제 사용자 여정의 결함을 기록만 한다. **이 phase는 발견·기록 전용 — 버그를 고치지 않는다**(find↔fix 분리).
>
> - 갭은 verify 를 빨갛게 만들지 않는다: 실패 단언 대신 `it.todo("QA-NNN: …")`/`.skip` + 이 표에 기록.
> - 사양 출처는 `docs/PRD.md`·`docs/ARCHITECTURE.md`·`docs/ADR.md` 의 해당 섹션을 가리킨다.
> - 심각도: **P0** 핵심 가치 차단 / **P1** 주요 기능 결함 / **P2** 부차 결함 / **P3** 사소·개선.

## 통합 요약 (qa-mvp phase 전체 — Step 5)

> Step 0~5 의 E2E·정적·스토어 감사 발견을 집계한다. **버그를 고치지 않았다**(find↔fix 분리). 정적 감사 8종은 모두 CLEAN(위반 0건) — 아래 "정적 감사 결과" 섹션(Step 3·4).

### 심각도별 집계 (총 12건)

| 심각도 | 건수 | ID |
|---|---|---|
| **P0** 핵심 가치 차단 | 1 | QA-001 |
| **P1** 주요 기능 결함 | 2 | QA-009, QA-011 |
| **P2** 부차 결함 | 5 | QA-002, QA-004, QA-007, QA-010, QA-012 |
| **P3** 사소·개선 | 4 | QA-003, QA-005, QA-006, QA-008 |

### MVP DoD(PRD "MVP 완료 기준") 대비 미충족

| DoD 항목 | 상태 | 관련 발견 |
|---|---|---|
| 등록(수동+클립보드 제안)→자동인식/확인(미지원 딥링크) | ⚠️ 부분 | QA-001(거부 시 등록 데드락)·QA-002(미지원 딥링크 미도달) |
| 목록/상세(실시간 타임라인)·삭제·당겨서 새로고침 | ✅ (수동 런스루로 화면 확인 필요) | — (TESTPLAN §2) |
| cron 폴링+정규화+단계 전환 멱등 푸시 | ✅ 코어 검증 / ⚠️ 알림 품질 | QA-004(조용시간)·QA-005(그룹화)·QA-006(carrier id 노출) |
| 푸시 권한 온보딩(거부 graceful) | ❌ | QA-001(거부 시 등록 불가 — graceful 아님)·QA-003(오안내) |
| 라이트/다크 테마·설정 화면 | ✅ | — |
| 인앱 "모든 데이터 삭제"(`DELETE /me`) | ✅ (push_tickets 잔존만) | QA-008 |
| 개인정보처리방침 URL | ❌ | QA-009(placeholder) |
| App Privacy / Data Safety 신고 | ❌ | QA-011(초안 부재) |
| Privacy Manifest / required-reason | ⚠️ | QA-012(앱 레벨 미선언) |
| 데모/리뷰 노트 | ⚠️ | QA-010(미설정·노트 부재) |
| 핵심 순수 로직 테스트(`npm run verify` green) | ✅ | app 76+1todo · worker 110+7todo · harness 51 |

### 이슈 등록 후보 (phase 종료 후 사람이 검토·등록 — 격리 세션에서 `gh` 호출 금지)

- **기등록**: QA-001 → #3 (P0, 등록 데드락). QA-003 은 #3 에 연계(QA-001 수정 시 해소).
- **신규 후보**: QA-002·QA-004·QA-005·QA-006·QA-007·QA-008·QA-009·QA-010·QA-011·QA-012.
  - 우선 등록 권장(P1): QA-009(개인정보처리방침 URL), QA-011(App Privacy/Data Safety 신고) — 둘 다 **제출 차단**.
  - 묶음 검토 가능: QA-004/005/006(알림 품질), QA-009/010/011/012(스토어 제출 준비).

| ID | 심각도 | 영역 | 사양 출처 | 재현 | 현재 동작 | 기대(사양) | 제안 수정 | 이슈# |
|---|---|---|---|---|---|---|---|---|
| QA-001 | P0 | 등록/인증 | PRD 핵심 플로우 5 · NFR(권한 거부 graceful) | ① 푸시 권한 거부(토큰 없음) → `POST /devices` 가 유효 `push_token` 필수라 device 미등록 → ② `POST /shipments` 가 `SELECT 1 FROM devices` 실패로 `401`. 알림 없이 추적만 원하는 사용자가 등록 자체 불가. **앱측 원인(Step 4 확인)**: `app` 에 *푸시 토큰 없이 device 를 등록하는 익명 경로가 없다* — `registerDevice`(api.ts)는 `push_token` 을 필수 인자로 받고, 호출처 3곳(`usePushNotifications`·`onboarding`·`settings`)이 모두 `'token' in result`/`perm.granted` 가드 뒤에서만 호출. 즉 거부 시 device 미등록이 서버·앱 양쪽에서 확정된다. | 푸시 토큰이 없으면 기기 등록이 안 되고, 그 결과 운송장 등록이 `401` 데드락 | 푸시를 거부해도 운송장 등록·조회는 가능해야 한다(알림만 비활성) | device 등록을 `push_token` 없이 허용(토큰 nullable)하거나, 송장 등록 시 device 를 토큰 없이 자동 생성하는 익명 경로. **앱측**: 첫 등록 전(또는 `apiDeps` wiring)에서 토큰 유무와 무관하게 device 를 1회 부트스트랩(예 `POST /devices {platform}` 토큰 생략). | #3 |
| QA-002 | P2 | 등록/택배사 | PRD 핵심 플로우 4(미지원→딥링크) · ARCH 에러매트릭스(`409 CARRIER_UNSUPPORTED`) | device 등록 후 형식은 유효하나(`^[a-z]{2,}\.…`) tracker.delivery 미지원인 carrier(예 `kr.notreal`, 또는 `carrier.ts` 오추정 결과)로 `POST /shipments`. | 서버 `409` 는 `CARRIER_RE`(형식)만 검사 → 형식 유효 carrier 는 전부 `201` 수락. 미지원이어도 받아 영구 `미등록`(7일 후 비활성). 앱 `CARRIERS` 8종은 모두 형식 유효라 `409` 딥링크 폴백이 트리거되지 않음(`index.ts` `CARRIER_RE` 주석: "실제 지원목록 대조는 후속"). | 미지원 택배사는 `409 CARRIER_UNSUPPORTED` → 앱이 딥링크 안내(PRD 플로우4) | 서버가 tracker.delivery `carriers` 지원목록과 대조해 미지원이면 `409`(또는 앱이 등록 전 사전 차단·딥링크). | — |
| QA-003 | P3 | 등록/에러카피 | PRD 마이크로카피(에러코드 비노출·정확 안내) · 플로우5 | 푸시 거부(QA-001) 상태에서 등록 시도 → 서버 `401` → `register.tsx` `submit` 이 `401` 을 별도 분기 없이 `"generic"` 으로 매핑. | 영구 데드락(`401`)이 `"등록하지 못했어요. 잠시 후 다시 시도해 주세요"`(일시 오류 카피)로 표시 → 사용자는 원인(권한 거부) 모른 채 무한 재시도. | 영구 실패를 일시 오류처럼 오안내하지 않음(원인·해결 안내). | 1차로 QA-001 수정 시 `401` 자체가 사라짐(권장). 잔존 시 `submit` 에 `401` 분기 추가(권한/기기 안내). | (#3 연계) |
| QA-004 | P2 | 알림/조용시간 | PRD 알림 정책(조용시간 22:00–08:00 KST 보류 후 아침 묶음) · ADR-018(과알림 방지) | cron 폴링이 단계 전환을 감지하면 시각과 무관하게 즉시 `sendPush`. `cron.ts deliver`/`push.ts` 어디에도 KST 야간 판정·보류 큐·아침 묶음이 없다. | 야간(KST 22–08)에도 등록·집화·배송출발 등 모든 단계 전환 푸시를 즉시 발송 → 새벽 알림 발생 가능. | 야간에는 예외·배송완료 외 발송을 보류하고 아침에 묶어 전달. | `deliver` 전 KST 야간 판정 → 비긴급 단계는 보류 큐(D1)에 적재, 아침 첫 cron 에서 묶음 발송. *(PRD가 "권장"·"정확 시간 구현 시 확정" 표기 → Phase 1 의도적 보류 가능성 — 명시 정책이라 기록만)* | — |
| QA-005 | P3 | 알림/그룹화 | PRD UX(알림 그룹화·묶음/요약) · UI_GUIDE 알림 UI(여러 송장 묶음/요약) | `push.ts buildMessage`/`sendPush` 는 (token, shipment)별 개별 메시지를 만들고 묶음 키(collapse/thread)·요약 메시지가 없다. | 여러 송장이 동시에 전환되면 개별 푸시 N건 발송(그룹화·요약 없음) → 과알림. | 여러 송장 알림은 묶음/요약(과알림 방지, 조용시간과 결합). | Android collapseKey·요약 알림 또는 조용시간 묶음과 결합. *(앱측 "배송 상태" channel 분리는 Phase 1 앱 범위)* | — |
| QA-006 | P3 | 알림/마이크로카피 | PRD 마이크로카피(기술 용어 비노출) · 알림 정책 카피("{택배사} 접수 확인") | `cron.ts notifyTransition`→`push.ts buildMessage` title = `${carrier} · …${last4}`, carrier 는 tracker.delivery carrierId(예 `kr.cjlogistics`). E2E `tracking.test.ts` 가 title 에 `kr.cjlogistics` 노출 확인. | 푸시 title 에 택배사 id(`kr.cjlogistics`) 가 그대로 노출 — 친근한 한글 택배사명(예 "CJ대한통운") 아님. | 사용자 노출 문구는 친근한 한글 택배사명(기술 id 비노출). | carrierId→표시명 매핑(코드 상수 또는 `carriers` 캐시)으로 title 구성. 앱 carrier 메타와 단일 출처 공유 권장. | — |
| QA-007 | P2 | 수명주기/안내 | PRD 핵심 플로우6("7일 미수신 시 '번호 확인' 안내 후 비활성") · ARCH "데이터 수명주기 & 만료" 표("미등록 7일 / 예외 7일 → 자동 비활성 + 안내") | `lifecycle.ts lifecycleAction` 이 `미등록7일`·`예외7일` 에 `notify:false` 반환 → `cron.ts pollOne` 이 `active=0` 만 하고 푸시 없음. '번호 확인' 안내 메시지 경로(buildMessage 등)도 부재. E2E `lifecycle.test.ts` 가 비활성 후 `sendCalls=0`(추가 안내 없음) 확인. | 미등록7일·예외7일 송장이 **조용히** 비활성 — 오타/잘못된 번호 사용자가 원인·해결 안내를 못 받음. | 7일 비활성 시 "번호 확인" 안내 1회 발송(PRD 플로우6). | `lifecycle` 7일 규칙 `notify:true` + `cron` 에 안내용 buildMessage 경로 추가(또는 앱이 `active=0`+`미등록` 을 보고 인앱 안내). **단 ARCH 만료/좀비 요약줄은 7일에 "알림" 표기를 생략 → 사양 내부 불일치(의도적 Phase1 보류 가능성)도 함께 검토.** | — |
| QA-008 | P3 | 삭제/완전폐기 | ADR-017(`DELETE /me` "푸시 토큰 폐기") · ARCH "데이터 수명주기"(사용자 데이터 삭제) | 발송 후 ~15분 내 `DELETE /me` 호출 시. `index.ts handleDeleteMe` 는 `devices`(정규 push_token 저장소) 만 폐기하고 `push_tickets`(receipt 대기 버퍼)의 `push_token` 은 손대지 않는다. E2E `lifecycle.test.ts` 가 `DELETE /me` 후 `devices=0`·`push_tickets=1`(토큰 잔존) 확인. | "모든 데이터 삭제" 후에도 push_token 사본이 `push_tickets` 에 ~15분(다음 receipt sweep)까지 잔존 — 즉시 완전 폐기 아님. | `DELETE /me` 는 push_token 을 **즉시 완전 폐기**(ADR-017). | `handleDeleteMe` 에 `DELETE FROM push_tickets WHERE push_token = ?` 추가. (잔존 데이터는 ticket_id+token 뿐·비개인정보, sweep 으로 자동 정리되므로 영향 작음 → P3.) | — |
| QA-009 | P1 | 스토어/개인정보 | PRD 스토어 컴플라이언스(개인정보처리방침 URL 필수·앱+스토어 양쪽) · 한국 PIPA | `settings.tsx:27 PRIVACY_POLICY_URL = "https://unboxing.app/privacy"` 가 **placeholder**(미배포 도메인). 설정 화면 링크·스토어 제출 양쪽이 이 값을 가리킨다. | 개인정보처리방침이 미배포 placeholder URL — 실제 한글 방침 문서(수집항목·제3자 제공·국외이전·삭제·문의처)가 게시되지 않음. | 실제 한글 개인정보처리방침을 공개 URL에 게시하고 앱·스토어 양쪽에 그 URL 사용. **제출 차단**. | 방침 문서 작성·호스팅(수집: 운송장·푸시토큰 / 제3자: tracker.delivery / 국외이전: Cloudflare / 삭제: `DELETE /me`) 후 `PRIVACY_POLICY_URL` 갱신. | #12 (step5: `docs/PRIVACY_POLICY.md` 작성·`PRIVACY_POLICY_URL` 명시 TODO 주석 — repo 산출물 완료, **호스팅·URL 확정 잔여**) |
| QA-010 | P2 | 스토어/심사 | ADR-019(데모 경로·리뷰 노트) · ARCH "데모/리뷰 경로" | 데모 분기 코드는 있으나(`tracker.ts:230` `demoTrackingNumber` 캔드 + `cron.ts:173` 데모번호 알림 우회) **`DEMO_TRACKING_NUMBER` 가 `wrangler.toml [vars]` 에 미설정** → 런타임 `env.DEMO_TRACKING_NUMBER` 가 undefined 라 데모 분기 영구 비활성. 또한 리뷰 노트(샘플 번호·예상 동작) 문서가 repo·스토어 메타 어디에도 없음. 앱에는 데모 분기 없음(데모 등록도 일반 등록 경로 → QA-001 데드락 경유). | 심사자가 실배송 없이 검증할 데모 번호가 동작하지 않고(미설정) 리뷰 노트도 부재 → Apple 4.2 minimum functionality / 기능 미확인 거절 리스크. | `DEMO_TRACKING_NUMBER` 설정 시 캔드 타임라인 반환 + 리뷰 노트에 샘플 번호·예상 동작 기재(ADR-019). | `wrangler.toml [vars]` 에 `DEMO_TRACKING_NUMBER` 설정 + 제출 리뷰 노트 작성(QA_TESTPLAN 체크리스트). 데모 등록이 QA-001 데드락을 안 타려면 QA-001 선결 필요. | — |
| QA-011 | P1 | 스토어/신고 | PRD Apple App Privacy(Nutrition Labels) · Google Data Safety form · 한국 PIPA(제3자·국외이전 고지) | 수집(운송장·푸시토큰)·제3자 제공(tracker.delivery 로 운송장 전송)·국외이전(Cloudflare) 신고 **초안이 repo 어디에도 문서화돼 있지 않음**(스토어 콘솔 입력 항목). | App Privacy / Data Safety 신고 내용이 정리돼 있지 않아 제출 시 즉석 작성 → 누락·오신고 위험(특히 제3자 SDK 포함 의무). | 신고 항목 초안(수집·공유·국외이전·삭제 메커니즘)을 사전 문서화해 제출 시 그대로 입력. **제출 필수 양식**. | QA_TESTPLAN(이 문서 B절) 제출 체크리스트에 신고 초안 정리(아래 step5 추가분). 실제 신고는 콘솔에서 사람이 수행. | #14 (step5: **이 문서 D절**(구 STORE_PRIVACY_FILING) 신고 초안 작성 — repo 산출물 완료, **콘솔 제출 잔여**) |
| QA-012 | P2 | 스토어/Privacy Manifest | PRD Apple Privacy Manifest(`PrivacyInfo.xcprivacy`)·required-reason API · 클립보드 사유 문자열 | `app.json` 에 `ios.privacyManifests`·`ios.infoPlist`(클립보드 사용 사유 등) 설정이 **없음**. Expo 의존성(expo-clipboard·async-storage·expo-application 등)은 각자 `PrivacyInfo.xcprivacy` 를 갖지만, 앱 레벨 매니페스트 병합·required-reason(예 UserDefaults) 신고와 클립보드 read 사유는 미확인. | 앱 레벨 Privacy Manifest/required-reason 신고가 명시되지 않음 — 제출 시 누락 시 거절·경고 가능. | Privacy Manifest + required-reason 코드 신고(클립보드 등)를 빌드 산출물에 포함·검증. | `expo prebuild` 산출 `PrivacyInfo.xcprivacy` 확인 + 필요한 required-reason(`NSPrivacyAccessedAPICategory…`) 선언, 클립보드 사유 문자열(`app.json ios.infoPlist`) 추가 검토. iOS 빌드 시점 검증. | #15 ✅ (step5: `app.json ios.privacyManifests` UserDefaults `CA92.1`·FileTimestamp `C617.1` 선언 + `app-config.test.ts` sanity. 클립보드는 iOS에 Info.plist 키·required-reason 없음 → 미추가, 이 문서 **D절 §3-A** 기록. 정식 검증은 iOS 빌드) |

## 정적 감사 결과 (Step 3 — 개인정보 비영속·SQLi·로그 금지)

> CLAUDE.md CRITICAL 3종(개인정보 비영속·SQLi 방지·민감값 로그 금지)을 grep + E2E 로 감사. **결과: 위반 없음(CLEAN)** — 위반 발견 시 P0~P1 로 기록할 예정이었으나 현재 코드는 사양을 지킨다.

| 감사 | 방법 | 결과 | 근거 |
|---|---|---|---|
| **개인정보 비영속** (ADR-005/011 · CLAUDE.md CRITICAL) | `schema.sql`/`src/schema.ts` 컬럼 + `worker/src` 의 모든 `INSERT/UPDATE` grep + E2E DB 덤프 검사 | **CLEAN** | `shipments` 쓰기는 `last_normalized_status`·`last_polled_at`·`active`·`fail_count`·`next_retry_at` 뿐 — 수령인/`description`/`location` 컬럼 자체가 스키마에 없다. `description`·`location` 은 `index.ts handleGetShipment` 의 응답 `timeline`(실시간 조회, 미저장 ADR-011)·`tracker.ts` 데모 캔드값에만 등장. E2E `lifecycle.test.ts` 가 폴링 후 전 테이블 덤프에 주입한 수령인/위치 문자열이 **없음**을 런타임 재확인. |
| **SQLi 방지** | `worker/src` 의 `.prepare(` 36건 + SQL 내 `${}` 보간 라인 grep | **CLEAN** | SQL 문자열의 `${}` 는 ① 상수 컬럼 헬퍼 `shipmentCols()`(고정 식별자), ② `placeholders = ids.map(()=>"?").join(", ")`(값 아닌 `?` 목록) 뿐. 모든 **값**은 `.bind()` 로 바인딩(prepared). 사용자 입력 문자열 결합 SQL 없음. |
| **로그 금지** (ADR-007) | `worker/src`·`app/src` 의 `console.*` grep + 로깅 인자 검사 | **CLEAN** | worker `console` 은 `cron.ts:197 logPollError` 1곳(`{ carrier, failCount, error }` 만). `error` 메시지 출처(`tracker.ts` throw)는 "토큰 발급 실패"/"GraphQL 오류: {codes}"/"data 없음" 으로 tracking_no·token·secret 미포함. `device_id`·`push_token`·`tracking_no`·수령인 로깅 없음. `app/src` 는 `console.*` 0건. |

## 정적 감사 결과 (Step 4 — 앱 UI 사양·안티패턴·비밀)

> UI_GUIDE("AI 슬롭 안티패턴"·"색 단독 금지"·시맨틱 토큰)·PRD(에러코드 비노출)·ARCHITECTURE(EXPO_PUBLIC 비밀 금지)를 grep + 코드리딩으로 감사. **결과: 위반 없음(CLEAN)**. 로직 플로우는 `app/src/lib/__qa__/flows.test.ts`(16 pass + 1 todo)로 별도 검증.

| 감사 | 방법 | 결과 | 근거 |
|---|---|---|---|
| **AI 슬롭 안티패턴** (UI_GUIDE) | `app/{src,app}` 의 `expo-blur`/`BlurView`·`gradient`/`LinearGradient`·보라/인디고(`purple`/`indigo`/`violet`/`8b5cf6`/`6366f1`/`7c3aed`/`a855f7`)·`glow`·`shadowColor`/`shadowOpacity`/`shadowRadius`/`elevation` grep | **CLEAN** | 5종 모두 **0건**. 글래스모피즘·그라데이션·보라브랜드·글로우·그림자/elevation 남발 없음. 카드는 `borderWidth:1`+토큰 `border` 로만 구분(UI_GUIDE 라이트 기준). |
| **하드코딩 hex 금지** (UI_GUIDE 시맨틱 토큰) | `app/{src,app}` 의 `#[0-9a-f]{6}` grep — `tokens.ts` 외 | **CLEAN** | `#rrggbb` 는 `src/theme/tokens.ts`(단일 색 출처)에만. 컴포넌트·화면은 hex 0건 — 전부 `useTheme().tokens.*` 참조. |
| **색 단독 금지** (UI_GUIDE 접근성) | `StageBadge.tsx` 코드리딩 | **CLEAN** | 단계 표시 = 색(`tokens.stage`) + 글리프(`○•▸✓!`) + 한글 라벨(단계명) + `accessibilityLabel="단계: …"`. 색에만 의존하지 않음(8단계 매핑). `ShipmentCard`·상세도 `StageBadge` 재사용. |
| **에러 코드 비노출** (PRD 마이크로카피) | `app/*.tsx` 의 `.code`/`.message`/원시 에러 렌더 grep + 분기 검사 | **CLEAN** | `ApiError.code` 사용은 *내부 분기*뿐(`e.code === "NETWORK"`, `e.status === 409/429/422/404/403`). 화면 노출 문구는 전부 친근 카피로 매핑 — `register` `ERROR_COPY`/딥링크 안내, 상세 `TimelineState` kind→카피, 목록/설정 `Alert` 정적 카피. 서버 `code`/원문 `message` 를 `Text` 로 렌더하는 곳 없음. |
| **EXPO_PUBLIC 비밀 금지·URL 단일출처** (ARCHITECTURE 환경변수) | `app/{src,app}` 의 `EXPO_PUBLIC`·`https?://` literal grep | **CLEAN** | `EXPO_PUBLIC_*` 는 `EXPO_PUBLIC_API_URL`(Worker 공개 URL) 단 하나 — 비밀 아님. 사용처는 `src/config.ts` 1곳(`API_URL` 상수), 모든 API 호출이 이를 경유. 화면·lib 에 서버 URL 하드코딩 없음(딥링크용 `search.naver.com`·정책 URL 은 공개 외부 링크라 무관). |

## 스토어 준비 감사 결과 (Step 5 — 제출 차단 항목)

> PRD "스토어 정책 & 컴플라이언스"(Apple·Google·한국 법규)·ADR-017/018/019 대비 제출 준비도를 감사. **충족=PRESENT / 갭=위 발견표 QA-009~012 로 기록**. 갭은 기록만(수정·이슈 자동생성 금지).

| 감사 | 결과 | 근거 |
|---|---|---|
| **인앱 데이터 삭제** (Apple 5.1.1(v)·Google·ADR-017) | **PRESENT** | `settings.tsx` 가 설정에 눈에 띄게 "모든 데이터 삭제"(예외 색·확인 다이얼로그·복구 불가 명시) 제공 → `wipeAllData`(서버 `DELETE /me` 먼저 → 캐시 → device_id 순) 호출. 동작은 Step 3 E2E(`DELETE /me` 완전폐기)로 검증. 잔존 1건(push_tickets)은 QA-008(P3). |
| **거래성 알림만** (ADR-018·정보통신망법) | **PRESENT(CLEAN)** | `worker/src/push.ts` 에 마케팅/광고(`광고`/`marketing`/`promo`) 경로 0건 — 단계 전환 거래성 메시지만. `settings.tsx` 주석도 "광고성/마케팅 알림 설정은 두지 않는다(ADR-018)" 명시, 마케팅 토글 없음. |
| **개인정보처리방침 URL** | **부분 → QA-009 (P1)** | step5: `docs/PRIVACY_POLICY.md`(한글 방침) 작성, `PRIVACY_POLICY_URL` 에 명시 TODO 주석(조용한 placeholder 해소). **repo 산출물 완료 / 호스팅·URL 확정은 배포 시 외부 작업 잔여**(#12). |
| **데모/리뷰 경로** (ADR-019) | **갭 → QA-010 (P2)** | 데모 분기 코드는 존재하나 `DEMO_TRACKING_NUMBER` 미설정(undefined)으로 비활성 + 리뷰 노트 부재. |
| **App Privacy / Data Safety 신고** | **부분 → QA-011 (P1)** | step5: **이 문서 D절**(데이터 인벤토리·Apple App Privacy·Google Data Safety·PIPA 국외이전 초안) 작성. **repo 산출물 완료 / 콘솔 제출 잔여**(#14). |
| **Privacy Manifest / required-reason** | **PRESENT → QA-012 (P2) ✅** | step5: `app.json ios.privacyManifests` 선언(UserDefaults `CA92.1`·FileTimestamp `C617.1`, `NSPrivacyTracking:false`) + `app-config.test.ts` JSON sanity. 클립보드는 iOS에 해당 Info.plist 키·required-reason 카테고리 없음 → 미추가(근거 이 문서 **D절 §3-A**). **정식 검증은 iOS 빌드(`expo prebuild`)** (#15). |


<a id="b-수동-테스트플랜-구-qa_testplanmd"></a>

---

# B. 수동 테스트플랜 (구 `QA_TESTPLAN.md`)

# QA 수동 테스트플랜

> 자동화(vitest E2E·jest)로 덮을 수 없는 항목의 수동 QA 절차. 자동 검증 가능한 흐름은
> `worker/test/e2e/` 와 이 문서 **A절**(QA 발견사항)이 담당한다. **이 B절은 실기기/시뮬레이터에서
> 사람이 수행하는 절차** — 각 케이스는 _전제 → 조작 → 기대_ 순. 발견되는 갭은 이 문서 **A절**에 기록.
>
> 사양 출처: `docs/PRD.md`(플로우·알림 정책·스토어 컴플라이언스), `docs/ARCHITECTURE.md`(푸시 파이프라인·데모 경로),
> `docs/UI_GUIDE.md`(화면·상태별 UI), `docs/ADR.md`(ADR-016~019).
>
> ✅ **QA-001(P0) 수정됨**(qa-fixes step0, #3): 기기 등록을 push_token 에서 분리 — 토큰 없이 device 등록 가능,
> 앱이 등록 전 device 를 부트스트랩한다. 거부 graceful 케이스(§1-C)는 이제 **성공 기대**(실기기 최종 확인 필요).
> 데모 경로(§3) 는 QA-010(미설정) 미해결 시 비활성.

## 1. 실기기 푸시 시나리오

> 시뮬레이터/유닛테스트로 검증 불가 — APNs/FCM 실제 전달, 권한 팝업, 딥링크가 실기기에서만 동작.
> **iOS·Android 각각** 수행. 서버 단계 전환은 데모 번호(§3) 또는 스테이징에서 폴링 트리거로 유발.

### 1-A. 권한 priming → 허용 → 알림 수신 → 딥링크 (해피패스)
1. 신규 설치(또는 데이터 삭제 후) 첫 실행 → 온보딩 **사전 안내(priming)** 화면이 시스템 팝업 **앞에** 뜬다.
2. priming "허용" → OS 권한 팝업 → "허용". (iOS: 한 번만 / Android 13+: `POST_NOTIFICATIONS` 런타임 팝업)
3. 운송장 등록(데모 번호 권장) → 목록에 표시.
4. 서버 단계 전환 트리거(등록·집화·배송출발·배송완료·예외 각각) → **해당 단계마다 1회** 알림 수신.
5. **멱등 확인**: 같은 단계로 재폴링돼도 중복 알림 없음. `이동중`·`기타`·`미등록` 은 알림 없음(타임라인만).
6. 알림 탭 → 앱이 **해당 송장 상세**로 딥링크(payload `shipment_id`). 콜드 스타트(앱 종료 상태)에서도 동작.

### 1-B. 알림 카피·채널·조용시간
1. 단계별 문구가 PRD 알림 정책과 일치(친근한 한글, **에러코드/기술 id 노출 없음**). ⚠️ QA-006: title 에 `kr.cjlogistics` 등 carrier id 노출 여부 확인.
2. Android: 알림이 **"배송 상태" notification channel** 로 분리됐는지(시스템 설정 > 앱 > 알림).
3. ⚠️ QA-004: 야간(KST 22:00–08:00)에 비긴급 단계 전환 발생 시 즉시 발송되는지(조용시간 미구현 — 새벽 알림 재현).
4. ⚠️ QA-005: 여러 송장 동시 전환 시 개별 N건인지/묶음 요약인지(그룹화 미구현 재현).

### 1-C. 권한 거부 graceful (✅ QA-001 수정됨 — 최종 확인)
1. priming → OS 팝업 → **"거부"**.
2. 기대(사양): 등록·조회는 계속 가능, 알림만 비활성 + "알림 꺼짐 — 켜기" 배너로 설정 유도.
3. **확인(QA-001 #3 수정)**: 푸시 거부 상태에서 운송장 등록 → `401` 데드락 없이 **등록 성공**(목록에 표시).
   앱이 토큰 없이 `POST /devices {platform}` 로 device 를 부트스트랩하기 때문(시작 시 1회 + 등록 직전 ensure).
   *앱→실 worker E2E 자동화는 RNTL 보류라 부재 — 이 항목으로 시뮬레이터/실기기 최종 확인.*
4. 설정 화면에서 "배송 상태 알림 > 켜기" → 시스템 설정 이동 → 권한 허용 후 복귀 시 "켜짐" 반영(새 토큰이 device 에 갱신).

### 1-D. 무효 토큰 위생 (receipt)
1. 알림 허용 후 OS 레벨에서 앱 알림 끄기/재설치로 토큰 무효화 → 다음 발송 후 ~15분 receipt sweep 에서 `DeviceNotRegistered` → 토큰 삭제(이후 발송 중단). (서버 로그/스테이징 확인.)

## 2. 시뮬레이터/기기 화면별 런스루

> 화면 컴포넌트 E2E(Maestro)는 Phase 2 보류 — 그 전까지 수동 런스루로 커버. iOS 시뮬레이터·Android 에뮬레이터.

### 2-A. 화면별
- **목록(주화면)**: 빈 상태(가치 제안 한 줄 + 첫 등록 CTA, 중앙 정렬) / 카드 스택(단계 배지=색+아이콘+라벨, 택배사·끝4자리, 마지막 업데이트 상대시간) / 진행 중·임박·예외 정렬 강조 / 당겨서 새로고침.
- **상세**: 단계 배지 즉시(캐시) + 타임라인(실시간, 최신 위, KST 상대+절대 시각·허브명) / 삭제 버튼.
- **등록**: 번호 입력 → 택배사 자동추정/확인(드롭다운) → 등록. 입력값 보존(실패 시). 미지원 택배사 → 딥링크 카드(⚠️ QA-002: 형식 유효 미지원이 딥링크 미도달 여부 확인).
- **온보딩**: priming → 시스템 요청(§1).
- **설정**: 알림 토글 / 테마(시스템·라이트·다크) / 개인정보처리방침 링크(⚠️ QA-009: placeholder URL) / 모든 데이터 삭제 / 버전.
- **빈 상태**: 첫 실행 + 데이터 삭제 후.

### 2-B. 상태별 UI (로딩/오프라인/에러 — 누락 금지)
- **로딩(목록)**: 캐시 있으면 캐시 먼저 + 상단 새로고침 인디케이터 / 없으면 스켈레톤 카드(좌측 정렬).
- **로딩(상세)**: 단계 배지 즉시 + 타임라인 스켈레톤.
- **오프라인**: 비행기 모드 → 상단 **오프라인 배너**(비파괴적), 캐시 목록/마지막 상태 표시, 등록/삭제 등 변경 액션 비활성 + 사유 안내.
- **상세 upstream 실패**: 마지막 단계 + "타임라인을 못 불러왔어요, 다시 시도".
- **등록 실패**: 인라인 에러(코드 노출 없음) + 재시도, 입력값 보존.
- **알림 비활성**: 권한 거부 시 상단 작은 배너 "알림 꺼짐 — 켜기".

### 2-C. 테마·인터랙션
- **테마 전환**: 시스템 다크/라이트 토글 → 시스템 추종 즉시 반영. 설정에서 라이트/다크 고정 → 시스템과 무관하게 고정. 양쪽 모두 대비 WCAG AA(색 단독 의존 금지 — 색+아이콘+라벨).
- **스와이프 삭제 + Undo**: 카드 스와이프 → 확인 다이얼로그 → 토스트 Undo(만료 후 서버 반영).
- **당겨서 새로고침**: 목록·상세(오프라인이면 안내).
- **접근성**: VoiceOver/TalkBack 라벨(단계·번호·액션), 다이내믹 타입 확대, reduce motion 시 애니메이션 축소. device_id 등 민감값 미노출.
- **클립보드 제안**: 등록 화면 진입 시에만 읽고 **제안만**(자동 등록 ❌). iOS: 붙여넣기 배너 1회.

## 3. 스토어 제출 체크리스트

> 제출/심사 통과 필수 — 코드만으로 검증 불가(콘솔 설정·심사 노트 포함). 갭은 이 문서 **A절** QA-009~012.
> **repo 산출물(qa-fixes step5)**: 방침 `docs/PRIVACY_POLICY.md` · 신고 초안 **이 문서 D절**(아래 §3-B 표의 권위 출처) · 배포 마이그레이션 `docs/ENGINEERING.md` **B절**.

### 3-A. 공통
- [ ] **개인정보처리방침(한글) URL** 게시 + 앱(`settings.tsx PRIVACY_POLICY_URL`)·스토어 양쪽 반영 (⚠️ QA-009: 방침 문서 `docs/PRIVACY_POLICY.md` 작성됨, URL 은 호스팅 후 확정 — TODO 주석). 방침에 수집항목(운송장·푸시토큰)·목적·**제3자 제공**(tracker.delivery)·**국외이전**(Cloudflare)·보유/삭제·문의처 명시.
- [ ] **인앱 "모든 데이터 삭제"** 동작 확인(설정 → 확인 다이얼로그 → 빈 상태 복귀, `DELETE /me`). ✅ 구현됨.
- [ ] **데모/리뷰 노트**: `DEMO_TRACKING_NUMBER` 설정(⚠️ QA-010 미설정) + 리뷰 노트에 샘플 번호·예상 동작("등록→이동중→배송출발 캔드 타임라인, 실폴링 없음") 기재.
- [ ] **전송 암호화**: 전 통신 HTTPS → Apple 수출규정 표준 면제 선언.
- [ ] 스크린샷(주요 화면), 연령 등급(**4+** 예상), 앱 아이콘/메타.

### 3-B. App Privacy / Data Safety 신고 초안 (QA-011 — 콘솔 입력용)

> 권위 출처: **이 문서 D절**(데이터 인벤토리·Apple/Google 콘솔별 표). 아래는 요약.

| 데이터 | 수집? | 공유(제3자)? | 용도 | 비고 |
|---|---|---|---|---|
| 운송장 번호 | 예 | 예 — tracker.delivery(조회) | 배송 추적 | 식별성 낮음 |
| 푸시 토큰 | 예 | 예 — Expo Push(전달) | 상태 변화 알림 | — |
| 택배사·정규화 상태 | 예 | 아니오 | 추적·정렬 | 단독 식별 불가 |
| 수령인 이름·주소·연락처 | **아니오(저장 안 함)** | — | 화면 표시 후 폐기(ADR-005) | App Privacy 에 "수집 안 함" |
| 광고 식별자(IDFA)·위치 | **아니오** | — | — | ATT/위치 미사용 |

- **국외이전**: 백엔드 Cloudflare(해외 리전) — PIPA 국외이전 고지 + 방침 명시.
- **Apple**: App Privacy Nutrition Labels 에 위 표 반영, ATT 미사용 선언. **Google**: Data Safety form 에 **제3자 SDK(Expo Push·Cloudflare)도 포함**, "데이터 삭제 메커니즘 제공" 표기.

### 3-C. 플랫폼별
- [ ] **Apple Privacy Manifest**(`PrivacyInfo.xcprivacy`) + required-reason API 신고(QA-012): `app.json ios.privacyManifests` 선언됨(UserDefaults `CA92.1`·FileTimestamp `C617.1`) → `expo prebuild` 산출 `PrivacyInfo.xcprivacy` 병합 결과 확인. 클립보드는 iOS Info.plist 키·required-reason 없음(미추가, 근거 이 문서 **D절 §3-A**).
- [ ] **Apple 4.2 minimum functionality**: 데모 경로로 핵심 가치(상태 변화→알림) 입증.
- [ ] **Apple 푸시 정책**: 거부해도 앱 동작(§1-C), 광고 용도 금지(ADR-018).
- [ ] **Google `POST_NOTIFICATIONS`**(Android 13+) 런타임 권한 — priming 후 요청, 거부 graceful.
- [ ] **Google 권한 최소화 / 포그라운드 서비스 미사용**(추적은 서버 cron).
- [ ] **Target API level**: 빌드 시점 Play 정책 충족(Expo SDK 56 빌드).


<a id="c-리뷰-노트-구-review_notesmd"></a>

---

# C. 리뷰 노트 (구 `REVIEW_NOTES.md`)

# 심사 리뷰 노트 (App Review / Demo)

> 스토어 제출 시 심사자에게 전달하는 노트. **실제 배송 없이** 핵심 가치(상태 변화→알림)를
> 검증할 수 있는 데모 경로를 제공한다(→ ADR-019, ARCHITECTURE "데모/리뷰 경로", QA-010).
> 제출 시 이 내용을 App Store Connect "App Review Information / Notes" · Google Play "Review notes" 에 붙여넣는다.

## 데모 운송장 번호

| 항목 | 값 |
|---|---|
| **운송장 번호** | `00000000000000` (0 14자리) |
| **택배사** | CJ대한통운 (`kr.cjlogistics`) — 자동추정 기본값, 지원 목록 통과 |

- 이 값은 `worker/wrangler.toml [vars] DEMO_TRACKING_NUMBER` 로 주입된다(비밀 아님).
- 실제 운송장과 충돌하지 않는 **예약값**이라, 데모 번호 등록 시 누구에게나 동일한 캔드(canned) 타임라인을 보여준다.

## 심사 절차

1. 앱 첫 실행 → (선택) 푸시 권한 priming. **권한을 거부해도** 등록·조회는 가능하다(알림만 비활성).
2. 등록 화면 → 운송장 번호 `00000000000000` 입력 → 택배사 **CJ대한통운** 확인 → 등록.
3. 목록에 송장이 표시되고, 상세 화면에서 캔드 타임라인을 확인할 수 있다.

## 예상 동작

- 데모 번호는 **실제 tracker.delivery 호출을 완전히 우회**하고 캔드 응답만 반환한다(실폴링 없음).
- 캔드 타임라인은 단계 진행을 보여준다: **등록(접수) → 이동중 → 배송출발**.
- 서버 cron 폴링이 단계 전환(`등록`·`배송출발` 등)을 감지하면 푸시 알림이 발송된다(`이동중`은 무알림 — 타임라인만).
- 알림 탭 → 해당 송장 상세로 딥링크.

## 주의 (심사자 참고)

- 데모 캔드는 `배송출발`에서 멈춘다(완료까지 자동 진행하지 않음). 60분마다 재폴링되지만 외부 호출은 계속 우회한다.
- 데모 송장은 30일 후 자동 비활성되며, 데모 번호에는 '분실 의심' 안내가 발송되지 않는다(데모 가드).
- 일반(비데모) 운송장은 실제 tracker.delivery 를 조회한다 — 데모 분기는 위 예약 번호에만 적용된다.

## 관련 문서

- ADR-019 (데모 경로·리뷰 노트), QA-010 (이 문서 **A절**)
- `docs/ARCHITECTURE.md` — "데모/리뷰 경로", "환경변수 & 시크릿"(`DEMO_TRACKING_NUMBER` var)
- 이 문서 **B절** §3 스토어 제출 체크리스트


<a id="d-스토어-개인정보-신고-구-store_privacy_filingmd"></a>

---

# D. 스토어 개인정보 신고 (구 `STORE_PRIVACY_FILING.md`)

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
| `notifications` *(v1.1)* | `device_id` · `carrier` · `last4`(끝4자리) · `body`·`stage`(상태 문구) · `shipment_id`(nullable) · `sent_at` | 낮음(끝4자리·상태·비식별, **수령인 없음**) | 발송한 배송 알림 기록(알림 화면) — **최대 90일/기기당 상한** 후 자동 삭제, `DELETE /me` 시 즉시 폐기. 운송장 삭제와 독립 보관(딥링크만 무효=SET NULL) |

- **수령인 이름·주소·연락처**: 어느 테이블에도 저장하지 않음(화면 표시 후 폐기, ADR-005) → **"수집 안 함"**.
- **push_token 은 선택 수집**: 알림 권한 허용 시에만 저장(거부해도 등록·추적 가능, step0). `push_tickets`·`notification_queue` 의 토큰 사본은 `DELETE /me` 시 함께 즉시 폐기(ADR-017, step3).

## 1. Apple App Privacy (Nutrition Labels)

App Store Connect > App Privacy 에 입력. 각 데이터 타입별 **수집 여부 / 연결성(linked) / 추적(tracking) / 용도**.

| Apple 데이터 타입 | 수집 | 제3자 공유 | App과 연결(linked)? | 추적(tracking)? | 용도(Purpose) |
|---|---|---|---|---|---|
| Other Data Types — 운송장 번호 | 예 | 예(tracker.delivery) | 아니오(익명·계정 없음) | 아니오 | App Functionality(배송 조회) |
| Other Data Types — 배송 상태/택배사 | 예 | 아니오 | 아니오 | 아니오 | App Functionality |
| Other Data Types — 발송 알림 기록(택배사·끝4자리·상태, *v1.1*) | 예 | 아니오 | 아니오 | 아니오 | App Functionality(받은 알림 표시) |
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
| 발송 알림 기록(택배사·끝4자리·상태, *v1.1*) | 예 | 아니오 | 서버 | 앱 기능(받은 알림 표시) | 최대 90일·`DELETE /me` 시 폐기·수령인 없음 |
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

- `docs/PRIVACY_POLICY.md` (방침 단일 출처) · 이 문서 **A절** QA-011 · 이 문서 **B절** §3-B
- ADR-002(익명)·005(비영속)·017(삭제)·018(거래성) · `docs/PRD.md` "스토어 정책 & 컴플라이언스"

---

# E. v1.1 TDD 테스트 계획 (구현 착수 전 사전 설계)

> Harness 는 **test-first(TDD)** 로 구현한다(CLAUDE.md). 그 전에 **테스트 케이스·에러 케이스를 미리 확정**해 둔다 — 구현 step 은 이 표의 케이스를 빨간 테스트로 먼저 쓰고 통과시킨다.
> 방식: 순수 로직은 **test-first·`now` 주입(고정 시계)**, 외부 의존(tracker.delivery·Expo Push)은 **mock**. ⚠️ **mock green 은 순수 로직만 보증** — 외부 경계는 §E-5 실호출 스모크로 별도 확인(CLAUDE.md). 단일 출처 함수(`stageBucket`)는 한 곳만 테스트하고 나머지는 그것을 쓴다(드리프트 금지).
> 우선순위·요약은 `ARCHITECTURE.md` "테스트 전략 (v1.1)". 설계 정의는 `ARCHITECTURE.md` "v1.1 설계 보강 ①~⑦".

## E-1. 순수 로직 (필수·test-first) — app/src/lib·worker/src/lib

### `stageBucket(stage)` — 단계→버킷 단일 출처 (보강 ①)
| 케이스 | 기대 |
|---|---|
| 미등록·등록·집화·이동중·배송출발·기타 | `진행중` |
| 배송완료 | `완료` |
| 예외 | `예외` |
| 배송출발 | `임박`=true(진행중의 부분집합) |
| 전수성 | 8단계 모두 매핑(누락 0) |
| 배타성 | 진행중/완료/예외는 상호 배타, `임박`만 진행중과 겹침 |

### `dashboardCounts(list, { trashCount, unreadCount, now })`
- 빈 목록 → 모든 카운트 0 / 혼합 목록 → 버킷별 정확(=`stageBucket` 사용) / `active=0` 이 버킷을 바꾸지 않음(예: 비활성 미등록도 진행중).
- `trashCount`·`unreadCount` 통과. **금액 teaser**: KST 이번 달 `createdAt` 건 합·휴지통 제외·금액 미입력 제외·`partial` 플래그(일부 미입력)·전부 미입력 0건이면 합 0/숨김.
- 엣지: 월 경계(KST UTC+9), 음수/undefined 금액은 합산 안 됨.

### `filterShipments(list, filter, { hideCompleted })`
- `전체`→(hideCompleted면 배송완료 제외) / `진행중`→진행중 버킷 / `임박`→배송출발만 / `완료`→배송완료만(**hideCompleted 무시·명시 우선**) / `예외`→예외만.
- 결과 0건과 입력 0건을 **구분**(호출부가 빈 안내 분기). 필터는 **정렬·순서를 바꾸지 않음**(filter→sort 별개).

### 휴지통 스토어 (`now` 주입)
- `addTrash`: 키=`carrier:tracking_no`·info 스냅샷 포함·`deletedAt=now` / 같은 키 재삭제 → 덮어씀(최신 deletedAt).
- `pruneTrash(now)`: `deletedAt < now-30일` 제거·창 내 보존 / **용량 상한** 초과 시 오래된 것부터.
- `reconcileTrash(serverKeys)`: 서버 목록에 다시 나타난 키 제거.
- `removeTrash`(영구삭제/복구 후) / 손상 JSON → 빈 객체 / `clearTrash`(wipe).

### 택배 정보 스토어 + 마이그레이션
- `migrateMemosToInfo`: `{id:"t"}`→`{id:{memo:"t"}}` / **멱등**(2회=1회) / 신 키 존재 시 no-op / 신·구 동시 존재 시 신 우선·구 정리 / 손상 구 JSON·비문자 값 → 안전(빈/스킵).
- `setInfo(id,{memo,category,amount})`: 빈 메모 → memo 필드 삭제·미설정 category/amount 미저장 / `getInfo` 기본값 / `pruneInfo(keepIds)` / `clearInfo`(wipe).

### `parseAmount` / `formatAmount`
- 유효 0 이상 정수 → number / 음수·소수·빈·비숫자·상한(≥10^10) 초과 → `undefined` / `formatAmount`: 천단위+₩, `0`→"₩0", `undefined`→"—".

### 알림 읽음 / 미읽음 (보강 ⑤)
- `unreadCount(list, lastSeen)`=`sentAt>lastSeen` 수 / `lastSeen` 미설정(첫 fetch) → `now` 초기화 → 0 / `markSeen`→`max(now, 최신 sentAt)` / 배지 표시 `99+` 상한.

### 콜드스타트 라우팅 (보강 ③) — `resolveInitialRoute({ lastNotificationResponse, homePref })`
- 알림 딥링크 존재 → `/shipment/:id`(**최우선**) / 없으면 homePref(`list`|`dashboard`) / 미설정·실패 → 택배함. (기존 `routeForNotification` 단위 테스트 유지·재사용.)

## E-2. 워커 통합 (권장) — `cloudflare:test` SELF·env·D1

| 대상 | 케이스 |
|---|---|
| 알림 로깅 | 전환 CAS 승리 → 구독 device 별 `notifications` 1행 / **음소거 구독 제외** / 재독(전환 없음) → 무기록 / **send 재시도 → 중복 행 없음**(fan-out 시점 1회) / 다중 구독 → device별 1행 |
| 조용시간 flush | 보류분 flush 시점 로깅·device_id=token 현재 소유자 / token 양도분은 flush·로깅 안 됨 |
| best-effort | 로깅 INSERT 실패가 발송/전환을 막지 않음(주입 실패 시뮬·발송 호출은 그대로) |
| `GET /notifications` | 미인증 401 / 이 device_id 행만 / `sent_at DESC` / limit(기본+상한) / denormalize 필드 존재 |
| `DELETE /me` | `notifications` 정리 포함(기존 devices·subscriptions·토큰과 함께 batch) |
| 보존 sweep | `sent_at<now-90일` 삭제 / 디바이스당 상한 초과분 정리 / cron 경로 |
| 송장 삭제 | 그 송장의 `notifications.shipment_id` → **SET NULL**(행 보존, 삭제 아님) |

## E-3. 앱 통합 (jest-expo·api mock — 보류 가능)
- 대시보드 카운트 렌더·카드 라우팅(프리셋 전달) / 휴지통 복구·영구삭제·일괄 / 알림 목록·딥링크·빈/권한꺼짐/오프라인 상태 / 설정 시작화면 토글 저장 / 정보 모달 저장(검증 분기) / 필터 칩·우선순위.

## E-4. 에러 케이스 카탈로그 (사전 식별 — 각 항목은 테스트로 잠근다)

| # | 영역 | 에러/엣지 | 기대 처리 | 테스트 위치 |
|---|---|---|---|---|
| E1 | 휴지통 복구 | `429`(레이트·상한 초과) | 항목 유지+안내, 일괄은 실패분만 | 앱(api mock) |
| E2 | 휴지통 복구 | `409 CARRIER_UNSUPPORTED` | 항목 유지+딥링크 폴백 안내 | 앱 |
| E3 | 휴지통 복구 | 오프라인 `NETWORK` | 항목 유지+안내 | 앱 |
| E4 | 휴지통 | 같은 키 수동 재등록됨 | reconcile 로 휴지통서 제거 | 순수(reconcileTrash) |
| E5 | 휴지통 | 30일 경과·시계 변경 | `pruneTrash(now)` 영구삭제(로컬 시각 기준) | 순수 |
| E6 | 정보 | 손상 JSON / 비문자 레거시 | 빈/스킵 graceful | 순수(migrate·load) |
| E7 | 정보 | 금액 음수·소수·과대·빈 | 미저장+인라인 안내 | 순수(parseAmount) |
| E8 | 정보 | 카테고리 미설정·목록 외 값 | 미설정=칩 없음·레거시 표시 허용 | 순수 |
| E9 | 알림 | 딥링크 대상 정리됨(404/null) | "정리된 택배" 안내(목록 표시 유지) | 앱·순수(route) |
| E10 | 알림 | 토큰 양도(재설치) | device_id 키라 교차 누설 없음 | 워커 |
| E11 | 알림 | 첫 실행 `lastSeen` 없음 | `now` 초기화(미읽음 폭주 없음) | 순수 |
| E12 | 알림 | 로깅 INSERT 실패 | 발송·전환 영향 없음(best-effort) | 워커 |
| E13 | 대시보드 | 오프라인 | 캐시 목록 집계+신선도 | 앱 |
| E14 | 대시보드 | 다른 탭/기기 변경 | 포커스·새로고침 시 재집계 | 앱 |
| E15 | 필터 | hideCompleted + `완료` 칩 | 명시 칩 우선(완료 표시) | 순수(filter) |
| E16 | 필터 | 결과 0건 | 빈 목록과 구분 안내 | 순수+앱 |
| E17 | 라우팅 | 알림 콜드스타트 vs 시작화면 | 딥링크 최우선 | 순수(resolveInitialRoute) |
| E18 | 마이그레이션 | 신·구 키 동시/부분 실행 | 신 우선·구 정리·멱등 | 순수 |
| E19 | wipe | 신규 로컬 키 누락 | `wipeAllData` 가 trash·info·lastSeen·home·filter 전부 폐기 | 앱·순수 |
| E20 | 워커 | `GET /notifications` 구버전 서버 | 404 → 앱 빈 목록 graceful | 앱(api) |

## E-5. 외부 경계 실호출 스모크 (머지·배포 전 1회 — mock green ≠ 런타임)
- 실 송장 등록 → cron 폴링 → 전환 푸시 1회 수신 → **`GET /notifications` 에 그 알림이 기록**되는지 확인.
- 앱 업데이트 마이그레이션: 구 `unboxing.memos` 보유 상태에서 v1.1 첫 실행 → 메모가 `shipment_info` 로 보존되는지.
- **콜드스타트 딥링크(실기기)**: 앱 완전 종료 → 알림 탭 → 해당 상세로 진입(보강 ③·`getLastNotificationResponseAsync`).
- **햅틱(실기기)**: 카드 2단계 스와이프 시 진동 1회(시뮬레이터는 no-op).
- 체크리스트·과거 사례 → `docs/ENGINEERING.md` 외부 경계 검증.

## E-6. v1.1 Acceptance
- 위 E-1·E-2 케이스가 빨강→초록(test-first)으로 통과, `npm run verify` green.
- E-4 에러 카탈로그 전 항목이 대응 테스트로 잠김(누락 0).
- E-5 실호출 스모크 1회 통과(머지·배포 전).

---

# F. webhook-first 전환 TDD 테스트 계획 (ADR-028·029)

> webhook-first 전환(ADR-028 supersedes ADR-015)·콜백 인증(ADR-029)의 **구현 전 사전 테스트 설계**. E절과 동형 — 순수 로직 test-first(`now` 주입), 외부 의존(tracker.delivery webhook·track)은 **mock**. ⚠️ **mock green ≠ 런타임** — webhook 등록 API·콜백 수신·서명은 §F-4 실호출 스모크로 별도 확인(`docs/ENGINEERING.md` 외부 경계·"webhook 구현 함정"). 설계 출처: `ARCHITECTURE.md` "Webhook (1차 신선도)"·"cron 실행 모델"·"보안 § webhook 콜백", `ADR.md` ADR-028·029.

## F-1. 순수 로직 (필수·test-first) — worker/src/lib

### 등록·재등록·폴백 결정 (`now` 주입)
| 함수 | 케이스 |
|---|---|
| `shouldRegisterWebhook(stage, active, webhookExpiresAt)` | active·비종료·`미등록` 아님·(`webhook_expires_at` NULL 또는 임박) → true / 배송완료·미등록·이미 등록(여유) → false. 8단계 전수 |
| `webhookExpiration(now)` | `now+48h` ISO8601 **UTC**(`Z`) 포맷·경계 |
| `reregisterDue(webhookExpiresAt, now)` | 만료 임박(<24h)·active → 대상 / 여유·NULL·비active → 제외 |
| `fallbackInterval(stage, webhookExpiresAt)` | `webhook_expires_at` 있으면 ~12h, NULL이면 적응형(stage별 기존 `pollIntervalMs`) → `isDue` 가 소비(**단일 출처·드리프트 금지**) |

### 콜백 처리 순수부
| 함수 | 케이스 |
|---|---|
| `verifyCallbackSecret(got, expected)` | 일치 true / 불일치·빈값 false / **상수시간**(길이 다른 값도 안전) |
| `shouldRefetchOnCallback(lastPolledAt, now)` | 직전 폴링 <60s → false(skip) / 그 외 true. 동시·연속 콜백 dedupe |
| `parseCallback(body)` | `{carrierId, trackingNumber}` 정상 파싱 / 누락·손상 JSON·여분 필드 → 무시(null) |

### lifecycle 독립 sweep (폴링 분리 — 기존 `lifecycleAction` 재사용)
- 미등록7일·예외7일·분실30일 판정이 **폴링 호출과 무관하게** 순수 함수로 동일(분리해도 로직 불변, `now` 주입). **회귀 잠금(W11)**: 분리 후에도 판정 결과가 기존과 동일.

## F-2. 워커 통합 (권장) — `cloudflare:test` SELF·env·D1 (`registerTrackWebhook`·track mock)

| 대상 | 케이스 |
|---|---|
| 등록 @ `POST /shipments` | 비미등록·active → `registerTrackWebhook` 1회·`webhook_expires_at` set / 미등록 → 미호출 / 배송완료 → 미호출 / **dedupe-hit(기존 송장·expires_at 있음) → 미호출**(중복 없음) / 등록 mock 실패 → 송장 등록은 성공·`expires_at` NULL(폴백) |
| 폴링→webhook 승급 | 미등록 송장이 폴백 폴링서 첫 이벤트 감지 → `registerTrackWebhook` 호출·`expires_at` set |
| `POST /webhooks/track/<secret>` | 잘못된 시크릿 → `401`·무처리 / **D1 미존재·비active 번호 → `202`·track 미호출**(페이로드 불신) / 유효 active → track→CAS→푸시 / **중복 콜백(같은 단계) → CAS no-op·중복 푸시 0** / 직전 폴링 <60s → track skip / **track 실패 → `202` 반환**·다음 폴백 due에 흡수 |
| 재등록 sweep | 만료 임박 active만 `registerTrackWebhook` 재호출·`expires_at` 갱신 / 여유·비active 제외 / `now` 주입 |
| 조건부 폴백 due | webhook 송장(`expires_at` 있음)은 ~12h 전엔 due ❌ / NULL 송장은 적응형대로 due |
| 수명주기 슬롯 | DELETE(마지막 구독)·`active=0` → 재등록 sweep 제외(자연 만료) / (deregister API 있으면 호출 — 스모크 의존) |
| lifecycle 독립 sweep | 미등록7일·분실30일이 **재폴링 0인 webhook 송장에도** 적용(분리 sweep) → 비활성+알림 |
| subrequest 예산 | 재등록 우선·남는 예산으로 폴백·초과분 다음 fire 이월 |

## F-3. 에러 케이스 카탈로그 (webhook — 각 항목 테스트로 잠금)

| # | 영역 | 에러/엣지 | 기대 처리 | 위치 |
|---|---|---|---|---|
| W1 | 콜백 | 위조(임의 번호) | 페이로드 불신 → `202`·무처리(track ❌) | 워커 |
| W2 | 콜백 | 시크릿 불일치/누락 | `401` 조용히 | 워커·순수 |
| W3 | 등록 | 실패(네트워크·쿼터) | 송장 등록 성공·`expires_at` NULL·폴백 | 워커 |
| W4 | 등록 | 1000 동시 초과 | 등록 실패 → 폴백 흡수·확장 요청 로그 | 워커 |
| W5 | 콜백 | track 실패(202 후) | tracker 재시도 의존 ❌ → 다음 폴백 흡수 | 워커 |
| W6 | 콜백 | 동시·중복(같은 송장) | `last_polled_at` 선점 dedupe·CAS 멱등·푸시 0중복 | 워커 |
| W7 | 등록 | 미등록(이벤트 0) | 등록 보류 → 폴링이 첫 이벤트 후 승급 | 워커·스모크 |
| W8 | 보안 | 시크릿 회전 | 옛 URL 콜백 `401` → 재등록 sweep이 새 URL로 교체까지 폴백 | 순수+스모크 |
| W9 | 등록 | 재등록이 중복 생성? | 슬롯 2배·중복 콜백 위험 → **스모크로 갱신/중복 판정**(F-4) | 스모크 |
| W10 | cron | subrequest 예산 초과 | 재등록 우선·폴백 이월 | 워커 |
| W11 | lifecycle | 폴링 분리 누락 회귀 | webhook 송장 만료 누락 안 됨(분리 sweep로 잠금) | 워커·순수 |
| W12 | 콜백 | 배송완료 후 잔여 콜백 | `active=0` → 무시 | 워커 |

## F-4. 외부 경계 실호출 스모크 (머지·배포 전 1회 — mock green ≠ 런타임)
> **실행 결과(2026-06-26 운영 배포 후)** — 핵심 경계 green, 콜백 수신만 시간 의존(관찰 중). 상세 `docs/ENGINEERING.md` "스모크 확정 사실".
- ✅ **registerTrackWebhook 실호출**: `expirationTime` 48h **수락**·반환 `Boolean`. ⚠️ **실 스키마는 `input: RegisterTrackWebhookInput!` 래핑**(flat 인자는 `Unknown argument` → 등록 0·폴백에 가려짐) → `fix e8bcd1a`. cron 등록 sweep 으로 운영 `배송출발` 송장에 `webhook_expires_at`=now+48h set 확인(end-to-end).
- ✅ **미등록(이벤트 0) 번호 등록 가부**(W7): tracker 가 **받아줌**(`true`). 설계는 그대로 `미등록`엔 등록 안 함(슬롯 낭비 회피)이라 무관.
- ✅ **위조 콜백 차단**: 잘못된 시크릿 `401` · 유효 시크릿+미존재 번호 `202`(페이로드 불신·track 미호출) · 손상 본문 `202`.
- ✅ **fetch 바인딩(P-1·T1)**: `registerTrackWebhook` 실호출이 `Illegal invocation` 없이 성공(scheduled L843 `fetch.bind`).
- ✅ **deregister API**: **존재하지 않음**(`registerTrackWebhook(input)` 만 — unregister/list 없음). 슬롯 회수는 **48h 자연 만료**로만(설계대로). `최대 TTL`은 48h 수락 확인(상한값은 미탐색).
- ⚠️ **W9 재등록 멱등**: 목록/카운트 API 부재로 중복-vs-갱신 **API 검증 불가** → 설계의 `webhook_expires_at` 존재 시 재등록 skip 으로 방어, 슬롯 사용량 모니터링.
- ⏳ **실 콜백 수신**(미해소·관찰): 실 송장 상태 변화 시 `/webhooks/track/<secret>` POST 도착·페이로드 형태·**서명 헤더 유무**(수 시간~수일). 미수신/실패는 **폴백 폴링이 흡수**(머지 차단 아님).

## F-5. Acceptance
- F-1·F-2 케이스 빨강→초록(test-first), `npm run verify` green.
- F-3 W1~W12 전부 대응 테스트로 잠김(누락 0).
- F-4 실호출 스모크 1회 통과(머지·배포 전) — 특히 W9(재등록 멱등)·W7(미등록 등록 가부)·서명 유무.
