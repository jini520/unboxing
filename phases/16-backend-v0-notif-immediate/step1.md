# Step 1: immediate-delivery (조용시간 폐지 — 전부 즉시 발송)

야간 보류·아침 묶음을 들어내고 **모든 거래성 단계 전환 푸시를 시각 무관 즉시** 발송한다. 로깅은 항상 발송 시점 1회로 단순화.

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-030**(조용시간 폐지·즉시 발송·notification_queue/flushQueue/quiet 제거·테이블은 DROP 안 함), **ADR-023**(알림 기록 — 이제 항상 발송 시점), **ADR-020**(음소거 — 보존)
- `/docs/ARCHITECTURE.md` — 알림 발송 흐름(조용시간/flush 부분 제거 대상), 환경/스키마
- `/docs/ENGINEERING.md` — P-3(운영 D1 통째 재실행·DROP 금지)
- `worker/src/cron.ts` — `deliver()`(L657~ `if (!urgent && isQuietHours)` 보류 분기), `flushQueue()`(L715~), `runPollingBatch` ⑥ 플러시 스텝(L172~174), `notifyTransition`/`fanOut`/`notifyOperational` 의 `urgent` 인자 배선, `isQuietHours`/`isUrgentStage` import
- `worker/src/lib/quiet.ts` + `quiet.test.ts` — **제거 대상**(고아)
- `worker/src/index.ts` — `notification_queue` DELETE 정리(음소거 L634~641·구독해제 L663~671·deleteMe 원자배치 L694~704·토큰 steal L415)
- `worker/src/schema.ts`·`worker/schema.sql` — `notification_queue` 테이블(유지·주석만)
- `worker/test/cron.test.ts`(조용시간/flush 케이스 다수)·`worker/test/notifications.test.ts`(flush 로깅)·`worker/test/helpers.ts`(TABLES)
- step0 산출물(notify.ts·push.ts)

## 작업 (test-first / verify 게이트)

### A. `deliver()` 항상 즉시 발송 + 로깅
- `if (!urgent && isQuietHours(deps.now)) { enqueue; return; }` **분기 제거** → 항상 `sendPush` + 로깅(ADR-023 — 발송 시점 1회). `urgent` 인자 제거.
- `notifyTransition`/`fanOut`/`notifyOperational` 의 `urgent` 인자·`isUrgentStage` 전달 제거.

### B. 야간 보류 머신 제거
- `runPollingBatch` ⑥ 플러시 스텝(`if (!isQuietHours) flushQueue`) 제거. `flushQueue()` 함수 제거. `isQuietHours`/`isUrgentStage` import 제거.
- `worker/src/lib/quiet.ts` + `quiet.test.ts` 삭제(고아).

### C. `index.ts` notification_queue 정리 제거
- 음소거·구독해제·토큰 steal 의 `DELETE FROM notification_queue ...` 제거(큐가 더는 안 쌓임). **deleteMe 원자 배치는 큐 DELETE 만 빼고 devices·subscriptions·push_tickets 삭제는 유지**(음소거/구독해제의 큐 외 동작도 보존).

### D. 스키마·문서 동기화
- `schema.ts`·`schema.sql` 의 `notification_queue` 테이블은 **남기고** 주석에 `-- deprecated (ADR-030, 미사용)` 표기. **DROP 하지 마라**(P-3·hook·운영 드리프트). `helpers.ts` TABLES 는 테이블이 존재하므로 유지.
- `ARCHITECTURE.md` 알림 흐름에서 조용시간/flush 경로 제거, `ADR-023` 의 "조용시간 flush 시점 로깅" 문구를 "항상 발송 시점"으로 동기화(ADR-030 반영).

### E. 테스트 전면 업데이트
- `cron.test.ts`·`notifications.test.ts` 의 "야간 보류→큐 적재"·"아침 flush 발송/로깅"·"urgent 즉시" 케이스를 **"항상 즉시 발송 + 발송 시점 로깅"**으로 재작성(또는 제거). `quiet.test.ts` 삭제.
- **보존 잠금**: 단계 전환 1회·CAS 멱등·음소거 제외(ADR-020)·전환 푸시만 로깅(active=1)·dedupe 는 그대로 green.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. AC 실행.
2. 체크리스트:
   - 야간이든 주간이든 **항상 즉시 발송 + 발송 시점 로깅 1회**인가?
   - 음소거(ADR-020)·CAS 멱등·dedupe·전환-only 로깅이 보존됐는가(회귀 0)?
   - `notification_queue` 가 **DROP 되지 않고** 미사용으로만 남았는가(P-3)?
   - 고아(`quiet.ts`·flush) 가 깨끗이 제거됐는가(orphan import 0)?
3. `phases/16-backend-v0-notif-immediate/index.json` step1 업데이트(성공 시 summary).

## 금지사항

- `notification_queue` 테이블을 **DROP 하지 마라**. 이유: hook 차단 + 운영 D1 드리프트(P-3) — 미사용으로 남기는 게 안전.
- 음소거·구독해제·deleteMe 에서 **큐 외 동작(devices·subscriptions·push_tickets 정리)을 훼손하지 마라**. 이유: 큐 정리만 제거 대상.
- 로깅을 **전환 외(운영성 안내)로 확대하지 마라**. 이유: ADR-023 — 전환 푸시만 기록(active=1), 기존 일관성 유지.
- 발송을 다시 비동기 큐로 우회하지 마라(즉시 발송이 ADR-030 핵심).
- 기존 테스트(음소거·CAS·dedupe·정규화)를 깨뜨리지 마라.
