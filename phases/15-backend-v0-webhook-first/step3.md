# Step 3: registration (통합 — webhook 등록 @ POST /shipments)

`registerTrackWebhook` 클라이언트를 추가하고, `POST /shipments` 등록 시 **비차단·실패허용**으로 webhook 을 등록한다.

## 읽어야 할 파일

- `/docs/QA.md` — **F-2 "등록 @ POST /shipments"** 표(비미등록·active→1회·set / 미등록·배송완료→미호출 / dedupe-hit→미호출 / mock 실패→송장은 성공·expires_at NULL), **F-3 W3·W4**
- `/docs/ADR.md` — ADR-028(등록 규칙·송장당 1개·dedupe 멱등·`ctx.waitUntil` 비차단·실패해도 등록 응답 성공)
- `/docs/ARCHITECTURE.md` — "Webhook (1차 신선도) §등록(2곳)·용량(1000 동시)", "POST /shipments" 흐름
- `/docs/ENGINEERING.md` — **함정 T1**(`registerTrackWebhook` 도 `deps.fetch` 주입 → `fetch.bind(globalThis)` 누락 시 `Illegal invocation`·폴백에 가려 안 보임), `docs/ENGINEERING.md` P-1
- `worker/src/tracker.ts` — `TrackerDeps {fetch, now, store, clientId, clientSecret, timeoutMs?}`, 기존 `track(...)`·GraphQL 호출 패턴(L263~), 토큰 store 사용법. **`registerTrackWebhook` 을 같은 패턴으로 추가**.
- `worker/src/tracker.test.ts` — mock fetch 테스트 스타일
- `worker/src/index.ts` — `handleCreateShipment`(L275~)·`tryTrack`(L198~)·디스패치(L631~ `/shipments` POST L648), `fetch.bind` 주입 뿌리(deps 생성부)
- `worker/src/lib/webhook.ts` — step1: `shouldRegisterWebhook`·`webhookExpiration`·`WEBHOOK_TTL_MS`
- step0: `shipments.webhook_expires_at`·`Env.WEBHOOK_CALLBACK_SECRET`

## 작업

### A. `worker/src/tracker.ts` — `registerTrackWebhook`

tracker.delivery GraphQL `Mutation.registerTrackWebhook(input)` 를 호출하는 함수 추가. 기존 `track` 과 동일한 deps·토큰·GraphQL 패턴:

```ts
export async function registerTrackWebhook(
  carrierId: string,
  trackingNumber: string,
  callbackUrl: string,
  expirationTime: string,   // ISO8601 UTC (webhookExpiration(now))
  deps: TrackerDeps,
): Promise<{ ok: boolean }>   // 반환 스키마는 실호출 스모크(step6 W9)로 확정 — 일단 성공/실패만
```
- **CRITICAL(T1·P-1)**: `deps.fetch` 를 쓰되, deps 를 만드는 **주입 뿌리에서 `fetch.bind(globalThis)`** 로 바인딩돼 있어야 한다(맨 `fetch` 주입 시 호출 때 `Illegal invocation`). `track` 이 쓰는 deps 와 같은 객체를 재사용하면 자동 충족 — 새 deps 를 만들지 말고 기존 경로 재사용.
- 실패(네트워크·쿼터·1000 초과)는 throw 하되 **호출부가 삼켜서** 송장 등록 응답을 막지 않는다(아래 B).

### B. `worker/src/index.ts` — `handleCreateShipment` 에 등록 배선

송장 생성 + 즉시 1회 track(기존) 직후:

1. `shouldRegisterWebhook(stage, active, existingWebhookExpiresAt, now)` 가 true 일 때만 등록.
   - **dedupe-hit/멱등**: 이미 같은 송장 행이 있고 `webhook_expires_at` 이 여유면 **재등록하지 않는다**(F-2 dedupe-hit→미호출).
   - **미등록(이벤트 0)·배송완료**: 등록하지 않는다(폴링 승급은 step5).
2. `callbackUrl = \`${origin}/webhooks/track/${env.WEBHOOK_CALLBACK_SECRET}\`` — `origin` 은 요청 URL 기준(또는 설정값). 시크릿 경로(ADR-029 ①).
3. `ctx.waitUntil(registerTrackWebhook(...).then(성공 시 UPDATE shipments SET webhook_expires_at=?).catch(삼킴·로그))` — **비차단**. `expirationTime = webhookExpiration(now)`.
   - **등록 성공** → `webhook_expires_at` set. **실패** → `webhook_expires_at` NULL 유지 → 폴백 폴링이 적응형 간격으로 자동 커버(W3·W4).
4. **`ctx` 전달**: `handleCreateShipment` 가 현재 `ctx`(ExecutionContext)를 받지 않으면, fetch 핸들러에서 `ctx` 를 인자로 넘기도록 시그니처를 확장하라(`waitUntil` 필요). 디스패치(L648)도 같이 수정.

### C. 테스트 (F-2 통합 — `cloudflare:test` SELF·env·D1, `registerTrackWebhook` mock)

- 비미등록·active → `registerTrackWebhook` **1회**·`webhook_expires_at` set
- 미등록 단계 → 미호출 / 배송완료 → 미호출
- dedupe-hit(기존 송장·expires_at 있음) → **미호출**(중복 없음)
- 등록 mock 실패 → **송장 등록은 200 성공**·`webhook_expires_at` NULL(폴백)

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. AC 실행.
2. 체크리스트:
   - `registerTrackWebhook` 이 **기존 deps(fetch.bind 된)** 를 재사용하는가(T1·P-1)? 새 deps 를 맨 `fetch` 로 만들지 않았는가?
   - 등록 실패가 **송장 등록 응답을 막지 않는가**(비차단·삼킴, W3)?
   - dedupe(송장당 1개·멱등)가 지켜지는가?
   - CLAUDE.md(비영속·무료티어) 위반 없는가?
3. `phases/15-backend-v0-webhook-first/index.json` step3 업데이트.

## 금지사항

- `registerTrackWebhook` 에 **맨 `fetch`** 를 주입하지 마라. 이유: `Illegal invocation`(T1·P-1) — mock 테스트는 못 잡고 런타임에서만 깨지며 폴백에 가려진다.
- 등록을 **동기(await) 로 응답 경로에 넣지 마라**. 이유: 등록 실패/지연이 사용자 등록 응답을 막으면 안 됨(ADR-028 비차단). `ctx.waitUntil`.
- 미등록(이벤트 0) 송장을 등록하지 마라. 이유: tracker 가 모르는 번호는 안 받을 수 있음(T5) — 폴링 승급(step5)이 정답.
- 콜백 수신 엔드포인트·cron sweep 을 여기서 만들지 마라(step4·5 소관).
- 기존 테스트를 깨뜨리지 마라.
