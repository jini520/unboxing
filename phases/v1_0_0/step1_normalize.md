# Step 1: normalize (상태 정규화 매핑)

택배사 원문 상태 코드를 표준 7단계로 정규화하는 **순수 로직**. test-first(TDD)로 작성한다. 외부 의존·D1 접근 없음.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — "상태 정규화 & 알림" → "원문 status.code → 표준 7단계 매핑" 표
- `/docs/ADR.md` — ADR-009(정규화 매핑은 코드 상수 맵)
- `/Users/jinni/Developments/unboxing/worker/src/lib/polling.ts` — `Stage` 타입 정의 위치(여기서 import)
- `/Users/jinni/Developments/unboxing/worker/src/lib/polling.test.ts` — 순수 로직 테스트 스타일(고정 값, `vitest`)

## 작업

`worker/src/lib/normalize.ts` 와 `worker/src/lib/normalize.test.ts` 를 만든다.

`Stage` 타입은 `./polling` 에서 import 한다(중복 정의 금지 — 단일 출처).

시그니처:

```ts
import type { Stage } from "./polling";

/** 택배사 원문 status.code → 표준 단계. 미매핑/알 수 없는 코드는 '기타', 데이터 없음(null/undefined)은 '미등록'. */
export function normalizeStatus(code: string | null | undefined): Stage;
```

매핑 표 (ARCHITECTURE 기준, 원문 enum 이름은 **추정** — 아래 문자열 키로 매핑하되 미매핑은 안전 폴백):

| 원문 status.code | 표준 단계 |
|---|---|
| `INFORMATION_RECEIVED` | `등록` |
| `AT_PICKUP` | `집화` |
| `IN_TRANSIT` | `이동중` |
| `OUT_FOR_DELIVERY` | `배송출발` |
| `DELIVERED` | `배송완료` |
| `AVAILABLE_FOR_PICKUP` | `배송완료` |
| `ATTEMPT_FAIL` | `예외` |
| `EXCEPTION` | `예외` |
| `UNKNOWN` | `기타` |
| (그 외 미매핑 문자열) | `기타` |
| `null` / `undefined` / `""` | `미등록` |

매핑은 **코드 상수 맵**으로 둔다(ADR-009 — D1 매핑 테이블 도입 금지).

## 핵심 규칙 (벗어나면 안 됨)

- 미매핑 코드는 **절대 throw 하지 말고** `기타` 로 폴백한다. 이유: 택배사가 새 코드를 보내도 폴링/cron이 깨지면 안 된다(ARCHITECTURE 에러 분류 "미매핑 status.code → 기타 폴백").
- 데이터 없음(`null`/`undefined`/빈 문자열)은 `미등록`. 앱 입력 직후 정상 상태다.
- 매핑 키에 enum 이름을 추가하기 쉬운 구조로 둔다(상수 객체). 단 폴백 `기타` 는 항상 보장.

## 테스트 (test-first)

- 표의 **모든 원문 코드 전수** → 기대 단계 검증.
- 미매핑 임의 문자열(예: `"WEIRD_CODE"`) → `기타`.
- `null` / `undefined` / `""` → `미등록`.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `Stage` 를 `./polling` 에서 import 했는가(재정의 금지)?
   - 매핑이 코드 상수 맵인가(D1 테이블 미도입)?
   - 미매핑·null 폴백이 테스트로 보장되는가?
3. `phases/worker-backend/index.json` 의 step 1 을 업데이트한다(완료/에러/blocked 규칙은 step0 과 동일).

## 금지사항

- `Stage` 타입을 새로 정의하지 마라. 이유: `polling.ts` 가 단일 출처. 중복 정의는 드리프트를 만든다.
- 미매핑 코드에서 예외를 던지거나 `null` 을 반환하지 마라. 이유: 호출부(cron)가 항상 유효한 `Stage` 를 기대한다.
- D1·외부 호출·`Date.now()` 를 쓰지 마라. 이유: 이 모듈은 순수 함수여야 테스트가 결정적이다.
- 기존 테스트를 깨뜨리지 마라.
