# Step 7: cron-scheduled (배치 폴링 wiring)

cron(15분)이 due된 송장을 폴링 → 정규화 → 멱등 알림 → 만료/삭제까지 묶는 **통합/배선 step**. 앞선 모든 모듈(normalize·notify·lifecycle·tracker·push)을 사용한다. 외부 호출·`now` 는 주입해 통합 테스트한다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — "적응형 폴링 + cron 실행 모델", "상태 정규화 & 알림", "동시성 & 원자성", "데이터 수명주기 & 만료", "푸시 발송 파이프라인"
- `/docs/ADR.md` — ADR-001/006(서버리스 cron·적응형), ADR-010(push 2단계), ADR-012(단일 실행·선점 갱신·KST), ADR-013(토큰 캐시)
- `/Users/jinni/Developments/unboxing/worker/src/index.ts` — `scheduled` 스텁 + fetch(step6)
- `/Users/jinni/Developments/unboxing/worker/src/lib/polling.ts` — `isDue`·`pollIntervalMs`·`Stage`
- `/Users/jinni/Developments/unboxing/worker/src/lib/normalize.ts` — `normalizeStatus` (step1)
- `/Users/jinni/Developments/unboxing/worker/src/lib/notify.ts` — `shouldNotify` (step2)
- `/Users/jinni/Developments/unboxing/worker/src/lib/lifecycle.ts` — `lifecycleAction` (step3)
- `/Users/jinni/Developments/unboxing/worker/src/tracker.ts` — `track`·`d1TokenStore` (step4)
- `/Users/jinni/Developments/unboxing/worker/src/push.ts` — `buildMessage`·`sendPush`·`classifyPushError` (step5)
- `/Users/jinni/Developments/unboxing/worker/test/helpers.ts` — `applySchema` (step6)

## 작업

배치 로직을 `worker/src/cron.ts` 에 두고, `index.ts` 의 `scheduled` 는 이를 호출만 하게 한다(얇게 유지).

```ts
interface CronDeps {
  now: number;
  fetch: typeof fetch;
  // tracker/push 를 직접 주입하거나, fetch+now 만 주입하고 내부에서 모듈을 호출해도 됨(테스트에서 mock 가능해야 함)
}
/** due 송장 배치 폴링 1회 실행. */
export async function runPollingBatch(env: Env, deps: CronDeps): Promise<void>;
```

`index.ts`:

```ts
async scheduled(controller, env, ctx) {
  ctx.waitUntil(runPollingBatch(env, { now: controller.scheduledTime, fetch }));
}
```

### 배치 흐름 (ARCHITECTURE cron 실행 모델)

1. **due 조회·정렬**: `active=1` 송장을 `배송출발` 우선 → `last_polled_at ASC` 정렬로 조회. JS에서 `isDue(stage, last_polled_at, now)` 로 거른 뒤 **최대 50건**만 처리한다(나머지는 다음 fire로 이월). 정렬 예: `ORDER BY CASE WHEN last_normalized_status='배송출발' THEN 0 ELSE 1 END, last_polled_at ASC`.
2. **선점 갱신**: 처리 시작 시 해당 송장의 `last_polled_at = now` 로 먼저 갱신(중첩/중복 방지).
3. **track**: `track(carrier, tracking_no, …)`. 토큰은 `d1TokenStore(env.DB)`. 데모 번호는 step4가 우회.
4. **정규화**: `normalizeStatus(lastEvent?.statusCode)` → `next: Stage`.
5. **멱등 단계 전환(compare-and-set)**: `UPDATE shipments SET last_normalized_status=?next WHERE id=? AND last_normalized_status IS ?prev`. **영향 행이 1일 때만** 전환으로 인정. 그때 `shouldNotify(prev, next)` 가 true면 구독자별 `buildMessage` → `sendPush` → ticket 을 `push_tickets` 에 보관(`ctx.waitUntil` 로 비동기 가능).
6. **배송완료**: 전환이 `배송완료` 면 알림 발송 후 **shipment 삭제**(subscriptions CASCADE).
7. **만료**: `lifecycleAction({stage: next, createdAt, now})` 가 `deactivate` 면 `active=0` (+`notify:true` 면 "분실 의심" 푸시).
8. **외부 오류 처리**(ARCHITECTURE 에러 분류): `UNAUTHENTICATED` 은 tracker가 재인증(step4). NOT_FOUND/데이터 없음 → `미등록` 유지. 429/5xx/timeout → 조용히 다음 cron 재시도(이미 선점 갱신했으므로 자연 백오프; 필요 시 `fail_count`/`next_retry_at` 갱신). 사용자 비노출.

