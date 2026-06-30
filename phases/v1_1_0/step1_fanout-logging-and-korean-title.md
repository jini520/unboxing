# Step 1: fanout-logging-and-korean-title — 전환 푸시 fan-out 시 알림 1행 기록 + 푸시 title 한글명(#9)

cron 이 단계 전환을 감지해 푸시를 발송할 때, **실제 발송되는 메시지마다 `notifications` 1행을 기록**한다(ADR-023·보강②). 동시에 푸시 알림의 **title 에 택배사 한글명**을 표기한다(이슈 #9 — 현재 carrierId 가 그대로 노출됨). 기록은 부수효과라 **best-effort**(실패가 발송·전환을 막지 않음)로 격리한다.

## 읽어야 할 파일

먼저 아래를 읽고 전환 CAS·fan-out·푸시 구성·멱등 보장을 파악하라:

- `/docs/ARCHITECTURE.md` — "알림 기록 write 지점"(fan-out 1회·음소거 제외·flush 별개), "v1.1 설계 보강 ②"(로깅 시점·멱등·best-effort), "데이터 모델" `notifications`, "상태 정규화 & 알림"(전환 CAS)
- `/docs/ADR.md` — ADR-020(음소거 per-subscription — 발송 제외 → 기록도 없음), ADR-023(알림 기록), 이슈 `#9`(푸시 title carrierId→한글명)
- `/docs/QA.md` — "E-2 워커 통합" 알림 로깅 행, "E-4" E12(로깅 INSERT 실패 best-effort)
- `worker/src/cron.ts` — `pollOne`, `casStage`/배송완료 CAS(전환 차지 지점), 전환 후 발송 트리거
- `worker/src/lib/notify.ts` — fan-out(`subscriberTokens` = `subscriptions`⋈`devices`, 음소거 제외), 메시지 구성
- `worker/src/push.ts` — `buildMessage`(title/body 소스: carrier·last4·stage·body), Expo Push 발송·재시도
- `app/src/lib/carrier.ts` — `carrierName(carrierId)` 한글 map(서버에 미러할 대상)
- **이전 step 산출물**: `worker/schema.sql`·`worker/src/schema.ts` 의 `notifications`, `index.ts` 의 `NotificationRow`

## 작업

### 1. fan-out 시 `notifications` INSERT (notify.ts)
- **전환 CAS 승리 후** fan-out 에서 **실제 발송되는 (device_id, shipment) 메시지별로 1행 INSERT**:
  - `id` = UUID(`crypto.randomUUID()`), `device_id` = 그 구독의 device, `shipment_id` = 송장 id,
  - `carrier` = **carrierId 원문**, `last4` = 운송장 끝4자리, `body`·`stage` = `buildMessage` 와 동일 소스, `sent_at` = 주입된 `now`(deps).
- fan-out 은 `subscriptions`(device_id)⋈`devices`(token) 를 돌므로 device_id 를 바로 안다. **음소거(ADR-020) 구독은 fan-out 에서 이미 빠지므로 기록도 안 생긴다**(일관).

### 2. 멱등 — fan-out 시점 1회 (재로깅 금지)
- 로깅 단위 = **메시지 구성(fan-out) 시점 1회**. 전환 CAS 가 전환당 fan-out 1회를 보장하므로 **재독·중복 cron 에도 중복 로깅이 없다**.
- **send HTTP 재시도(MessageRateExceeded 등) 루프에서 재로깅하지 마라** — 로깅은 send 재시도와 분리(구성 시점 1회). (최종 전달 실패분도 "발송 시도"로 1행 기록될 수 있음 — 드물고 무해, 단순성 우선.)

### 3. best-effort 격리
- `notifications` INSERT 실패는 **푸시 발송·전환 CAS 를 막지 않는다**. try/catch 로 삼키고 `ctx.waitUntil` 로 푸시 경로에 비동기로 묶는다(로깅 실패로 알림이 안 가면 더 나쁨).

### 4. 푸시 title 한글명 (#9) — `buildMessage`(push.ts)
- 푸시 알림 **title** 의 택배사 id(`kr.cjlogistics` 등)를 **한글 표시명**으로 변환한다.
- 서버에 carrierId→한글 표시명 map 을 둔다 — `app/src/lib/carrier.ts` 의 `carrierName` 을 **미러**(worker 측 작은 모듈, 예: `worker/src/lib/carrier.ts`). 미상 id 는 **원문 폴백**.
- **단, `notifications.carrier` 에는 carrierId 를 저장**한다(한글 변환은 알림 화면=앱 책임). title 표시만 한글.

## 테스트 (TDD)
- 워커 통합(`cloudflare:test` env·D1, `now` 주입):
  - 전환 CAS 승리 → 그 송장 **구독 device 별 `notifications` 1행**(컬럼 값 검증).
  - **음소거 구독 제외**(fan-out 에서 빠짐 → 기록도 없음).
  - **재독(전환 없음) → 무기록**(CAS 차지 못함).
  - **send 재시도 → 중복 행 없음**(fan-out 시점 1회).
  - **다중 구독** → device 별 1행씩.
  - **best-effort(E12)**: INSERT 를 강제 실패시켜도(주입 실패 시뮬) 푸시 발송 호출·전환 CAS 는 그대로 진행.
- 푸시 단위(push.ts): `buildMessage` title 에 **carrierId→한글명**(예 `kr.cjlogistics`→"CJ대한통운"), 미상 id 는 원문.

## Acceptance Criteria
```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차
1. 위 AC 실행.
2. 체크리스트: fan-out 시점 1회 로깅 / 음소거 제외 / 재독 무기록 / best-effort 격리 / title 한글명 + `notifications.carrier` 는 carrierId / ADR 스택·CLAUDE.md CRITICAL(fetch.bind·비영속·$0) 위반 없음 / 기존 테스트 무파손.
   - **주의(CLAUDE.md P-1)**: 전역 `fetch` 를 deps/옵션으로 주입한다면 반드시 `fetch.bind(globalThis)` — 맨 `fetch` 주입은 런타임에 "Illegal invocation" throw(mock 테스트는 못 잡음).
3. `phases/07-backend-v0-v11-notifications/index.json` step 1 업데이트(성공→completed+summary / 3회 실패→error / 외부개입→blocked).

## 금지사항
- send 재시도 루프 안에서 로깅하지 마라. 이유: 한 발송이 여러 행으로 중복 기록된다(멱등 = fan-out 1회).
- 로깅 실패가 푸시 발송·전환 CAS 를 막게 하지 마라. 이유: 부수효과(기록)가 본질(알림 전달·멱등)을 깨뜨리면 안 된다(best-effort).
- 음소거된 구독을 기록하지 마라. 이유: 발송에서 제외된 알림은 기록에도 없어야 일관(ADR-020).
- `notifications.carrier` 에 한글명을 저장하지 마라. 이유: 서버=carrierId, 앱이 변환(이슈 #9 원칙). title 표시만 한글.
- 기존 테스트를 깨뜨리지 마라.
