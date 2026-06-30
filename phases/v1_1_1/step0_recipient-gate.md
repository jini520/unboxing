# Step 0: recipient-gate (#1 수취인 마스킹 게이트 · test-first)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-032(수취인 이름은 "식별 가능"할 때만 표시 · 마스킹 게이트)** 전문. 판정 규칙·denylist·이유·트레이드오프가 여기 있다.
- `/docs/PRD.md` — "v1.1.1" 섹션 #1 및 "v1.1.1 완료 기준(DoD)" #1.
- `/docs/UI_GUIDE.md` — "v1.1.1 — 수취인 표시 게이트…" 섹션(회귀 락 문구).
- `/CLAUDE.md` — 핵심 순수 로직은 **test-first(TDD)**, 변경은 `npm run verify` green일 때만 완료.
- 기존 순수 로직 모듈 1~2개를 읽어 이 repo의 테스트/구현 스타일을 따른다: `app/src/lib/memo.ts` + `app/src/lib/memo.test.ts`, `app/src/lib/amount.ts` + `app/src/lib/amount.test.ts` (vitest, 단일 export 순수함수 패턴).

## 작업

`app/src/lib/recipient.ts` 에 **순수 함수** 1개를 신규 추가한다. **test-first**: 먼저 `app/src/lib/recipient.test.ts` 를 작성해 아래 케이스를 명세하고(red), 그다음 구현한다(green).

```ts
// app/src/lib/recipient.ts
/**
 * 상세 화면 "받는 분" 표시 게이트 (ADR-032).
 * 수취인 이름이 "사용자가 식별 가능"할 때만 그대로 반환, 아니면 undefined(= 줄 숨김).
 * 표시 여부는 프레젠테이션 규칙이라 앱 측 순수 함수가 담당(worker 무변경).
 */
export function displayRecipientName(raw: string | null | undefined): string | undefined;
```

**판정 규칙(이 순서로 — 하나라도 걸리면 `undefined`):**

1. `raw` 가 `null`/`undefined`, 또는 `trim()` 후 빈 문자열 → `undefined`.
2. `trim()` 한 값이 **플레이스홀더 denylist** 에 정확히 일치 → `undefined`.
   denylist(택배사가 이름 대신 넣는 라벨): `받는 분`, `받는분`, `수령인`, `수취인`, `수신인`, `고객`, `고객님`, `본인`.
3. 마스킹문자 `*` 와 공백을 모두 제거한 뒤 **남는 문자가 0개** → `undefined` (`***`, `*`, `* *` 등 전부 가림 케이스).
4. 그 외 → `raw.trim()` 을 **그대로 반환**(부분 마스킹 `김**`·`이**`·`김*윤`·실명은 식별 가치가 있어 표시).

**test 명세(반드시 포함 — DoD #1):**
- **표시(반환값 === 입력 trim)**: `"김**"`, `"이**"`, `"김*윤"`, `"홍길동"`(실명).
- **숨김(=== undefined)**: `"받는 분"`, `"받는분"`, `"수령인"`, `"수취인"`, `"수신인"`, `"고객"`, `"고객님"`, `"본인"`, `"***"`, `"*"`, `""`, `"   "`(공백만), `null`, `undefined`.
- 경계: `"받는 분 "`(뒤 공백) → `undefined`(trim 후 denylist 일치).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다(특히 `recipient.test.ts` 의 표시/숨김 케이스 전부 green).
2. 아키텍처 체크리스트:
   - 순수 함수다(부수효과·I/O·시간 의존 없음). 외부 의존 없음.
   - `displayRecipientName` 만 export. worker/D1/네트워크 무관(표시 게이트는 앱 측 — ADR-032).
   - CLAUDE.md test-first 원칙을 지켰는가(테스트 먼저 작성).
3. 결과에 따라 `phases/v1_1_1/index.json` 의 step 0 을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(생성 파일·핵심 결정)"`.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러"`.

## 금지사항

- 상세 화면(`app/app/shipment/[id].tsx`)·worker(`toContact`)를 **이 step에서 건드리지 마라.** 이유: 와이어링은 step 1 의 책임이고, step 0 은 순수 함수+테스트만(scope 최소화). 게이트는 앱 측이라 worker 무변경(ADR-032).
- 구현을 먼저 쓰지 마라. 이유: 핵심 순수 로직은 test-first 필수(CLAUDE.md).
- denylist에 부분 마스킹(`김**` 등)을 넣지 마라. 이유: 부분 마스킹은 사용자가 자기 택배를 알아볼 수 있어 **표시** 대상이다(ADR-032).
- 기존 테스트를 깨뜨리지 마라.
