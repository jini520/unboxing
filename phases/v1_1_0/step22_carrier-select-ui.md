# Step 22: carrier-select-ui (공유 택배사 선택 컴포넌트 추출 + 등록 화면 적용)

#3(ADR-026)을 등록 화면에 적용한다. 동시에 택배사 선택 UI 를 **공유 컴포넌트로 추출**한다 — phase 14(상세 "수정" 모달)가 **같은 컴포넌트·정책을 재사용**하기 때문이다(ADR-026 "등록/수정 공통 컴포넌트"). 이 step은 ① 신규 `src/components/CarrierSelect.tsx` 추출 + ② `app/register.tsx` 가 그것을 쓰도록 교체, 두 가지를 다룬다.

## 읽어야 할 파일

먼저 아래를 읽고 현재 구조·정책·디자인 토큰 사용을 파악하라:

- `/docs/ADR.md` — **ADR-026**(택배사 자동선택 보수화)
- `/docs/UI_GUIDE.md` — "등록"(택배사 추정 → 후보 1개면 자동 채움·여러 개면 자동선택 없이 드롭다운 명시 선택)
- `/Users/jinni/Developments/unboxing/app/src/lib/carrier.ts` — **step0 에서 추가된 `autoPickCarrier`** + `estimateCarriers`·`CARRIERS`·`CarrierCandidate`. (step0 이 먼저 실행돼 있어야 한다.)
- `/Users/jinni/Developments/unboxing/app/app/register.tsx` — 현재 인라인 `CarrierList`(line 250~) + selector Pressable(line 183~206) + `selectedId = picked ?? candidates[0]?.id` 로직(line 69~73). **이 파일을 교체 대상으로 정독하라.**
- `/Users/jinni/Developments/unboxing/app/src/components/ScreenHeader.tsx` 등 기존 컴포넌트 — 추출 컴포넌트의 스타일/토큰 패턴 참고.

이전 step(step0)에서 `autoPickCarrier` 가 추가됐다. 그 함수를 정책의 단일 출처로 쓴다.

## 배경 (현재 동작 → 바꿀 동작)

