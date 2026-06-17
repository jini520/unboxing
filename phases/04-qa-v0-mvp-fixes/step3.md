# Step 3: quiet-hours (#7 P2 — 조용시간 야간 보류·아침 묶음)

야간(KST 22:00–08:00)에 비긴급 단계 전환 푸시를 보류했다가 아침에 묶어 보낸다. **이슈 #7(QA-004) 해소**. (PRD가 "권장"·"정확 시간 구현 시 확정"으로 표기 — 시간 경계는 PRD 기준 KST 22–08로 구현하고 주석에 근거 명시.)

## 읽어야 할 파일

- GitHub 이슈 **#7** 및 `/docs/QA_FINDINGS.md`의 **QA-004** 행
- `/docs/PRD.md` — "알림 정책"(조용시간 22:00–08:00 KST, 예외·배송완료 외 보류 후 아침 묶음)
- `/docs/ADR.md` — ADR-012(KST), ADR-018(과알림)
- `/Users/jinni/Developments/unboxing/worker/src/cron.ts` — `runPollingBatch`·`deliver`·`notifyTransition`
- `/Users/jinni/Developments/unboxing/worker/src/push.ts`, `worker/src/schema.ts`·`schema.sql`
- `/Users/jinni/Developments/unboxing/worker/test/cron.test.ts`·`test/e2e/tracking.test.ts`
- **step0·step2 산출**: step0 의 NULL-토큰 제외(`subscriberTokens`)와 `handleDeleteMe`(여기서 `notification_queue` purge 추가), step2 의 안내가 타는 `deliver` 경로(조용시간이 이를 덮는다). 이 step 은 그 위에서 작업한다.

## 작업

1. **순수 헬퍼 `worker/src/lib/quiet.ts`**(test-first):
   - `isQuietHours(nowMs: number): boolean` — KST(UTC+9) 시각이 22:00–08:00 이면 true.
   - `isUrgentStage(stage: Stage): boolean` — `예외`·`배송완료`는 야간에도 즉시 발송(true).
