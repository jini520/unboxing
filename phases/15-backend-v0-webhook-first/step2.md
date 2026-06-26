# Step 2: callback-lifecycle-logic (순수 로직 · test-first)

콜백 처리의 순수부(시크릿 검증·신선도 throttle·페이로드 파싱)와 lifecycle 독립 sweep 판정을 **test-first** 로 만든다. 외부 의존 없음.

## 읽어야 할 파일

- `/docs/QA.md` — **F-1 "콜백 처리 순수부"·"lifecycle 독립 sweep"** 표, **F-3 W2·W6·W11**
- `/docs/ADR.md` — **ADR-029**(① 시크릿 경로·상수시간 비교 ② 페이로드 불신 ③ 신선도 throttle·`last_polled_at` <60s skip), ADR-028(lifecycle 폴링 분리)
- `/docs/ARCHITECTURE.md` — "콜백 보안", "lifecycle 독립 sweep (폴링에서 분리)"
- `/docs/ENGINEERING.md` — 함정 **T6**(시크릿 엣지 로그→페이로드 불신이 실질 1차 방어, 상수시간 비교)·**T7**(lifecycle 폴링 분리 필수)
- `worker/src/lib/webhook.ts` + `webhook.test.ts` (step1 산출물 — 같은 파일에 함수 추가)
- `worker/src/lib/lifecycle.ts` — `lifecycleAction({stage, createdAt, now})`·`LifecycleAction`·`SEVEN_DAYS_MS`·`THIRTY_DAYS_MS`(기존, 재사용)
- `worker/src/lib/lifecycle.test.ts` — 기존 테스트 스타일

## 작업

### A. 콜백 순수 함수 — `worker/src/lib/webhook.ts` 에 추가 (test-first)

QA F-1 "콜백 처리 순수부":

- `verifyCallbackSecret(got: string, expected: string): boolean`
  - 일치 true / 불일치·빈값 false. **상수시간 비교**(timing-safe) — **첫 불일치 문자에서 early-return 금지**(타이밍 오라클). 길이가 달라도 안전하게 false(누산 XOR 등). ADR-029 ①.
- `shouldRefetchOnCallback(lastPolledAt: number | null, now: number): boolean`
  - `lastPolledAt !== null && now - lastPolledAt < 60_000` → **false**(직전 폴링 <60s, 연속·중복 콜백 dedupe). 그 외 true. ADR-029 ③·W6.
- `parseCallback(body: unknown): { carrierId: string; trackingNumber: string } | null`
  - 정상 `{carrierId, trackingNumber}`(둘 다 비어있지 않은 문자열) → 객체. 누락·타입오류·손상 JSON → **null**. 여분 필드는 무시(두 필드만 취함). W1 의 위조 입력도 여기서 null/무해.

### B. lifecycle 독립 sweep — 폴링 분리 회귀 잠금 (test-first)

`lifecycleAction` 은 이미 순수이고 `now` 주입이다. 이 step 은 **분리해도 판정이 불변**임을 테스트로 잠근다(W11). `webhook.test.ts` 또는 `lifecycle.test.ts` 에:

- **W11 회귀 잠금**: 재폴링이 거의 없는 webhook 송장(예: `last_polled_at` 이 오래 전이지만 `webhook_expires_at` 있음)이라도, `lifecycleAction({stage, createdAt, now})` 가 `last_polled_at` 과 **무관하게** 미등록7일·예외7일·분실30일을 동일하게 판정함을 명시(=lifecycle 판정 입력에 `last_polled_at` 이 없음을 잠금).
- 새 순수 함수가 필요하면 만들되, 기존 `lifecycleAction` 의 판정 로직을 **복제하지 말고 재사용**하라(독립 sweep 의 "어떤 송장을 비활성화" 결정은 `lifecycleAction` 그대로).

> 실제 cron 독립 sweep 배선(active 송장 스캔→비활성+알림)은 **step5** 다. 이 step 은 그 판정이 폴링과 분리돼도 안전함을 **순수 수준에서 잠그는** 것.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. AC 실행. 새 테스트 test-first(빨강→초록) 확인.
2. 체크리스트:
   - `verifyCallbackSecret` 이 **early-return 없는 상수시간**인가(ADR-029 ①·T6)?
   - `shouldRefetchOnCallback` 60s 경계가 정확한가?
   - `parseCallback` 이 위조·손상 입력에 null 인가(W1 안전)?
   - lifecycle 판정이 `last_polled_at` 에 의존하지 않음을 테스트가 잠갔는가(W11·T7)?
3. `phases/15-backend-v0-webhook-first/index.json` step2 업데이트.

## 금지사항

- `verifyCallbackSecret` 에서 길이 비교/첫 불일치 early-return 으로 **단축**하지 마라. 이유: 타이밍 사이드채널(ADR-029 ①). 누산 비교.
- 콜백 보안을 **IP rate limit** 으로 설계하지 마라. 이유: 콜백은 tracker.delivery 소수 고정 IP → 정상 콜백을 한꺼번에 막는 거짓양성(ADR-029·T2). 송장별 `last_polled_at` throttle 만.
- `lifecycleAction` 판정 로직을 새로 복제하지 마라. 이유: 분리 sweep 과 폴링이 다른 기준이 되면 만료 누락/오판(T7).
- 외부 호출·D1·`fetch` 금지(순수 로직만). 통합은 step4·5.
- 기존 테스트를 깨뜨리지 마라.