**현재(register.tsx):** `const selectedId = picked ?? candidates[0]?.id ?? null;` — 사용자가 안 골라도 추정 **1순위를 자동선택**한다. 후보가 ≥2 여도 1순위가 박혀 등록되어 오선택을 부른다(#3 버그).

**바꿀 동작(ADR-026):** 명시 선택(`picked`)이 없으면 **`autoPickCarrier(candidates)`** 로만 자동 채운다 — 후보가 1개일 때만 채워지고, **≥2 면 미선택(null)** 이라 "택배사를 선택하세요" 상태 + 등록 버튼 비활성. 후보가 모호할 때는 **드롭다운을 펼쳐 명시 선택을 유도**한다.

## 작업 A — 신규 `app/src/components/CarrierSelect.tsx` (공유 컴포넌트)

`register.tsx` 의 selector Pressable + `listBox` + 인라인 `CarrierList` 를 **표현(presentational) 컴포넌트**로 추출한다. 정책 함수(`autoPickCarrier`)는 **호출부(화면)** 가 호출하고, 이 컴포넌트는 받은 값을 표시·선택만 한다(controlled).

제안 시그니처:

```tsx
export function CarrierSelect({
  candidates,        // CarrierCandidate[] — 호출부가 estimateCarriers(번호)로 만들어 전달
  value,             // string | null — 현재 선택된 carrierId(= picked ?? autoPickCarrier(candidates), 호출부가 계산)
  onChange,          // (id: string) => void — 사용자가 행을 고르면 호출(호출부가 picked 갱신)
  open,              // boolean — 드롭다운 펼침 여부(controlled)
  onToggleOpen,      // () => void — selector 탭으로 펼침/접힘 토글
}: {
  candidates: CarrierCandidate[];
  value: string | null;
  onChange: (id: string) => void;
  open: boolean;
  onToggleOpen: () => void;
}): JSX.Element
```

컴포넌트가 반드시 보존할 것(현 register.tsx 동작·UI_GUIDE 회귀 금지):
- selector 는 `value` 가 있으면 해당 `carrierName`, 없으면 placeholder **"택배사를 선택하세요"**(disabled 색). 우측 `ChevronDown`(펼침 시 180° 회전).
- 드롭다운 리스트: **추정 후보(추천) 먼저, 나머지 `CARRIERS` 순**. 추천 행엔 "· 추천" 표기. 선택 행은 **accent 색 + `Check` 글리프**(색 단독 금지 — 체크 글리프 동반).
- 행을 render 안에서 컴포넌트로 정의하지 말 것(매 렌더 remount). 현재처럼 `rows` 배열을 직접 매핑(현 register.tsx 주석 참조).
- 색은 토큰만(`tokens.*`), 하드코딩 금지. a11y: selector 는 `accessibilityRole="button"` + 라벨, 행은 `accessibilityState={{ selected }}`.

내부 구현·props 형태는 재량이되 위 동작·정책 경계는 지켜라. (정책 `autoPickCarrier` 는 컴포넌트가 아니라 **호출부**가 적용한다 — 컴포넌트는 `value` 만 표시.)

## 작업 B — `app/register.tsx` 교체

1. 인라인 `CarrierList` 함수와 그 관련 스타일(selector/listBox/row)을 `CarrierSelect` 로 대체한다(컴포넌트로 옮긴 스타일은 register 에서 제거 — 고아 방지).
2. 효과적 선택을 **`autoPickCarrier`** 로 바꾼다:
   ```ts
   const candidates = useMemo(() => estimateCarriers(input), [input]);
   const selectedId = picked ?? autoPickCarrier(candidates);   // ← candidates[0]?.id 자동선택 제거
   ```
   `selectedId` 가 null 이면 기존처럼 등록 버튼 비활성(`disabled={!valid || !selectedId || submitting}` 그대로) + selector 가 "택배사를 선택하세요" 표시.
3. **모호 시 드롭다운 펼침 유도(UI_GUIDE):** 번호가 유효(`valid`)하고 `selectedId == null`(후보 ≥2 라 자동선택 안 됨, 아직 미선택)일 때 드롭다운을 펼쳐 명시 선택을 유도한다. 단 사용자가 직접 접으면 다시 강제로 펼치지 마라(무한 펼침 금지). 구현 방식은 재량(예: 입력이 유효-모호로 바뀌는 순간 1회 `setShowList(true)`).
4. `submit` 의 `createShipment(selectedId, ...)` 등 나머지 등록 로직·클립보드·priming·에러 매핑은 **그대로 둔다**. import 정리(미사용 `CARRIERS` 등 생기면 제거, `autoPickCarrier` 추가).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 전부 green
```

## 검증 절차

1. AC 실행 green.
2. 체크리스트:
   - `register.tsx` 가 `candidates[0]?.id` 자동선택을 더 이상 하지 않고 `autoPickCarrier` 를 쓰는가.
   - 후보 ≥2 일 때 selectedId 가 null → 등록 버튼 비활성 + "택배사를 선택하세요" 표시(명시 선택 유도).
   - 택배사 선택 UI 가 `CarrierSelect` 컴포넌트로 추출됐고, 추천 순서·"· 추천" 태그·선택 행 색+체크가 보존됐는가(UI_GUIDE 회귀 없음).
   - `CarrierSelect` 가 **export** 되어 phase 14 에서 import 가능한가.
   - 색 하드코딩 없음(토큰만), 미사용 import/스타일 없음.
3. `phases/13-qa-v0-v11-carrier-select/index.json` 의 step1 갱신:
   - 성공 → `"status":"completed"`, `"summary"`: src/components/CarrierSelect.tsx 추출(추천 순서·체크 보존, controlled value/onChange/open) + register.tsx 가 picked??autoPickCarrier 로 교체(후보≥2 미선택→버튼 비활성, 모호 시 드롭다운 펼침 유도). phase 14 가 CarrierSelect 재사용. npm run verify green.
   - 실패(3회) → `"error"` + `error_message`
   - 사용자 개입 필요 → `"blocked"` + `blocked_reason`

## 금지사항

- 등록 기본 흐름(번호만으로 등록·클립보드 제안·priming·미지원 409 딥링크 폴백·입력값 보존)을 바꾸지 마라. 이유: #3 은 "택배사 자동선택만" 보수화하는 정정이다(마찰 최소 원칙 — 번호 등록 흐름 불변).
- `picked` 가 있을 때 `autoPickCarrier` 로 덮어쓰지 마라. 이유: 사용자 명시 선택이 항상 우선(`picked ?? autoPickCarrier(...)`).
- 색을 단독 신호로 쓰지 마라(선택 행은 색+`Check` 글리프 동반 — UI_GUIDE 회귀 락).
- `CarrierSelect` 안에서 행을 render 함수 내부 컴포넌트로 정의하지 마라. 이유: 매 렌더 새 타입 → 전 행 remount(현 register.tsx 주석에 명시된 함정).
- 기존 통과 테스트를 깨뜨리지 마라.
