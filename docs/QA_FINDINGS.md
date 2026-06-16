# QA 발견 기록 (Findings) — 단일 출처

> `qa-mvp` phase가 MVP를 E2E로 QA하며 발견한 갭을 누적한다. 단위·통합 테스트(green)가 못 잡는
> 실제 사용자 여정의 결함을 기록만 한다. **이 phase는 발견·기록 전용 — 버그를 고치지 않는다**(find↔fix 분리).
>
> - 갭은 verify 를 빨갛게 만들지 않는다: 실패 단언 대신 `it.todo("QA-NNN: …")`/`.skip` + 이 표에 기록.
> - 사양 출처는 `docs/PRD.md`·`docs/ARCHITECTURE.md`·`docs/ADR.md` 의 해당 섹션을 가리킨다.
> - 심각도: **P0** 핵심 가치 차단 / **P1** 주요 기능 결함 / **P2** 부차 결함 / **P3** 사소·개선.

| ID | 심각도 | 영역 | 사양 출처 | 재현 | 현재 동작 | 기대(사양) | 제안 수정 | 이슈# |
|---|---|---|---|---|---|---|---|---|
| QA-001 | P0 | 등록/인증 | PRD 핵심 플로우 5 · NFR(권한 거부 graceful) | ① 푸시 권한 거부(토큰 없음) → `POST /devices` 가 유효 `push_token` 필수라 device 미등록 → ② `POST /shipments` 가 `SELECT 1 FROM devices` 실패로 `401`. 알림 없이 추적만 원하는 사용자가 등록 자체 불가. | 푸시 토큰이 없으면 기기 등록이 안 되고, 그 결과 운송장 등록이 `401` 데드락 | 푸시를 거부해도 운송장 등록·조회는 가능해야 한다(알림만 비활성) | device 등록을 `push_token` 없이 허용(토큰 nullable)하거나, 송장 등록 시 device 를 토큰 없이 자동 생성하는 익명 경로 | #3 |
| QA-002 | P2 | 등록/택배사 | PRD 핵심 플로우 4(미지원→딥링크) · ARCH 에러매트릭스(`409 CARRIER_UNSUPPORTED`) | device 등록 후 형식은 유효하나(`^[a-z]{2,}\.…`) tracker.delivery 미지원인 carrier(예 `kr.notreal`, 또는 `carrier.ts` 오추정 결과)로 `POST /shipments`. | 서버 `409` 는 `CARRIER_RE`(형식)만 검사 → 형식 유효 carrier 는 전부 `201` 수락. 미지원이어도 받아 영구 `미등록`(7일 후 비활성). 앱 `CARRIERS` 8종은 모두 형식 유효라 `409` 딥링크 폴백이 트리거되지 않음(`index.ts` `CARRIER_RE` 주석: "실제 지원목록 대조는 후속"). | 미지원 택배사는 `409 CARRIER_UNSUPPORTED` → 앱이 딥링크 안내(PRD 플로우4) | 서버가 tracker.delivery `carriers` 지원목록과 대조해 미지원이면 `409`(또는 앱이 등록 전 사전 차단·딥링크). | — |
| QA-003 | P3 | 등록/에러카피 | PRD 마이크로카피(에러코드 비노출·정확 안내) · 플로우5 | 푸시 거부(QA-001) 상태에서 등록 시도 → 서버 `401` → `register.tsx` `submit` 이 `401` 을 별도 분기 없이 `"generic"` 으로 매핑. | 영구 데드락(`401`)이 `"등록하지 못했어요. 잠시 후 다시 시도해 주세요"`(일시 오류 카피)로 표시 → 사용자는 원인(권한 거부) 모른 채 무한 재시도. | 영구 실패를 일시 오류처럼 오안내하지 않음(원인·해결 안내). | 1차로 QA-001 수정 시 `401` 자체가 사라짐(권장). 잔존 시 `submit` 에 `401` 분기 추가(권한/기기 안내). | (#3 연계) |
| QA-004 | P2 | 알림/조용시간 | PRD 알림 정책(조용시간 22:00–08:00 KST 보류 후 아침 묶음) · ADR-018(과알림 방지) | cron 폴링이 단계 전환을 감지하면 시각과 무관하게 즉시 `sendPush`. `cron.ts deliver`/`push.ts` 어디에도 KST 야간 판정·보류 큐·아침 묶음이 없다. | 야간(KST 22–08)에도 등록·집화·배송출발 등 모든 단계 전환 푸시를 즉시 발송 → 새벽 알림 발생 가능. | 야간에는 예외·배송완료 외 발송을 보류하고 아침에 묶어 전달. | `deliver` 전 KST 야간 판정 → 비긴급 단계는 보류 큐(D1)에 적재, 아침 첫 cron 에서 묶음 발송. *(PRD가 "권장"·"정확 시간 구현 시 확정" 표기 → Phase 1 의도적 보류 가능성 — 명시 정책이라 기록만)* | — |
| QA-005 | P3 | 알림/그룹화 | PRD UX(알림 그룹화·묶음/요약) · UI_GUIDE 알림 UI(여러 송장 묶음/요약) | `push.ts buildMessage`/`sendPush` 는 (token, shipment)별 개별 메시지를 만들고 묶음 키(collapse/thread)·요약 메시지가 없다. | 여러 송장이 동시에 전환되면 개별 푸시 N건 발송(그룹화·요약 없음) → 과알림. | 여러 송장 알림은 묶음/요약(과알림 방지, 조용시간과 결합). | Android collapseKey·요약 알림 또는 조용시간 묶음과 결합. *(앱측 "배송 상태" channel 분리는 Phase 1 앱 범위)* | — |
| QA-006 | P3 | 알림/마이크로카피 | PRD 마이크로카피(기술 용어 비노출) · 알림 정책 카피("{택배사} 접수 확인") | `cron.ts notifyTransition`→`push.ts buildMessage` title = `${carrier} · …${last4}`, carrier 는 tracker.delivery carrierId(예 `kr.cjlogistics`). E2E `tracking.test.ts` 가 title 에 `kr.cjlogistics` 노출 확인. | 푸시 title 에 택배사 id(`kr.cjlogistics`) 가 그대로 노출 — 친근한 한글 택배사명(예 "CJ대한통운") 아님. | 사용자 노출 문구는 친근한 한글 택배사명(기술 id 비노출). | carrierId→표시명 매핑(코드 상수 또는 `carriers` 캐시)으로 title 구성. 앱 carrier 메타와 단일 출처 공유 권장. | — |
| QA-007 | P2 | 수명주기/안내 | PRD 핵심 플로우6("7일 미수신 시 '번호 확인' 안내 후 비활성") · ARCH "데이터 수명주기 & 만료" 표("미등록 7일 / 예외 7일 → 자동 비활성 + 안내") | `lifecycle.ts lifecycleAction` 이 `미등록7일`·`예외7일` 에 `notify:false` 반환 → `cron.ts pollOne` 이 `active=0` 만 하고 푸시 없음. '번호 확인' 안내 메시지 경로(buildMessage 등)도 부재. E2E `lifecycle.test.ts` 가 비활성 후 `sendCalls=0`(추가 안내 없음) 확인. | 미등록7일·예외7일 송장이 **조용히** 비활성 — 오타/잘못된 번호 사용자가 원인·해결 안내를 못 받음. | 7일 비활성 시 "번호 확인" 안내 1회 발송(PRD 플로우6). | `lifecycle` 7일 규칙 `notify:true` + `cron` 에 안내용 buildMessage 경로 추가(또는 앱이 `active=0`+`미등록` 을 보고 인앱 안내). **단 ARCH 만료/좀비 요약줄은 7일에 "알림" 표기를 생략 → 사양 내부 불일치(의도적 Phase1 보류 가능성)도 함께 검토.** | — |
| QA-008 | P3 | 삭제/완전폐기 | ADR-017(`DELETE /me` "푸시 토큰 폐기") · ARCH "데이터 수명주기"(사용자 데이터 삭제) | 발송 후 ~15분 내 `DELETE /me` 호출 시. `index.ts handleDeleteMe` 는 `devices`(정규 push_token 저장소) 만 폐기하고 `push_tickets`(receipt 대기 버퍼)의 `push_token` 은 손대지 않는다. E2E `lifecycle.test.ts` 가 `DELETE /me` 후 `devices=0`·`push_tickets=1`(토큰 잔존) 확인. | "모든 데이터 삭제" 후에도 push_token 사본이 `push_tickets` 에 ~15분(다음 receipt sweep)까지 잔존 — 즉시 완전 폐기 아님. | `DELETE /me` 는 push_token 을 **즉시 완전 폐기**(ADR-017). | `handleDeleteMe` 에 `DELETE FROM push_tickets WHERE push_token = ?` 추가. (잔존 데이터는 ticket_id+token 뿐·비개인정보, sweep 으로 자동 정리되므로 영향 작음 → P3.) | — |

## 정적 감사 결과 (Step 3 — 개인정보 비영속·SQLi·로그 금지)

> CLAUDE.md CRITICAL 3종(개인정보 비영속·SQLi 방지·민감값 로그 금지)을 grep + E2E 로 감사. **결과: 위반 없음(CLEAN)** — 위반 발견 시 P0~P1 로 기록할 예정이었으나 현재 코드는 사양을 지킨다.

| 감사 | 방법 | 결과 | 근거 |
|---|---|---|---|
| **개인정보 비영속** (ADR-005/011 · CLAUDE.md CRITICAL) | `schema.sql`/`src/schema.ts` 컬럼 + `worker/src` 의 모든 `INSERT/UPDATE` grep + E2E DB 덤프 검사 | **CLEAN** | `shipments` 쓰기는 `last_normalized_status`·`last_polled_at`·`active`·`fail_count`·`next_retry_at` 뿐 — 수령인/`description`/`location` 컬럼 자체가 스키마에 없다. `description`·`location` 은 `index.ts handleGetShipment` 의 응답 `timeline`(실시간 조회, 미저장 ADR-011)·`tracker.ts` 데모 캔드값에만 등장. E2E `lifecycle.test.ts` 가 폴링 후 전 테이블 덤프에 주입한 수령인/위치 문자열이 **없음**을 런타임 재확인. |
| **SQLi 방지** | `worker/src` 의 `.prepare(` 36건 + SQL 내 `${}` 보간 라인 grep | **CLEAN** | SQL 문자열의 `${}` 는 ① 상수 컬럼 헬퍼 `shipmentCols()`(고정 식별자), ② `placeholders = ids.map(()=>"?").join(", ")`(값 아닌 `?` 목록) 뿐. 모든 **값**은 `.bind()` 로 바인딩(prepared). 사용자 입력 문자열 결합 SQL 없음. |
| **로그 금지** (ADR-007) | `worker/src`·`app/src` 의 `console.*` grep + 로깅 인자 검사 | **CLEAN** | worker `console` 은 `cron.ts:197 logPollError` 1곳(`{ carrier, failCount, error }` 만). `error` 메시지 출처(`tracker.ts` throw)는 "토큰 발급 실패"/"GraphQL 오류: {codes}"/"data 없음" 으로 tracking_no·token·secret 미포함. `device_id`·`push_token`·`tracking_no`·수령인 로깅 없음. `app/src` 는 `console.*` 0건. |
