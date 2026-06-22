# Step 2: quiet-flush-and-retention-sweep — 조용시간 보류분 flush 로깅 + 보존 sweep

조용시간(quiet hours)에 보류됐던 알림은 **실제로 발송되는 flush 시점에 기록**해야 한다(사용자가 받는 시점 기준, 보강②). 또한 `notifications` 가 무한히 쌓이지 않도록 cron 에서 **보존 sweep**(90일 + 디바이스당 상한)으로 정리한다(ADR-023).

## 읽어야 할 파일

먼저 아래를 읽고 보류 큐(flush) 흐름과 cron scheduled 경로를 파악하라:

- `/docs/ARCHITECTURE.md` — "알림 기록 write 지점"(조용시간 보류분은 flush 시점), "v1.1 설계 보강 ②"(flush 로깅·device_id=token 현재 소유자·token 양도분 제외), "데이터 모델" `notifications`(보존: cron sweep 90일 + 디바이스당 상한), "백그라운드 작업(cron)" 표의 v1.1 행
- `/docs/ADR.md` — ADR-023(보존 90일·디바이스당 상한·`DELETE /me` 즉시 폐기), ADR-020(음소거)
- `/docs/QA.md` — "E-2 워커 통합" 조용시간 flush·보존 sweep 행
- `worker/src/lib/quiet.ts` — `notification_queue` 적재·flush(실제 발송) 경로, token 키 스냅샷, steal 시 정리(F3)
- `worker/src/cron.ts` — scheduled 진입점(sweep 을 붙일 위치)
- **이전 step 산출물**: step1 의 fan-out 로깅 헬퍼(INSERT 1행 로직 재사용), `notifications` 스키마·`NotificationRow`

## 작업

### 1. flush 시점 로깅 (quiet.ts)
- `notification_queue` 보류분을 **flush(실제 발송)할 때** `notifications` 1행을 기록한다(적재 시점 아님 — 수신 시점 기준).
- `device_id` = 그 token 의 **현재 소유자**(`devices` 에서 token→device 역조회). token 이 양도됐으면 보류분은 steal 시 이미 정리(F3)되어 flush·로깅되지 않는다(교차 누설 없음).
- 기록 컬럼은 step1 과 동일(carrier=carrierId, last4, body·stage, sent_at=flush 시 주입 now). step1 의 INSERT 헬퍼를 재사용한다(드리프트 금지).

### 2. 보존 sweep (cron.ts — scheduled)
- cron scheduled 경로에 sweep 추가:
  - `DELETE FROM notifications WHERE sent_at < ?`(`now - 90일`), `now` 는 주입(deps).
  - **디바이스당 상한**: 디바이스별 행이 상한(예 500)을 넘으면 **오래된 것부터** 정리(예: 각 device_id 의 `sent_at` 상위 N개만 보존). 단순·결정적으로 구현(상한 상수는 한 곳 정의).
- 멱등·저비용: 재실행돼도 같은 조건이라 부작용 없음. 무료 티어 cron 예산 내(기존 폴링 배치에 묶거나 별도 분기).

## 테스트 (TDD)
- 워커 통합(`cloudflare:test` env·D1, `now` 주입):
  - **flush 시점 로깅**: 보류 적재 시엔 기록 없음 → flush 시 1행, `device_id` = token 현재 소유자.
  - **token 양도분**: steal 로 정리된 보류분은 flush·로깅되지 않음(행 0).
  - **sweep 90일**: `sent_at < now-90일` 행 삭제, 90일 이내 행 보존.
  - **디바이스당 상한**: 상한 초과 device 는 오래된 것부터 정리(상한 개수만 남음), 다른 device 무영향.
  - sweep 이 cron scheduled 경로에서 호출됨.

## Acceptance Criteria
```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차
1. 위 AC 실행.
2. 체크리스트: flush=수신 시점 로깅 / token 양도분 제외 / sweep 90일·디바이스당 상한 / `now` 주입(고정 시계) / step1 INSERT 헬퍼 재사용(드리프트 없음) / ADR 스택·CLAUDE.md CRITICAL(비영속·$0) 위반 없음 / 기존 테스트 무파손.
3. `phases/07-backend-v0-v11-notifications/index.json` step 2 업데이트(성공→completed+summary / 3회 실패→error / 외부개입→blocked).

## 금지사항
- 보류 **적재 시점**에 로깅하지 마라. 이유: 알림 기록은 "받은 알림"이라 flush(실제 발송) 시점이 정본 — 적재만 되고 발송 안 된 것을 기록하면 거짓 기록.
- 90일 이내 행을 sweep 으로 삭제하지 마라. 이유: 보존 정책 위반(사용자가 최근 알림을 못 봄).
- `now` 를 `Date.now()` 로 직접 호출하지 마라. 이유: 시간 의존 로직은 주입(고정 시계)이어야 결정적 테스트(CLAUDE.md).
- 디바이스당 상한 정리에서 **다른 device 행**을 건드리지 마라. 이유: 기기별 독립 보존이어야 한다.
- 기존 테스트를 깨뜨리지 마라.
