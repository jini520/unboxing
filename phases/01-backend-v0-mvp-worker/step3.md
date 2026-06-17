# Step 3: lifecycle (만료/좀비 정책)

송장의 자동 비활성(만료) 판단을 하는 **순수 로직**. `now` 주입(고정 시계). test-first(TDD). 외부 의존·D1 접근 없음.

> 실제 D1 `active=0` UPDATE·삭제·알림 발송은 step7(cron)에서 이 함수의 결정을 받아 수행한다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — "적응형 폴링 + cron 실행 모델" → "만료/좀비", "데이터 수명주기 & 만료" 표
- `/docs/PRD.md` — 핵심 플로우 6(미등록/오타 번호), MVP 알림 정책
- `/Users/jinni/Developments/unboxing/worker/src/lib/polling.ts` — `Stage` 타입
- `/Users/jinni/Developments/unboxing/worker/src/lib/notify.ts` — step2 산출물(알림 단계 개념)

## 작업

`worker/src/lib/lifecycle.ts` 와 `worker/src/lib/lifecycle.test.ts` 를 만든다.

```ts
import type { Stage } from "./polling";

export type LifecycleAction =
  | { type: "keep" }
  | { type: "deactivate"; reason: "미등록7일" | "예외7일" | "분실의심30일"; notify: boolean };

/**
 * 송장을 비활성해야 하는지 판단. now·createdAt 은 epoch ms.
 * Phase 1은 createdAt(등록 시각)을 기준 시계로 사용한다(데이터가 단기·비영속이라 단계별 진입 시각 정밀 추적은 Phase 2).
 */
export function lifecycleAction(input: { stage: Stage; createdAt: number; now: number }): LifecycleAction;
```

규칙 (ARCHITECTURE "데이터 수명주기 & 만료"):

- `미등록` 이고 등록 후 **7일** 경과 → `deactivate / 미등록7일 / notify:false`. (앱에서 "번호 확인" 안내로 표시)
- `예외` 이고 등록 후 **7일** 경과 → `deactivate / 예외7일 / notify:false`.
- 등록 후 **30일** 경과 AND 단계가 `배송완료`·`예외` 가 아님 → `deactivate / 분실의심30일 / notify:true`("분실 의심" 알림).
- 그 외 → `{ type: "keep" }`.
- 경계는 `now - createdAt >= 임계` (이상)으로 판정.

상수: `SEVEN_DAYS_MS`, `THIRTY_DAYS_MS` 를 명시적으로 정의.

> `배송완료` 송장의 "알림 후 삭제"는 만료가 아니라 별도 수명주기 경로(step7 cron이 처리)다. 이 함수는 `배송완료` 에 대해 `keep` 을 반환한다.

## 핵심 규칙 (벗어나면 안 됨)

- `now` 는 반드시 인자로 주입받는다. **`Date.now()` 호출 금지.** 이유: 시간 의존 로직은 고정 시계로 테스트해야 한다(CLAUDE.md 개발 프로세스).
- 30일 강제 비활성은 `배송완료`·`예외` 단계를 제외한다. 이유: 완료/예외는 각자 경로로 처리되며 "분실 의심"이 아니다.
- 순수 함수, D1·외부 호출 없음.

## 테스트 (test-first)

- `미등록`, createdAt = now - 7일 → deactivate 미등록7일 (경계 포함).
- `미등록`, createdAt = now - 6일 → keep.
- `예외`, createdAt = now - 7일 → deactivate 예외7일.
- `이동중`, createdAt = now - 30일 → deactivate 분실의심30일, notify:true.
- `배송완료`, createdAt = now - 40일 → keep (만료 대상 아님).
- `예외`, createdAt = now - 30일 → 예외7일 또는 keep 중 의도된 우선순위를 테스트로 고정(예외 7일이 30일보다 먼저 걸림).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `now` 주입·`Date.now()` 미사용인가?
   - 30일 규칙이 `배송완료`/`예외` 를 제외하는가?
   - 경계값(정확히 7일/30일)이 테스트로 고정됐는가?
3. `phases/worker-backend/index.json` 의 step 3 을 업데이트한다(규칙은 step0 과 동일).

## 금지사항

- `Date.now()` 등 현재 시각을 함수 내부에서 읽지 마라. 이유: 결정적 테스트 불가.
- D1 UPDATE·삭제·푸시 호출을 작성하지 마라. 이유: 부작용은 step7(cron)의 책임. 여기는 판단만.
- `Stage` 재정의 금지. 이유: `polling.ts` 단일 출처.
- 기존 테스트를 깨뜨리지 마라.
