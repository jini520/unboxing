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
