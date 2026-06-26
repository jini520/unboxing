# Step 5: cron-sweeps (통합 — 재등록 sweep · lifecycle 독립 sweep · 조건부 폴백)

cron 을 **신선도 1차에서 유지보수+저빈도 폴백**으로 전환한다(ADR-028). 폴링 다운스트림·정규화·CAS·멱등은 그대로 재사용.

## 읽어야 할 파일

- `/docs/QA.md` — **F-2 "재등록 sweep·조건부 폴백 due·수명주기 슬롯·lifecycle 독립 sweep·subrequest 예산"**, **F-3 W7·W10·W11·W12**
- `/docs/ADR.md` — **ADR-028**(cron 역할 전환: 24h 재등록 sweep·lifecycle 독립 sweep·조건부 폴백 cadence·subrequest 예산 재등록 우선), ADR-012(선점·청크 ≤50)
- `/docs/ARCHITECTURE.md` — "cron 실행 모델"(폴백 due 조회·조건부 cadence·subrequest 예산 공유), "lifecycle 독립 sweep (폴링에서 분리)", "Webhook §재등록 sweep·수명주기 연동(슬롯 위생)"
- `/docs/ENGINEERING.md` — 함정 **T7**(lifecycle 폴링 분리 필수)·T1(재등록도 fetch.bind)
- `worker/src/cron.ts` — `runPollingBatch`(L106: due 쿼리·`isDue`·`MAX_BATCH`·`DUE_SCAN_LIMIT`·`MIN_POLL_INTERVAL_MS`), `pollOne`(L146), `sweepReceipts`/`flushQueue`/`sweepNotifications`(기존 작업), `CronDeps`
- `worker/src/lib/webhook.ts` — step1·2: `reregisterDue`·`shouldRegisterWebhook`·`webhookExpiration`·`isDue`(확장됨)·`fallbackInterval`
- `worker/src/lib/lifecycle.ts` — `lifecycleAction`(독립 sweep 판정 재사용)
- `worker/src/tracker.ts` — step3: `registerTrackWebhook`
- `worker/src/index.ts` — step4: 추출된 다운스트림(`processShipmentUpdate` 등) 재사용 확인

## 작업 (`runPollingBatch` 안에서 — 순서·예산 주의)

### A. 조건부 폴백 due (기존 due 쿼리 확장)

- due 쿼리 SELECT 에 `webhook_expires_at` 추가, JS 판정을 `isDue(stage, last_polled_at, now, webhook_expires_at)` 로(step1 확장). → **등록분(`webhook_expires_at` 있음)은 ~12h 전엔 due ❌**, **NULL(미등록·실패·초과)은 적응형대로 due**(F-2 조건부 폴백 due). SQL 1차 좁힘 기준도 webhook 분이 과도하게 걸리지 않게 조정(여전히 ≤`MAX_BATCH`).

### B. webhook 등록 sweep (즉시 마이그레이션 + 승급 + 등록 실패 재시도)

- 폴링 due 와 **무관하게** active·`webhook_expires_at` **NULL**·등록 가능 단계 송장을 조회해 `shouldRegisterWebhook(stage, active, null, now)` true 인 것을 `registerTrackWebhook`(step3) 등록 → 성공 시 `webhook_expires_at` set. **예산 청크**(≤50·10 req/s), 초과분 다음 fire 이월. 이 **하나의 sweep** 이 셋을 덮는다:
  - **즉시 마이그레이션**: 운영 D1 의 기존 추적분(NULL). 운영 송장이 소수라 **첫 fire 에 일괄 등록**(폴링 주기를 기다리지 않음). 등록되면 due 간격 ~12h 로 낙하.
  - **승급(W7)**: `미등록`→첫 이벤트로 등록 가능 단계가 된 송장. 등록 sweep 을 **폴링 패스 뒤**에 두면 폴링이 단계를 갱신한 **같은 fire** 에 픽업된다.
  - **등록 실패 재시도**: POST 시점 등록이 실패해 NULL 로 남은 송장도 매 fire 재시도 → set 될 때까지.
- `미등록`(이벤트 0)·배송완료·비active 는 `shouldRegisterWebhook` false → 등록 sweep 제외(미등록은 폴링이 첫 이벤트 감지까지 적응형).
- **true 즉시(배포 직후)** 가 필요하면 step6 에서 배포 후 cron 1회 수동 트리거(아니면 다음 fire ≤15분).

