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
| QA-011 | P1 | 스토어/신고 | PRD Apple App Privacy(Nutrition Labels) · Google Data Safety form · 한국 PIPA(제3자·국외이전 고지) | 수집(운송장·푸시토큰)·제3자 제공(tracker.delivery 로 운송장 전송)·국외이전(Cloudflare) 신고 **초안이 repo 어디에도 문서화돼 있지 않음**(스토어 콘솔 입력 항목). | App Privacy / Data Safety 신고 내용이 정리돼 있지 않아 제출 시 즉석 작성 → 누락·오신고 위험(특히 제3자 SDK 포함 의무). | 신고 항목 초안(수집·공유·국외이전·삭제 메커니즘)을 사전 문서화해 제출 시 그대로 입력. **제출 필수 양식**. | QA_TESTPLAN 제출 체크리스트에 신고 초안 정리(아래 step5 추가분). 실제 신고는 콘솔에서 사람이 수행. | #14 (step5: `docs/STORE_PRIVACY_FILING.md` 신고 초안 작성 — repo 산출물 완료, **콘솔 제출 잔여**) |
| QA-012 | P2 | 스토어/Privacy Manifest | PRD Apple Privacy Manifest(`PrivacyInfo.xcprivacy`)·required-reason API · 클립보드 사유 문자열 | `app.json` 에 `ios.privacyManifests`·`ios.infoPlist`(클립보드 사용 사유 등) 설정이 **없음**. Expo 의존성(expo-clipboard·async-storage·expo-application 등)은 각자 `PrivacyInfo.xcprivacy` 를 갖지만, 앱 레벨 매니페스트 병합·required-reason(예 UserDefaults) 신고와 클립보드 read 사유는 미확인. | 앱 레벨 Privacy Manifest/required-reason 신고가 명시되지 않음 — 제출 시 누락 시 거절·경고 가능. | Privacy Manifest + required-reason 코드 신고(클립보드 등)를 빌드 산출물에 포함·검증. | `expo prebuild` 산출 `PrivacyInfo.xcprivacy` 확인 + 필요한 required-reason(`NSPrivacyAccessedAPICategory…`) 선언, 클립보드 사유 문자열(`app.json ios.infoPlist`) 추가 검토. iOS 빌드 시점 검증. | #15 ✅ (step5: `app.json ios.privacyManifests` UserDefaults `CA92.1`·FileTimestamp `C617.1` 선언 + `app-config.test.ts` sanity. 클립보드는 iOS에 Info.plist 키·required-reason 없음 → 미추가, `STORE_PRIVACY_FILING.md` §3-A 기록. 정식 검증은 iOS 빌드) |

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
| **App Privacy / Data Safety 신고** | **부분 → QA-011 (P1)** | step5: `docs/STORE_PRIVACY_FILING.md`(데이터 인벤토리·Apple App Privacy·Google Data Safety·PIPA 국외이전 초안) 작성. **repo 산출물 완료 / 콘솔 제출 잔여**(#14). |
| **Privacy Manifest / required-reason** | **PRESENT → QA-012 (P2) ✅** | step5: `app.json ios.privacyManifests` 선언(UserDefaults `CA92.1`·FileTimestamp `C617.1`, `NSPrivacyTracking:false`) + `app-config.test.ts` JSON sanity. 클립보드는 iOS에 해당 Info.plist 키·required-reason 카테고리 없음 → 미추가(근거 `STORE_PRIVACY_FILING.md` §3-A). **정식 검증은 iOS 빌드(`expo prebuild`)** (#15). |
