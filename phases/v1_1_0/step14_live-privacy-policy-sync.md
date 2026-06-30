# Step 14: live-privacy-policy-sync — 라이브 개인정보처리방침을 실제 동작·v1.1에 동기화

출시된 공개 개인정보처리방침(라이브 `app/src/content/privacyPolicy.ts`)이 **실제 동작과 어긋나 있다** — §6 보유/파기에 "배송완료 감지 시 즉시 삭제"라고 적혀 있으나, ADR-005 개정으로 실제 동작은 **배송완료 시 보관(active=0)·사용자 수동 삭제**다. 설계 SoT(`docs/PRIVACY_POLICY.md §6`)는 이미 "보관"으로 정정됐고, 라이브 번들만 뒤처져 있다. 출시된 공개 방침이 실제와 다르면 정확성·컴플라이언스 리스크라 v1.1 동기화의 **명시 작업**으로 둔다. 동시에 v1.1 서버 신규 저장인 **발송 알림 기록(`notifications`)** 을 수집 항목에 반영한다(택배사·끝4자리·상태·발송시각 — 수령인/메모 없는 비-PII).

이 step은 **앱 콘텐츠 1파일 정정 + 문서 한 줄 보강**만 harness로 다룬다. 아래 두 가지는 **머지·배포 시 수동 후속**(harness 범위 밖 — 본 step 작업 아님):
- **E-5 외부 경계 실호출 스모크**(머지·배포 전 1회): 실 송장 등록 → cron 폴링 → 전환 푸시 1회 수신 → `GET /notifications` 에 그 알림 기록 확인 / 구 `unboxing.memos` 보유 상태에서 v1.1 첫 실행 → `shipment_info` 보존 / 콜드스타트 알림 딥링크(실기기) / 카드 2단계 스와이프 햅틱(실기기). 상세 → `docs/QA.md` E-5.
- **App Store / Play Console App Privacy·Data Safety 신고 갱신**(`notifications` 반영) — 외부 콘솔 작업. 초안·표 → `docs/QA.md` D절, 진행 추적 → `docs/ROADMAP.md`.

## 읽어야 할 파일

먼저 아래를 읽고 "설계 SoT(정정 완료) ↔ 라이브(뒤처짐)"의 차이와 v1.1 데이터 영향을 파악하라:

- `/docs/PRD.md` — "v1.1 … 데이터·프라이버시 영향(스토어 신고 갱신)" 절(특히 **"라이브 방침 정정(선행 필수)"** 항목). 무엇을 어떻게 정정해야 하는지의 출처.
- `/docs/PRIVACY_POLICY.md` — **§6 보유 기간 및 파기**(설계 SoT — **이미 "보관"으로 정정됨**). 라이브를 이 문구에 맞춘다. §1·§2 수집/미수집도 v1.1 반영 여부 확인.
- `/docs/ADR.md` — **ADR-005**(배송완료 시 **보관**·자동삭제 폐기·수동 삭제), **ADR-023**(발송 알림 기록 `notifications` — 서버 비영속 상태 로그, 보존 90일·디바이스당 상한·`DELETE /me` 시 폐기·수령인 없음).
- `/docs/QA.md` — **D절** App Privacy / Data Safety 표의 `notifications` 행(택배사·끝4자리·상태·발송시각, 보존/폐기 조건). 라이브 방침 문구가 이 신고와 일관되도록 한다.
- `app/src/content/privacyPolicy.ts` — **정정 대상(라이브)**. §6 본문에 "배송완료 감지 시: 해당 운송장 기록을 즉시 삭제합니다." 가 남아 있음(드리프트). 파일 상단 주석: SoT 는 `docs/PRIVACY_POLICY.md`, 본 파일은 그 내용을 모바일 가독 형태로 옮긴 것(**의미 동일**·드리프트 금지).
- `/docs/ENGINEERING.md` — B절(D1 마이그레이션 절차). v1.1 적용/확인 절차 보강 위치.

## 작업

### 1. 라이브 §6 정정 — "즉시 삭제" → "보관" (`app/src/content/privacyPolicy.ts`)
- `sections` 의 "6. 보유 기간 및 파기" 본문에서 **"· 배송완료 감지 시: 해당 운송장 기록을 즉시 삭제합니다."** 줄을 **ADR-005 개정에 맞게** 고친다:
  - 의미: 배송완료를 감지하면 **목록에서 자동 삭제하지 않고 보관(active=0)** 하며, 사용자가 원할 때 **직접 삭제**한다(설정의 "모든 데이터 삭제" 또는 항목 삭제).
  - 문구는 `docs/PRIVACY_POLICY.md §6` 의 표현과 **일치**시킨다(SoT 가 정본 — 라이브가 SoT 를 따라간다).
