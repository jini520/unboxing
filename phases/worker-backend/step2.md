# Step 2: notify-idempotency (알림 트리거 결정)

단계 전환 시 푸시를 보낼지 결정하는 **순수 로직**. 멱등성(중복 발송 금지)의 핵심. test-first(TDD). 외부 의존·D1 접근 없음.

> 이 step은 **"보낼지 말지"의 판단**만 다룬다. 실제 D1 compare-and-set UPDATE 와 Expo 발송은 step7(cron)에서 이 함수를 사용해 수행한다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — "상태 정규화 & 알림" → "알림 규칙", "동시성 & 원자성" → "알림 멱등"
- `/docs/PRD.md` — "알림 정책"(어느 단계가 알림 대상인지)
- `/docs/ADR.md` — ADR-018(거래성 알림만)
- `/Users/jinni/Developments/unboxing/worker/src/lib/polling.ts` — `Stage` 타입
- `/Users/jinni/Developments/unboxing/worker/src/lib/normalize.ts` — step1 산출물(단계 종류 확인)

## 작업

`worker/src/lib/notify.ts` 와 `worker/src/lib/notify.test.ts` 를 만든다.

```ts
import type { Stage } from "./polling";

/** 단계 전환 시 푸시를 보내야 하는 알림 대상 단계. */
export const NOTIFYING_STAGES: ReadonlySet<Stage>; // 등록·집화·배송출발·배송완료·예외

/**
 * 이전 단계(prev)에서 다음 단계(next)로 바뀔 때 푸시를 보낼지.
 * - next 가 알림 대상이고 AND 단계가 실제로 바뀐 경우(prev !== next)에만 true.
 * - 이동중·기타·미등록 으로의 전환은 항상 false(타임라인만).
 * - prev 가 null(첫 관측)이고 next 가 알림 대상이면 true.
 */
export function shouldNotify(prev: Stage | null, next: Stage): boolean;
```

알림 대상 단계 (PRD/ARCHITECTURE): `등록`·`집화`·`배송출발`·`배송완료`·`예외`.
무알림 단계: `이동중`·`기타`·`미등록`.

## 핵심 규칙 (벗어나면 안 됨)

- **단계 전환에만** true. `prev === next`(같은 단계 재관측)는 항상 false. 이유: 재폴링/중복 cron 실행에도 정확히 1회만 발송해야 한다(멱등).
- `이동중`·`기타`·`미등록` 으로의 전환은 **무조건** false. 이유: ARCHITECTURE 알림 규칙(과알림 방지).
- 순수 함수. `now`·D1·외부 호출 없음. 실제 멱등 보장(compare-and-set)은 step7에서 DB UPDATE로 구현하지만, 그 판단 입력이 이 함수다.

## 테스트 (test-first)

- `null → 등록` = true (첫 관측이 알림 대상).
- `null → 미등록` = false.
- `등록 → 등록` = false (재관측, 멱등).
- `배송출발 → 배송완료` = true.
- `집화 → 이동중` = false (이동중 무알림).
- `이동중 → 배송출발` = true.
- `배송완료 → 배송완료` = false.
- `등록 → 기타` = false.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `이동중`/`기타`/`미등록` 무알림이 테스트로 보장되는가?
   - `prev === next` 재관측 무발송이 보장되는가?
   - `Stage` 를 재정의하지 않고 import 했는가?
3. `phases/worker-backend/index.json` 의 step 2 를 업데이트한다(규칙은 step0 과 동일).

## 금지사항

- 이 step에서 Expo Push 호출이나 D1 UPDATE 를 작성하지 마라. 이유: 발송/CAS는 step7(cron)의 책임. 여기는 순수 판단만.
- 마케팅/프로모션 알림 분기를 넣지 마라. 이유: ADR-018 — Phase 1은 거래성 알림만.
- `Stage` 재정의·`Date.now()`·외부 호출 금지. 이유: 결정적 순수 함수 유지.
- 기존 테스트를 깨뜨리지 마라.
