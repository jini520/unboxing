# Step 1: decision-logic (순수 로직 · test-first)

webhook 등록 여부·재등록·**조건부 폴백 간격**을 결정하는 순수 함수를 **test-first** 로 만든다. 외부 의존 없음, 시간은 `now` 주입.

## 읽어야 할 파일

- `/docs/QA.md` — **F-1 "등록·재등록·폴백 결정"** 표(함수 시그니처·케이스). 이 step 은 그 표를 빨강→초록으로 구현한다.
- `/docs/ADR.md` — ADR-028(등록 2곳·송장당 1개·dedupe 멱등·**조건부 폴백 cadence**: 등록분 ~12h / NULL 적응형)
- `/docs/ARCHITECTURE.md` — "Webhook (1차 신선도)" 등록 규칙, "cron 실행 모델 §조건부 폴백 cadence"
- `worker/src/lib/polling.ts` — `Stage` 타입(8단계: 미등록·등록·집화·이동중·배송출발·배송완료·예외·기타), `pollIntervalMs(stage)`(배송완료=null), `isDue(stage, lastPolledAt, now)`
- `worker/src/lib/polling.test.ts` — 기존 테스트 스타일(참고)
- `worker/src/lib/lifecycle.ts` — `now` 주입·순수 패턴 참고
- step0 산출물: `shipments.webhook_expires_at`(nullable epoch ms)

## 작업

### A. 신규 `worker/src/lib/webhook.ts` + `webhook.test.ts` (test-first)

먼저 `webhook.test.ts` 에 QA F-1 케이스를 작성(빨강) → 구현(초록). 공유 상수를 한 곳에 두어 **드리프트 금지**:

```ts
export const WEBHOOK_TTL_MS = 48 * 60 * 60 * 1000;          // 등록 시 만료를 now+48h 로
export const REREGISTER_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 만료 24h 이내면 재등록 임박
export const WEBHOOK_FALLBACK_MS = 12 * 60 * 60 * 1000;     // 등록분 폴백 안전망 ~12h
```

함수(시그니처 — 내부 구현은 재량, 단 케이스/규칙은 박아라):

- `shouldRegisterWebhook(stage: Stage, active: boolean, webhookExpiresAt: number | null, now: number): boolean`
  - **true**: `active` && 등록 가능 단계 && (`webhookExpiresAt === null` 또는 만료 임박(`webhookExpiresAt - now < REREGISTER_THRESHOLD_MS`)).
  - **등록 가능 단계** = `pollIntervalMs(stage) !== null`(=배송완료 제외) **그리고** `stage !== "미등록"`. 즉 등록·집화·이동중·배송출발·예외·기타 → 가능, **배송완료(종료)·미등록(이벤트 0)·비active → false**.
  - 8단계 × (active/비active) × (NULL/여유/임박) 전수 테스트.
- `webhookExpiration(now: number): string`
  - `now + WEBHOOK_TTL_MS` 를 **ISO8601 UTC**(끝이 `Z`) 로. 포맷·경계값 테스트.
- `reregisterDue(webhookExpiresAt: number | null, now: number): boolean`
  - `webhookExpiresAt !== null` && `webhookExpiresAt - now < REREGISTER_THRESHOLD_MS` → true. NULL·여유 → false. (active 필터는 step5 쿼리 소관.)
- `fallbackInterval(stage: Stage, webhookExpiresAt: number | null): number | null`
  - `pollIntervalMs(stage) === null`(배송완료) → **null**(폴링 안 함, webhook 무관).
  - `webhookExpiresAt !== null`(등록됨) → **`WEBHOOK_FALLBACK_MS`**(~12h 안전망).
  - `webhookExpiresAt === null`(미등록) → `pollIntervalMs(stage)`(기존 적응형).

### B. `isDue` 를 조건부 폴백으로 확장 (하위호환 — 기존 테스트 green 유지)

`worker/src/lib/polling.ts` 의 `isDue` 가 `fallbackInterval` 을 **단일 출처**로 소비하게 한다. **선택 인자**로 추가해 기존 호출부를 깨지 않는다:

```ts
export function isDue(stage: Stage, lastPolledAt: number | null, now: number, webhookExpiresAt: number | null = null): boolean
```
- 내부에서 `pollIntervalMs(stage)` 대신 `fallbackInterval(stage, webhookExpiresAt)` 사용. 기본값 `null` 이면 동작 불변(기존 polling.test.ts green).
- `fallbackInterval` 을 `webhook.ts` 에 두면 `polling.ts` → `webhook.ts` import. 순환 import 가 생기면(`fallbackInterval` 이 `pollIntervalMs` 를 쓰므로 `webhook.ts`→`polling.ts` 단방향이면 OK) `fallbackInterval` 만 `polling.ts` 에 두고 webhook.ts 가 re-export 해도 된다 — **단일 출처 원칙만 지켜라**(간격 상수가 두 곳에 갈리면 안 됨).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. AC 실행. **새 테스트가 먼저 빨강이었다가 구현 후 초록**인지(test-first) 확인.
2. 체크리스트:
   - QA F-1 의 4개 등록/폴백 함수가 전부 테스트로 잠겼는가(8단계 전수 포함)?
   - 간격·임계 상수가 **단일 출처**인가(폴링/webhook 두 곳에 중복 정의 ❌)?
   - 기존 `polling.test.ts` 가 그대로 green 인가(하위호환)?
3. `phases/15-backend-v0-webhook-first/index.json` 의 step1 업데이트(성공 시 `summary` 에 추가 함수·파일).

## 금지사항

- 외부 호출(`fetch`·`registerTrackWebhook`)·D1·`ctx.waitUntil` 을 이 step 에서 쓰지 마라. 이유: 여기는 **순수 로직**만(통합은 step3~5). 시간은 `now` 인자.
- `isDue` 의 기존 시그니처를 **깨는 변경**(필수 인자 추가)을 하지 마라. 이유: cron 등 기존 호출부가 컴파일/테스트 실패(step5 전까지 green 유지 불가). 반드시 **선택 인자(기본 null)**.
- 폴링 간격을 webhook.ts 에 **재정의(하드코딩 복제)** 하지 마라. 이유: `pollIntervalMs` 와 드리프트 → due 판정 불일치.
- 기존 테스트를 깨뜨리지 마라.