- §6 의 다른 줄(미등록 7일/예외 7일 자동 비활성, 등록 30일 강제 비활성, 사용자 요청 삭제, 비영속)은 SoT 와 어긋나지 않으면 보존한다.

### 2. v1.1 서버 신규 저장(`notifications`) 반영 (같은 파일)
- §1(수집하는 정보) 또는 §6 에 **발송한 배송 알림 기록(`notifications`)** 을 `docs/PRIVACY_POLICY.md`·`docs/QA.md D절` 과 일관되게 추가한다:
  - 항목: **택배사·운송장 끝 4자리·정규화된 상태 문구·발송 시각**. **수령인·메모·금액 등은 포함하지 않음(비-PII)**.
  - 보존/파기: **최대 90일**(또는 디바이스당 상한) 후 자동 삭제, `DELETE /me`("모든 데이터 삭제") 시 즉시 폐기, 운송장 삭제와 독립(딥링크만 무효).
- **로컬 전용(서버 미전송)** 데이터 — 메모·카테고리·금액, 휴지통 스냅샷, 알림 읽음 상태, 시작 화면·필터 설정 — 은 서버 수집 항목이 **아님**을 명시(§2 또는 §6). "모든 데이터 삭제"가 **서버 `notifications` + 모든 로컬 스토어**까지 폐기함을 §6/§7 에 반영.
- `lastUpdated`·`effectiveDate` 는 `docs/PRIVACY_POLICY.md` 의 최종 수정일과 **일치**시킨다(SoT 가 갱신돼 있으면 그 날짜로, 아니면 SoT 와 함께 맞춘다).

### 3. ENGINEERING B절 v1.1 절차 보강 (없으면 한 줄)
- `/docs/ENGINEERING.md` B절(D1 마이그레이션)에 v1.1 적용/확인 절차가 없으면 추가:
  - 원격 D1: `notifications` 테이블은 `schema.sql` 재실행으로 자동 생성(`CREATE TABLE/INDEX IF NOT EXISTS`) — `PRAGMA table_info(notifications)` 로 확인.
  - 앱: 구 `unboxing.memos` → `unboxing.shipment_info` 마이그레이션이 v1.1 첫 실행에서 1회·멱등 수행됨을 확인(E-5 스모크 항목).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다(앱 콘텐츠 변경이므로 typecheck·기존 테스트가 깨지지 않아야 한다).
2. 체크리스트:
   - `app/src/content/privacyPolicy.ts` §6 ↔ `docs/PRIVACY_POLICY.md §6` **문구 일치**(보관·수동 삭제).
   - 라이브에 **"즉시 삭제"(배송완료 자동 삭제) 문구 잔존 0**.
   - `notifications` 수집 항목(택배사·끝4자리·상태·발송시각·90일·DELETE me 폐기·수령인 없음)이 `docs/QA.md D절`·`docs/PRIVACY_POLICY.md` 와 일관되게 명시됨.
   - 로컬 전용 데이터(메모·카테고리·금액·휴지통·읽음·설정)는 서버 수집 항목이 아님이 명시됨.
   - `lastUpdated`/`effectiveDate` 가 SoT 와 일치.
   - 기존 테스트 무파손.
3. `phases/10-qa-v0-v11-release/index.json` 의 step 0 을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`(예: "라이브 방침 §6 즉시삭제→보관 정정 + notifications 수집 항목 반영, SoT 일치").
   - 수정 3회 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`.
   - 외부 개입 필요(콘솔 신고 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단.

## 금지사항

- `docs/PRIVACY_POLICY.md`(SoT)를 **다시 정정하지 마라**. 이유: SoT 는 이미 "보관"으로 확정됐고 뒤처진 것은 **라이브 `privacyPolicy.ts`** 뿐이다 — 라이브만 SoT 에 맞춘다(반대 방향 동기화는 정본을 훼손).
- **실제 동작과 다른 문구를 쓰지 마라**. 이유: 공개 방침이 실제와 다르면 정확성·컴플라이언스 리스크다 — 보관/보존 기간/폐기 조건은 ADR-005·ADR-023·QA D절과 정확히 일치해야 한다.
- 수령인 이름·주소·연락처를 **수집/저장 항목으로 적지 마라**. 이유: 비영속 원칙(ADR-005)상 서버에 저장하지 않으며, `notifications` 도 수령인을 포함하지 않는다(끝 4자리·상태만).
- 인앱 화면 렌더에 **마크다운 라이브러리를 도입하지 마라**. 이유: `privacyPolicy.ts` 는 구조화 데이터 + `Text` 컴포넌트로만 렌더하는 설계다(파일 상단 주석 — 과의존 금지).
- 본 step에서 **E-5 실호출 스모크·콘솔 신고를 "완료"로 표시하지 마라**. 이유: 둘은 머지·배포 시 수동 후속이라 harness step 산출물이 아니다(도입부 명시).
- 기존 테스트를 깨뜨리지 마라.