### 시간대

"오늘 도착(배송출발)" 등 날짜 판정은 **KST(UTC+9)** 로. 푸시 문구의 날짜 표현에 반영.

## 핵심 규칙 (벗어나면 안 됨)

- **1회 실행당 외부 subrequest ≤ 50.** due 처리 건수를 50으로 제한한다. 이유: Cloudflare cron subrequest 한도(ADR 비용 모델·ADR-012).
- **멱등 알림 = compare-and-set.** 단계 전환은 `UPDATE ... WHERE last_normalized_status = <prev>` 로 원자 갱신하고, **영향 행이 1일 때만** 발송한다. 이유: 중복/경쟁 cron 실행에도 정확히 1회 발송(ARCHITECTURE 동시성).
- **`이동중`/`기타`/`미등록` 무알림.** `shouldNotify`(step2)를 단일 판단 출처로 쓴다. 이유: 알림 규칙 일관성.
- **선점 갱신**으로 중첩 실행 시 같은 송장 중복 처리를 막는다(ADR-012).
- **`배송완료` → 알림 후 shipment 삭제.** 이유: 데이터 수명주기·개인정보 비영속(ADR-005).
- `now`·`fetch`(및 외부 모듈)는 **주입**한다. `Date.now()`·실네트워크 호출에 의존하지 마라. 이유: 통합 테스트 결정성.
- `DeviceNotRegistered` receipt/ticket → 해당 push_token 삭제(`classifyPushError` 결과 활용). 이유: 토큰 위생.
- device_id·push_token·수령인 정보 로그/저장 금지.

## 테스트 (`cloudflare:test` + 주입 fetch/now)

`worker/test/cron.test.ts`(신규): `applySchema(env.DB)` 후 송장 시드 → `runPollingBatch(env, {now, fetch: fakeFetch})`:

- due 선택이 `isDue` 를 따른다(간격 미달 송장은 폴링 안 됨).
- `등록 → 배송출발` 전환 시 발송, **같은 배치를 한 번 더 실행해도 재발송 없음**(CAS 멱등).
- `이동중` 전환은 푸시 없음.
- `배송완료` 전환 → 푸시 후 shipment 행 삭제됨.
- 30일 경과 미완료 → `active=0`.
- due 50건 초과 시 한 번에 ≤50건만 외부 호출(이월).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 1회 처리 ≤50건(subrequest 한도)?
   - 단계 전환이 compare-and-set + 영향행=1 조건으로 멱등인가(재실행 무발송)?
   - `이동중`/`기타`/`미등록` 무알림, `배송완료` 알림 후 삭제가 테스트로 보장되는가?
   - `now`/`fetch` 주입으로 결정적 테스트인가?
   - CLAUDE.md CRITICAL(상시 서버 금지·개인정보 비영속·사용자별 타이머 금지) 위반 없는가?
3. `phases/worker-backend/index.json` 의 step 7 을 업데이트한다(규칙은 step0 과 동일).

## 금지사항

- 사용자별 타이머/상시 루프를 만들지 마라. 이유: CLAUDE.md CRITICAL — cron 단일 배치만.
- 단계 전환을 select-then-update(비원자)로 처리하지 마라. 이유: 경쟁 실행 시 중복 발송 — 반드시 compare-and-set.
- 1회 실행에서 50건을 초과해 외부 호출하지 마라. 이유: subrequest 한도 초과로 cron 실패.
- `Date.now()`·실제 tracker/Expo 네트워크 호출에 의존하지 마라. 이유: 비결정적 테스트.
- 정규화·알림판단·만료·푸시 로직을 여기서 재구현하지 마라. 이유: step1~5 모듈을 호출(단일 출처). 배선만.
- 기존 테스트를 깨뜨리지 마라.
