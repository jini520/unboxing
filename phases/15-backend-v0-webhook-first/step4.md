# Step 4: callback-endpoint (통합 — POST /webhooks/track/<secret>)

tracker.delivery 콜백 수신 엔드포인트를 추가한다. **1초 내 202**, 재조회는 `ctx.waitUntil` 비동기, 폴링과 **동일한 정규화·CAS·푸시 다운스트림 재사용**.

## 읽어야 할 파일

- `/docs/QA.md` — **F-2 "POST /webhooks/track/<secret>"** 표, **F-3 W1·W2·W5·W6·W12**
- `/docs/ADR.md` — **ADR-029**(응답 모델: 시크릿 불일치 `401`·미존재/비active `202`(무시)·수락 `202`+`waitUntil`; 페이로드 불신; 신선도 throttle)·ADR-028(콜백 다운스트림 재사용)·ADR-012(`last_polled_at` 선점)
- `/docs/ARCHITECTURE.md` — "Webhook §수신·콜백 보안", "POST /webhooks/track/<secret>" API 행
- `/docs/ENGINEERING.md` — 함정 **T6**(시크릿 엣지 로그→페이로드 불신이 실질 1차 방어)
- `worker/src/lib/webhook.ts` — step2: `verifyCallbackSecret`·`shouldRefetchOnCallback`·`parseCallback`
- `worker/src/index.ts` — 디스패치(L631~)·`requireDeviceId`(L92)·`tryTrack`(L198)·`enforceIpRateLimit`(L132)·에러 응답 패턴
- `worker/src/cron.ts` — `pollOne`(L146)·`casStage`(L255)·`subscribers`/`fanOut`/`notifyTransition`(다운스트림: track→정규화→CAS→푸시). **콜백이 이 다운스트림을 재사용**한다.
- step0: `Env.WEBHOOK_CALLBACK_SECRET`·`WEBHOOK_SIGNING_SECRET?`

## 작업

### A. 라우트 추가 — `worker/src/index.ts`

`POST /webhooks/track/<secret>` (예: `pathname.startsWith("/webhooks/track/")` + 마지막 세그먼트=secret, method POST):

1. **인증 라우트보다 먼저** 배치 — `requireDeviceId`(Bearer) 를 거치지 않는다. 콜백엔 device 토큰이 없다; 게이트는 **시크릿 경로**다.
2. **동기 게이트(빠른 처리)**:
   - `verifyCallbackSecret(segment, env.WEBHOOK_CALLBACK_SECRET)` false → **`401`**(조용히, 본문 최소). 로그에 시크릿/URL 남기지 마라.
   - `parseCallback(body)` null → **`202`**(무시).
   - D1 에서 `(carrier=carrierId, tracking_no=trackingNumber)` **active=1** 송장 조회 → 없거나 비active → **`202`**(무시, **페이로드 불신**·W1·W12). track 호출하지 않는다.
   - `shouldRefetchOnCallback(last_polled_at, now)` false(직전 폴링 <60s) → **`202`**(skip·W6).
3. **수락**: `last_polled_at` 선점 갱신(ADR-012·동시 콜백 dedupe) 후 `ctx.waitUntil(재조회 다운스트림)` → **`202`** 즉시 반환.
4. (선택) `env.WEBHOOK_SIGNING_SECRET` 가 있고 서명 헤더가 오면 HMAC 검증 추가(ADR-029 ① — tracker 제공 시. 미제공이면 생략).

### B. 다운스트림 재사용 (복제 금지)

콜백의 `waitUntil` 안에서 하는 일 = **`pollOne` 의 track→정규화→CAS→푸시와 동일**. `cron.ts` 의 해당 처리를 **재사용 가능한 함수로 추출**해 콜백과 cron 양쪽에서 호출하라(예: `processShipmentUpdate(env, deps, row)`). 푸시/CAS/`shouldNotify` 로직을 **복제하지 마라**.
- **CAS 멱등**: 중복 콜백(같은 단계) → `casStage` no-op → **중복 푸시 0**(W6).
- **track 실패는 `202` 이후** → tracker 재시도에 의존하지 않고 다음 폴백 due 가 흡수(W5).

### C. 테스트 (F-2·F-3)

- 잘못된 시크릿 → `401`·무처리(W2) / D1 미존재·비active → `202`·track 미호출(W1·W12) / 유효 active → track→CAS→푸시 / 중복 콜백(같은 단계) → 중복 푸시 0(W6) / 직전 폴링 <60s → skip / track 실패 → `202`(W5)

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. AC 실행.
2. 체크리스트:
   - 콜백 라우트가 **Bearer 인증 앞**에 있고 시크릿 경로로만 게이트되는가?
   - **페이로드 불신**(D1 active 송장일 때만 track)이 지켜지는가(W1)?
   - 다운스트림이 `pollOne` 과 **공유**(복제 아님)인가? 중복 콜백에 푸시 0(W6·CAS)인가?
   - 응답이 항상 **1초 내**(재조회는 `waitUntil`)인가?
3. `phases/15-backend-v0-webhook-first/index.json` step4 업데이트.

## 금지사항

- 콜백 페이로드의 상태를 **신뢰해서 그대로 저장하지 마라**. 이유: 위조 가능 — 항상 `track` 재조회(ADR-011·029). D1 active 송장만 재조회.
- 콜백에 **IP rate limit** 을 걸지 마라. 이유: tracker 고정 IP 거짓양성(ADR-029·T2). 송장별 `last_polled_at` throttle.
- 재조회를 **동기로** 처리해 응답을 지연시키지 마라. 이유: tracker 콜백은 빠른 2xx 기대 → `ctx.waitUntil`.
- 푸시/CAS 로직을 콜백용으로 **복제하지 마라**. 이유: 두 경로가 갈리면 중복 푸시·멱등 깨짐. `pollOne` 다운스트림 재사용.
- 시크릿/콜백 URL 을 로그에 남기지 마라(device_id 동급·T6).
- 기존 테스트를 깨뜨리지 마라.
