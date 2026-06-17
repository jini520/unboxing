# Step 0: qa-scaffold (E2E 시나리오 토대 + QA 문서)

이 phase는 **MVP를 QA**한다 — 단위·통합 테스트가 통과해도(174개 green) 실제 사용자 여정(E2E)에서 깨지는 갭을 찾는다. 이 step은 그 토대를 세운다: 지름길 없는 E2E 시나리오 테스트 인프라 + 발견 기록 문서.

> **이 phase의 철칙(모든 step 공통): QA는 발견·기록만 한다. 버그를 고치지 마라.** 수정은 별도 phase/이슈. 갭은 실패 단언으로 verify를 깨지 말고 `it.todo("QA-NNN: …")` + `docs/QA_FINDINGS.md` 기록으로 남긴다. 이유: find↔fix 분리(이미 issue #3처럼).

## 읽어야 할 파일

- `/docs/PRD.md` — "핵심 플로우", "MVP 완료 기준(DoD)"
- `/docs/ARCHITECTURE.md` — "테스트 전략", "HTTP API 계약"
- `/Users/jinni/Developments/unboxing/worker/test/helpers.ts` — 기존 `applySchema`·`bearer`
- `/Users/jinni/Developments/unboxing/worker/test/shipments.test.ts` — 기존 통합 테스트 방식(`cloudflare:test` SELF·env)
- `/Users/jinni/Developments/unboxing/worker/src/schema.ts` — `SCHEMA_STATEMENTS`

## 작업

### 1. E2E 시나리오 헬퍼 `worker/test/e2e/scenario.ts`

지름길(테스트가 device를 미리 심는 등) 없이 **실제 HTTP 흐름**을 `SELF.fetch`로 구동하는 얇은 래퍼:

```ts
// applySchema(env.DB) 로 초기화된 깨끗한 D1 위에서, 앱이 하듯 Bearer device_id 로만 호출한다.
export interface ApiResult { status: number; body: unknown }
export function call(method: string, path: string, opts?: { deviceId?: string; json?: unknown }): Promise<ApiResult>;
// 편의: device 등록 없이 곧장 운송장 등록을 시도하는 등 "사용자가 실제로 하는 순서"를 그대로 표현.
```

`worker/test/e2e/smoke.test.ts`: 토대 검증 1케이스(`call("GET","/health")` → 200) + happy-path 1개(정상 등록 흐름이 통과함을 보여 헬퍼 동작 확인).

### 2. `docs/QA_FINDINGS.md` (발견 기록 — 단일 출처)

표 형식으로 누적한다(이후 step들이 append). 컬럼: `ID | 심각도(P0~P3) | 영역 | 사양 출처 | 재현 | 현재 동작 | 기대(사양) | 제안 수정 | 이슈#`.

**이미 발견된 것 1건을 시드**로 넣는다:

| ID | 심각도 | 영역 | 사양 | 현재 | 기대 | 이슈 |
|---|---|---|---|---|---|---|
| QA-001 | P0 | 등록/인증 | PRD 플로우5 | 푸시 토큰 없으면 기기 미등록 → `POST /shipments` 401(데드락) | 푸시 거부해도 등록 가능 | #3 |

### 3. `docs/QA_TESTPLAN.md` (수동 QA 테스트플랜 — 골격)

자동화 불가 항목용 골격 섹션만(step5가 채운다): ① 실기기 푸시 시나리오 ② 시뮬레이터 화면별 런스루 ③ 스토어 제출 체크리스트.

## 핵심 규칙 (벗어나면 안 됨)

- E2E 테스트는 **지름길 금지** — 앱이 실제로 하는 호출 순서를 그대로(예: device 선등록을 테스트가 임의로 INSERT하지 말 것). 이유: 그 지름길이 QA-001 데드락을 못 잡은 원인이다.
- 버그를 고치지 마라(schema/worker/app 수정 금지). 이유: find↔fix 분리.
- 외부 의존(tracker.delivery·Expo)은 mock/주입. 실호출 금지.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트: `scenario.ts`가 지름길 없이 SELF.fetch로 흐름을 구동하는가? `QA_FINDINGS.md`·`QA_TESTPLAN.md`가 생성됐고 QA-001이 기록됐는가? smoke 테스트가 통과하는가?
3. `phases/qa-mvp/index.json`의 step 0 을 업데이트한다(완료→summary, 규칙은 harness 표준).

## 금지사항

- 발견된 버그를 수정하지 마라(코드 변경은 별도 phase). 이유: 이 phase는 QA(발견·기록) 전용.
- 갭을 실패하는 단언으로 작성해 verify를 빨갛게 만들지 마라 — `it.todo`/`.skip` + `QA_FINDINGS.md`. 이유: AC는 green 유지.
- 기존 테스트를 깨뜨리지 마라.
