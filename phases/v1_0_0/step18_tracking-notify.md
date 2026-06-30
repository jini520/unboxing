# Step 18: tracking-notify (추적·알림 cron E2E QA)

폴링→정규화→멱등 알림→완료 처리의 cron 여정을 E2E로 검증하고 갭을 기록한다. (발견·기록만 — 수정 금지.)

> **QA 철칙: 버그를 고치지 마라.** 갭은 `it.todo("QA-NNN: …")` + `docs/QA_FINDINGS.md`. verify green 유지.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — "상태 정규화 & 알림", "적응형 폴링 + cron 실행 모델", "푸시 발송 파이프라인", "동시성 & 원자성"
- `/docs/ADR.md` — ADR-006(적응형)·009(정규화)·010(push 2단계)·012(선점·KST)·013(토큰)
- `/docs/PRD.md` — "알림 정책"(단계별 1회·멱등·조용시간)
- `/Users/jinni/Developments/unboxing/worker/src/cron.ts`·`lib/normalize.ts`·`lib/notify.ts`·`push.ts`·`tracker.ts`
- `/Users/jinni/Developments/unboxing/worker/test/cron.test.ts` — 기존 cron 테스트 방식(주입 fetch/now)
- `/Users/jinni/Developments/unboxing/phases/qa-mvp/step0.md`·`step1.md` 산출 + `docs/QA_FINDINGS.md`

## 작업

`worker/test/e2e/tracking.test.ts`에 cron 여정 시나리오(주입 fetch/now로 결정적):

1. **단계 진행 + 멱등 알림**: 기기·구독·송장 시드 → fake track으로 등록→집화→배송출발→배송완료 단계 진행시키며 `runPollingBatch` 반복 → 각 전환 1회만 발송(재실행 무발송), `이동중`/`기타`/`미등록` 무알림.
2. **배송출발 KST 문구**: 출발 이벤트 시각 기준 "오늘 도착" 분기(KST)가 사양대로인지.
3. **배송완료**: 알림 후 shipment 삭제(CASCADE), 좀비 잔존 없음.
4. **만료/백오프**: 외부 오류 시 `last_polled_at` 원복 + `fail_count`/`next_retry_at` 백오프, 자격증명 의심 `[ALERT]` 로깅.
5. **receipt sweep**: ~15분 지난 ticket → `getReceipts` → `DeviceNotRegistered` 토큰 정리, push_tickets 폐기.
6. **due/청크**: 간격 미달 미폴링, 1회 ≤50건 이월.

사양 대비 갭(예: 조용시간 미구현, 알림 그룹화 미구현 등 PRD 항목)을 `QA_FINDINGS.md`에 기록. 미구현이 의도된 Phase 범위인지 함께 표기.

## 핵심 규칙 (벗어나면 안 됨)

- `now`·`fetch` 주입으로 결정적 테스트. 실제 tracker/Expo 호출 금지.
- 멱등성(재실행 무발송)을 반드시 검증한다 — 알림 신뢰성의 핵심.
- 갭은 todo/skip + FINDINGS. 코드 수정 금지.

## Acceptance Criteria

```bash
npm run verify
```

## 검증 절차

1. AC 실행. 2. 체크리스트: 단계 전환 멱등·무알림·완료삭제·백오프·receipt sweep가 실 흐름으로 검증되는가? PRD 알림정책 갭(조용시간·그룹화)이 FINDINGS에 기록됐는가? 3. `phases/qa-mvp/index.json` step 2 업데이트.

## 금지사항

- 버그·미구현을 고치지 마라. 이유: QA 전용(미구현은 갭으로 기록).
- 갭을 실패 단언으로 verify를 깨지 마라. 기존 테스트 깨뜨리지 마라.