2. **schema** (`schema.sql`+`schema.ts` idempotent): 보류 큐 `notification_queue (id TEXT PK, shipment_id TEXT REFERENCES shipments(id) ON DELETE CASCADE, push_token TEXT NOT NULL, title TEXT, body TEXT, created_at INTEGER)` — **메시지 스냅샷(title·body)을 저장**(아침에 재구성하지 않음, E2). FK CASCADE 로 송장 삭제 시 보류분도 자동 정리.
3. **cron `deliver`/전환 경로**: 단계 전환 알림 시 `isQuietHours(now) && !isUrgentStage(stage)` 이면 `sendPush` 대신 **이미 만든 PushMessage(title·body)를 큐에 적재**. 긴급/주간은 기존대로 즉시 발송. (안내 알림 step2도 deliver 경유라 함께 보류됨.)
4. **아침 플러시**: `runPollingBatch`에서 `!isQuietHours(now)` 일 때 `notification_queue`를 비우며 **device별 묶음**으로 `sendPush`(배치 ≤100, 토큰별 ≤N) 후 행 삭제. (sweepReceipts·rate_limits 정리와 같은 위치.) **subrequest 예산**: track ≤50 + receipt sweep + 이 플러시가 더해지므로, 플러시도 배치 한도를 지키고 1회 다 못 비우면 다음 fire로 이월.
5. **데이터 삭제 보강 (C2·M1, #11 포함)**: `notification_queue` 가 push_token 사본을 담으므로 `handleDeleteMe` 가 이 테이블도 폐기해야 한다(ADR-017). **같은 핸들러에서 `push_tickets` 도 함께 폐기**(QA-008/#11 — 동일 부류, 한 줄). 즉 `DELETE /me` 는 device 의 push_token 을 `devices`·`push_tickets`·`notification_queue` 모두에서 즉시 제거.

## 핵심 규칙 (벗어나면 안 됨)

- 날짜·시각 판정은 **KST(UTC+9)**, `now` 주입(테스트 결정성). 이유: ADR-012·결정적 테스트.
- `예외`·`배송완료`는 야간에도 즉시 발송(보류 금지). 이유: 긴급 알림(PRD).
- 멱등 보장: 전환은 여전히 CAS로 1회만 — 보류는 "발송 시점"만 미루지 알림을 복제하지 않는다. 이유: 중복 발송 금지.
- 보류 큐는 발송 후 삭제(무한 증가 방지, push_tickets·rate_limits 정리와 동일 패턴).

## 엣지케이스 & 에러 처리 (반드시 다룰 것)

- **한 송장 야간 다중 전환 → collapse**: 야간에 등록→집화→배송출발이 모두 일어나면 큐에 3건. 아침에 3개 푸시는 과알림 → **송장(+device)당 최신 단계 1건으로 묶어** 발송(오래된 보류분은 폐기/덮어쓰기). PRD "묶어 전달" 충족.
- **보류분의 송장/기기 소멸**: 보류 후 플러시 전에 송장 삭제(완료·orphan·`DELETE /me`) → FK CASCADE(2번) 또는 device 폐기(5번)로 큐 행이 정리돼 죽은 토큰 발송 방지. 그래도 플러시 `sendPush` 는 `DeviceNotRegistered` 를 받으면 토큰 정리(기존 classify 경로).
- **NULL 토큰 제외**: 적재·발송 모두 step0 의 NULL-제외 토큰 수집을 재사용(토큰 없는 구독자 큐 적재 금지).
- **멱등 불변**: 보류는 "발송 시점"만 미룬다 — 전환 CAS 는 즉시(1회) 적용하고, 보류분은 알림 메시지일 뿐 단계 상태를 다시 안 건드린다(중복 알림 금지).
- **경계/시계**: `now` 주입, KST 22:00/08:00 경계 정확. 플러시는 `!isQuietHours` 인 매 fire 에 시도(0건이면 no-op).
- **(R2) 보류분 stale**: 야간에 보류한 '등록' 알림이 아침 플러시 시점엔 이미 '집화'로 진행됐을 수 있다(야간↔주간 경계). 정책: **스냅샷 그대로 발송**(그 전환은 실제로 일어났음) + 한 송장 야간 다중전환은 collapse(최신 1건). 경계 stale 은 감수(현재 단계와 재대조하지 않음 — 단순·결정적 유지). 이 결정을 주석에 명시.

## 검증 (수정 증명)

- `quiet.test.ts`: KST 22:00/08:00 경계, 주간/야간, 긴급 단계.
- `worker/test/e2e/tracking.test.ts`의 QA-004 `it.todo`를 통과로 전환: 야간 `now`로 등록 전환 → 즉시 발송 0 + 큐 적재 1. 이후 주간 `now`로 재실행 → 큐 플러시로 발송 + 큐 비워짐. 예외 전환은 야간에도 즉시 발송.
- **collapse**: 한 송장 야간 다중 전환 → 아침 플러시 시 1건만 발송.
- **데이터 삭제(C2·M1)**: `lifecycle.test.ts`의 QA-008 `it.todo`를 통과로 전환 — `DELETE /me` 후 `devices`·`push_tickets`·`notification_queue` 모두 해당 push_token 0건. (또한 `e2e/lifecycle.test.ts`가 `push_tickets` **잔존**을 단언하던 QA-008 재현 부분을 0건으로 뒤집어야 함.)

### ⚠️ 기존 테스트 영향 (반드시 처리 — 조용시간이 시계를 의미있게 만든다)

조용시간 도입 전엔 발송 시각이 무의미했으나, 도입 후엔 `now`가 KST 야간이면 비긴급 알림이 **보류**된다. 그래서:

- **`worker/test/cron.test.ts`의 `NOW = 1_700_000_000_000` 은 KST 07:13 = 조용시간**이다. 그대로 두면 "등록→배송출발 발송(`sendCalls=1`)" 류 단언이 **보류로 0이 돼 깨진다**. → **`NOW`를 KST 주간 값(예 14:00)으로 바꾸거나**, 즉시 발송 테스트는 주간 `now`로 명시. (`배송완료`는 긴급이라 야간에도 발송 → 그 테스트는 영향 없음.)
- **`worker/test/e2e/{tracking,lifecycle}.test.ts` 는 `now: Date.now()`(실 벽시계)를 쓴다** → 조용시간 도입 후 **실행 시각(낮/밤)에 따라 보류 여부가 갈려 flaky** 해진다. → 즉시 발송을 단언하는 E2E 의 `now`를 **고정 주간 값**으로 교체(조용시간 전용 케이스만 고정 야간 값). 비결정성 제거가 필수.
- 새 `quiet.test.ts` + tracking E2E 의 `QA-004 it.todo` → 통과 전환(주간 즉시·야간 보류·아침 플러시).

## Acceptance Criteria

```bash
npm run verify
```

## 검증 절차

1. AC 실행. 2. 체크리스트: KST 경계 정확? 긴급 즉시·비긴급 보류? 아침 묶음 발송 후 큐 삭제? 멱등 유지? 3. `phases/qa-fixes/index.json` step 3 업데이트(summary "fixes #7 #11" — 데이터삭제 보강으로 #11 동반 해소). 이슈 자동 닫기는 qa-fixes PR 본문에서.

## 금지사항

- `Date.now()` 직접 사용·UTC로 야간 판정하지 마라. 이유: KST·결정적 테스트.
- 예외·배송완료를 보류하지 마라. 이유: 긴급.
- 보류로 알림을 복제하거나 CAS 멱등을 깨지 마라. 기존 테스트를 깨뜨리지 마라.
