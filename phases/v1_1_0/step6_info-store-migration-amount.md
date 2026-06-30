# Step 6: info-store-migration-amount — 택배 정보(메모+카테고리+금액) 스토어 + 메모 마이그레이션 + 금액 검증

기존 로컬 메모를 **택배 정보(메모+카테고리+금액)** 로 확장한다(ADR-024, 로컬 전용). 구 `unboxing.memos` → 신 `unboxing.shipment_info` 로 **1회·멱등·무손실** 마이그레이션하고, 금액 검증/표시 순수 함수를 만든다. test-first. **`defaultMemoText` 등 기존 메모 표시 API 는 절대 깨지면 안 된다**(카드·상세가 import 중).

## 읽어야 할 파일

먼저 아래를 읽고 정보 스토어 형태·마이그레이션 규칙·금액 규칙·기존 메모 API 를 파악하라:

- `/docs/ARCHITECTURE.md` — "로컬 스토어" 표의 택배 정보 항목(키 v2·형태), "마이그레이션 (로컬 AsyncStorage — 메모 → 택배 정보)"(1회·멱등·무손실·손상안전), "v1.1 설계 보강 ⑥"(카테고리 미설정=값 없음·금액 0이상 정수)·"⑦"(마이그레이션 트리거)
- `/docs/ADR.md` — ADR-024(택배 정보 = 로컬 전용 + 로컬 스토어 마이그레이션, 가계부는 Phase 2)
- `/docs/QA.md` — "E-1" 택배 정보 스토어 + 마이그레이션·`parseAmount`/`formatAmount` 케이스, "E-4" E6(손상 JSON)·E7(금액 경계)·E8(카테고리 미설정)
- `app/src/lib/memo.ts` — **현 메모 스토어**(`unboxing.memos`·`loadMemos`·`memoStore`·`pruneMemos`·**`defaultMemoText`**). 이 파일의 **공개 API(특히 `defaultMemoText`)는 보존**한다. `app/src/lib/cache.ts`(KeyValueStore 패턴)

## 작업

### 1. `app/src/lib/info.ts` — 택배 정보 스토어 (`unboxing.shipment_info`, v2)
- 형태: `Record<shipmentId, ShipmentInfo>`, `ShipmentInfo = { memo?: string; category?: string; amount?: number }`.
- 함수(KeyValueStore 주입):
  - `migrateMemosToInfo(store)` — **1회·멱등·무손실**: 신 키 있으면 그대로 / 없고 구 `unboxing.memos`(`Record<string,string>`) 있으면 `{id: text}` → `{id: {memo: text}}` 변환·신 키 기록·**구 키 제거** / 신·구 동시 → **신 우선·구 정리** / 손상 구 JSON·비문자 값 → 안전(빈/스킵). 순수 변환부는 분리해 단위 테스트.
  - `loadInfo(store)` / `getInfo(store, id)` — 기본값(없으면 `{}`) / 손상 JSON graceful.
  - `setInfo(store, id, { memo, category, amount })` — **빈 메모 → memo 필드 삭제**, **미설정 category/amount 미저장**(키 자체 없음). 모든 필드 빈/미설정이면 해당 id 엔트리 제거.
  - `pruneInfo(store, keepIds)` / `clearInfo(store)`(wipe).
- **카테고리**: 미설정 = 값 없음(별도 "미지정" 의사값 두지 않음, 보강⑥). 고정 목록의 `기타` 는 실제 catch-all(미설정과 구분). 목록 외 레거시 값도 저장·표시 허용.

### 2. `app/src/lib/amount.ts` — 금액 파싱/포맷 (보강⑥)
- `parseAmount(input): number | undefined` — **0 이상 정수만** number, 음수·소수·빈·비숫자·상한 초과(≥10^10) → `undefined`.
- `formatAmount(n?): string` — 천단위 구분 + `₩` 접두. `0` → `"₩0"`, `undefined` → `"—"`.

### 3. `defaultMemoText` 보존
- 카드/타이틀의 대체 문구 규칙(메모 없으면 등록일 default)을 그대로 유지한다. `defaultMemoText` 가 `memo.ts` 에 있으면 **그 export 경로·시그니처를 유지**(또는 `info.ts` 에서 재export 하되 기존 import 경로가 깨지지 않게). 표시 규칙 불변(UI_GUIDE 회귀-락).

## 테스트 (TDD)
- `info.test.ts`(mock KeyValueStore):
  - `migrateMemosToInfo`: `{id:"t"}`→`{id:{memo:"t"}}` / **멱등**(2회=1회) / 신 키 존재 시 no-op / 신·구 동시 → 신 우선·구 정리 / 손상 구 JSON·비문자 → 안전(빈/스킵).
  - `setInfo`: 빈 메모 → memo 삭제 / 미설정 category/amount 미저장 / `getInfo` 기본값 / `pruneInfo` / `clearInfo`.
- `amount.test.ts`: 유효 0이상 정수 → number / 음수·소수·빈·비숫자·≥10^10 → undefined / `formatAmount` 천단위+₩·`0`→"₩0"·`undefined`→"—".
- 기존 `memo.test.ts`(있으면)·`defaultMemoText` 사용처가 깨지지 않음.

## Acceptance Criteria
```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차
1. 위 AC 실행.
2. 체크리스트: 마이그레이션 멱등·무손실·손상안전 / setInfo 미설정 미저장 / 금액 경계 거부 / 카테고리 미설정=값 없음 / **`defaultMemoText` import 경로 무파손** / 로컬 전용(서버 미전송) / 기존 테스트 무파손.
3. `phases/08-ui-v0-v11-logic/index.json` step 2 업데이트(성공→completed+summary / 3회 실패→error / 외부개입→blocked).

## 금지사항
- `defaultMemoText` 의 import 경로·시그니처를 깨뜨리지 마라. 이유: `ShipmentCard`·목록·상세가 이를 import — 깨지면 09 phase 의 stash pop(삭제 UX) 가 컴파일 실패한다.
- 메모/타이틀 표시 규칙(중단·좌측·primary·대체문구)을 바꾸지 마라. 이유: UI_GUIDE 회귀-락(사용자 요구).
- 카테고리·금액을 서버에 전송하지 마라. 이유: 로컬 전용(ADR-024) — 가계부 서버 집계는 Phase 2.
- "미지정" 의사 카테고리 값을 만들지 마라. 이유: 미설정 = 값 없음(칩 없음), `기타` 는 실제 catch-all(보강⑥) — 혼동 금지.
- 마이그레이션을 비멱등하게(2회 실행 시 데이터 변형) 만들지 마라. 이유: bootstrap 재실행·중복 호출에도 안전해야 한다.
- 기존 테스트를 깨뜨리지 마라.
