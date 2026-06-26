# Step 0: inmotion-notify (이동중 최초 1회 알림 추가)

`이동중` 단계를 알림 대상에 추가한다. **추가 상태 없이** 기존 CAS(전환 1회)로 "첫 진입 1회"가 자동 충족된다.

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-030**(이동중 최초 1회·CAS 멱등으로 자연 충족·"상품이 이동을 시작했어요" 무드)
- `/docs/PRD.md` — "알림 정책" 단계별 문구(이동중 추가됨)
- `worker/src/lib/notify.ts` — `NOTIFYING_STAGES`(현재 등록·집화·배송출발·배송완료·예외), `shouldNotify(prev, next)`(=`prev !== next && NOTIFYING_STAGES.has(next)`)
- `worker/src/lib/notify.test.ts` — 기존 테스트 스타일
- `worker/src/push.ts` — `STAGE_BODY`(단계별 body), `bodyFor`(배송출발 특수), `buildMessage`(=`!NOTIFYING_STAGES.has(stage) || body===undefined → null`)
- `worker/src/push.test.ts`
- `worker/src/lib/normalize.ts` — `IN_TRANSIT → 이동중`(터미널 입·출고 모두 이동중으로 정규화 → 같은 단계)
- `worker/src/lib/polling.ts` — `Stage` 타입

## 작업 (test-first)

### A. `notify.ts` — `이동중`을 `NOTIFYING_STAGES` 에 추가
- 집합에 `"이동중"` 추가. → `shouldNotify(집화→이동중)` = true(첫 진입), `shouldNotify(이동중→이동중)` = false(`prev===next`, 같은 단계라 무발송).

### B. `push.ts` — `STAGE_BODY` 에 `이동중` 문구 추가
- `이동중: "🚛 상품이 이동을 시작했어요"` (또는 동등 무드). **이모지는 배송출발(`🚚`)과 구분**되게(이동중=허브 간 이동, 배송출발=최종 배송 시작 — 혼동 금지). `buildMessage` 가 `이동중`에 대해 null 이 아닌 메시지를 내야 한다(NOTIFYING_STAGES + STAGE_BODY 둘 다 충족).

### C. 테스트 (test-first — 빨강→초록)
- `notify.test.ts`: `shouldNotify(집화, 이동중)===true`, `shouldNotify(이동중, 이동중)===false`(최초 1회 잠금), `shouldNotify(미등록, 이동중)===true`(집화 건너뛴 직행도 1회).
- `push.test.ts`: `buildMessage("이동중", ...)` 가 body 있는 PushMessage 반환(null 아님), 문구 확인.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. AC 실행(새 테스트 test-first).
2. 체크리스트:
   - `이동중→이동중`(터미널 입고→출고 재관측)이 **무발송**인가(CAS·`prev!==next` 의존)? 최초 1회만?
   - 추가 상태/플래그 없이 기존 CAS 로만 최초 1회가 되는가?
   - `buildMessage("이동중")` 가 null 이 아닌가?
3. `phases/16-backend-v0-notif-immediate/index.json` step0 업데이트(성공 시 summary).

## 금지사항

- 최초 1회를 위해 **새 컬럼/플래그/별도 상태를 추가하지 마라**. 이유: CAS(`casStage` 는 `prev !== next` 일 때만 전환)가 이미 보장 — 같은 `이동중` 재관측은 전환 아님(무발송). 추가 상태는 중복·복잡도.
- 배송출발과 **같은 이모지/혼동되는 문구**를 쓰지 마라. 이유: 사용자가 "이동 시작"과 "배송 출발(오늘 도착)"을 구분해야 함.
- 조용시간/발송 즉시화는 이 step 에서 건드리지 마라(step1 소관).
- 기존 테스트를 깨뜨리지 마라.