### C. 24h 재등록 sweep

- active 송장 중 `reregisterDue(webhook_expires_at, now)`(만료 <24h) 인 것만 `registerTrackWebhook` 재등록(`expirationTime=webhookExpiration(now)`=48h 앞) → `webhook_expires_at` 갱신. 여유·비active·NULL 은 제외.
- **슬롯 위생**: `active=0`(배송완료·분실·예외만료)·구독 0 송장은 재등록 sweep 대상에서 자연히 빠져 ≤48h 만료로 1000 슬롯 회수. deregister API 존재는 step6 스모크.

### D. lifecycle 독립 sweep (폴링에서 분리 — T7)

- **폴링 루프와 별개로** active 송장을 스캔해 `lifecycleAction({stage, createdAt, now})` 판정 → 미등록7일·예외7일·분실30일 비활성(`active=0`)+알림(기존 `notifyCheckNumber`/`notifyLost` 재사용). **재폴링이 거의 없는 webhook 송장도 여기서 만료 판정**(W11) — 폴링 안에서 판정하면 누락된다.

### E. subrequest 예산 공유 (≤50/fire·10 req/s)

- 우선순위: **① 재등록 sweep(기존 webhook 생존=신선도 핵심) → ② 폴백 폴링 → ③ webhook 등록 sweep(B·마이그레이션/승급/재시도) → ④ receipt sweep 등**. 합계 ≤50 subrequest, 비동기 track·등록은 10 req/s 준수. **초과분은 다음 fire 로 이월**(W10). 운영 송장이 소수면 한 fire 에 전부 처리된다.

### F. 테스트 (F-2·F-3)

재등록 sweep(임박 active 만·`now` 주입) / 조건부 폴백 due(webhook 송장 ~12h 전 due ❌·NULL 적응형) / lifecycle 독립 sweep(재폴링 0 webhook 송장도 비활성+알림·W11) / 슬롯(DELETE·active=0 → 재등록 제외) / **등록 sweep: 기존 `webhook_expires_at` NULL·등록 가능 단계 active 송장이 due 무관 첫 fire 에 등록·`expires_at` set → 이후 due 간격 ~12h**(즉시 마이그레이션) / 미등록·배송완료·비active 는 등록 sweep 제외 / 승급(미등록→첫 이벤트→등록 sweep 픽업·W7) / 등록 실패 NULL 재시도 / 예산(재등록 우선·이월·W10).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. AC 실행.
2. 체크리스트:
   - lifecycle 판정이 **폴링과 독립된 sweep** 인가(T7·W11)? 재폴링 0 webhook 송장 만료가 잡히는가?
   - 조건부 폴백이 `isDue(...,webhook_expires_at)` **단일 출처**로 동작하는가(드리프트 0)?
   - 재등록이 **예산 우선**·초과분 이월인가(≤50·10 req/s)?
   - 재등록도 `fetch.bind` 된 deps 인가(T1)?
   - 기존 cron 작업(receipt·flush·보존)·멱등이 보존되는가?
3. `phases/15-backend-v0-webhook-first/index.json` step5 업데이트.

## 금지사항

- 미등록7일·분실30일을 **폴링 루프 안에서** 판정하지 마라. 이유: webhook 송장은 무변화라 재폴링이 거의 없어 만료 누락(T7·ADR-028). **독립 sweep**.
- 사용자별 타이머/상시 폴링을 만들지 마라. 이유: 무료 티어·cron 단일 배치 원칙(CLAUDE.md CRITICAL·ADR-001).
- 폴백 간격을 cron 에 **재하드코딩**하지 마라. 이유: `fallbackInterval`(step1) 단일 출처와 드리프트.
- 재등록 실패로 cron 전체를 중단시키지 마라. 이유: 폴백 폴링·receipt 등 다른 작업은 계속돼야 함(삼킴·이월).
- 콜백 다운스트림을 또 복제하지 마라(step4 추출분 재사용).
- 등록 sweep 이 예산(≤50·10 req/s)을 무시하고 한 fire 에 무제한 등록하지 마라. 이유: 풀이 크면 1000 동시·rate limit 압박 — 청크·이월(운영 송장이 소수면 자연히 한 fire 에 완료).
- 기존 테스트를 깨뜨리지 마라.
