# Step 21: auto-pick-logic (택배사 자동선택 정책 — 순수 함수 + test-first)

v1.1 출시 후 시뮬레이터 스모크에서 발견한 #3 정정. 운송장 등록 시 택배사 추정(`estimateCarriers`, 자릿수 휴리스틱)이 **후보를 2개 이상** 내면 1순위를 **자동 선택하지 않는다**(오선택 방지, ADR-026). 이 step은 그 정책을 **순수 함수 하나**로 만들고 **테스트 먼저** 작성한다. UI(`register.tsx`)는 다음 step에서 손댄다 — 이 step은 `src/lib/carrier.ts` 한 파일 + 그 테스트만 다룬다.

## 읽어야 할 파일

먼저 아래를 읽고 현재 추정 계약과 테스트 스타일을 파악하라:

- `/docs/ADR.md` — **ADR-026**(택배사 자동선택은 후보가 모호하면 안 함)
- `/docs/ARCHITECTURE.md` — "v1.1 추가 (2026-06-23) … 택배사 자동선택 정책 (ADR-026)"
- `/Users/jinni/Developments/unboxing/app/src/lib/carrier.ts` — 이 step의 유일한 대상. `estimateCarriers`·`CARRIERS`·`CarrierCandidate` 확인.
- `/Users/jinni/Developments/unboxing/app/src/lib/carrier.test.ts` — 여기에 테스트를 **추가**한다(기존 describe 유지).

## 배경 (확정된 정책 — ADR-026)

- `estimateCarriers(trackingNo)` 는 자릿수 휴리스틱으로 **후보 배열**을 가능성 순으로 낸다(무효 번호면 빈 배열).
- 현 휴리스틱은 길이별로 보통 **2~3개**를 내므로(`BY_LENGTH`/`DEFAULT_ORDER`), 사실상 자동선택이 거의 안 일어나는 게 정상이다(ADR-026 트레이드오프에 명시 — 매 등록에서 택배사 1탭 선택). 이 정책은 그 의도대로 동작해야 한다.
- 규칙: **후보가 정확히 1개일 때만** 그 1개를 자동선택. **2개 이상이면 자동선택 없음**(`null`). **0개(추정 불가)도 자동선택 없음**(`null`).

## 작업 — `app/src/lib/carrier.ts`

`estimateCarriers` 바로 아래에 순수 함수를 추가한다(시그니처):

```ts
/**
 * 추정 후보 중 "자동 선택"할 carrierId. 후보가 **정확히 1개**일 때만 그 id, 그 외(0개·2개 이상)는 null.
 * 후보가 모호하면(>=2) 자동선택하지 않고 사용자가 드롭다운에서 명시 선택한다(ADR-026, 오선택 방지).
 */
export function autoPickCarrier(candidates: CarrierCandidate[]): string | null;
```

- 구현은 1줄 수준이면 충분하다(`candidates.length === 1 ? candidates[0].id : null`). 과한 추상화 금지.
- `estimateCarriers`·`BY_LENGTH`·`DEFAULT_ORDER`·`CARRIERS` 등 기존 코드는 **건드리지 마라**. 새 export 만 추가한다.

## 테스트 — `app/src/lib/carrier.test.ts`

`describe("autoPickCarrier", ...)` 를 **추가**한다(기존 `estimateCarriers` describe 는 그대로). 최소 다음을 단언:

1. 후보 0개(빈 배열) → `null`.
2. 후보 1개 → 그 id 를 반환.
3. 후보 2개 이상 → `null`(1순위를 자동선택하지 않음 — **이게 #3의 핵심**).
4. `estimateCarriers` 와 연동: 현 휴리스틱의 실제 길이(예: 11자리=후보 2개)에 대해 `autoPickCarrier(estimateCarriers(no))` 가 `null` 인지 확인(모호한 번호는 자동선택 안 됨).

테스트를 **먼저** 작성하고(red), 그 다음 함수를 구현해 green 으로 만든다(TDD — CLAUDE.md).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 전부 green
```

## 검증 절차

1. AC 실행 green.
2. 체크리스트:
   - `autoPickCarrier` 가 후보 ≥2 에서 `null` 을 반환하는가(자동선택 안 함 — ADR-026).
   - `estimateCarriers` 등 기존 함수·테스트를 바꾸지 않았는가.
   - 순수 함수인가(부수효과·시간 의존 없음).
3. `phases/13-qa-v0-v11-carrier-select/index.json` 의 step0 갱신:
   - 성공 → `"status":"completed"`, `"summary"`: carrier.ts 에 autoPickCarrier(후보 1개일 때만 자동선택, ≥2/0 은 null) 추가 + carrier.test.ts 테스트 추가. npm run verify green. (다음 step1 이 register.tsx·공유 CarrierSelect 에서 이 함수를 쓴다.)
   - 실패(3회) → `"error"` + `error_message`
   - 사용자 개입 필요 → `"blocked"` + `blocked_reason`

## 금지사항

- `estimateCarriers` 의 휴리스틱(`BY_LENGTH`/`DEFAULT_ORDER`)을 바꿔 후보 수를 줄이지 마라. 이유: 이 step의 정정은 "추정이 모호하면 자동선택을 끊는 것"이지 추정 정확도 개선이 아니다(룰 개선은 ADR-026상 별도 결정). 휴리스틱을 손대면 기존 carrier.test 단언이 깨진다.
- `register.tsx` 등 UI 를 이 step에서 건드리지 마라. 이유: scope 분리 — UI 적용은 step1.
- 기존 통과 테스트를 깨뜨리지 마라.
