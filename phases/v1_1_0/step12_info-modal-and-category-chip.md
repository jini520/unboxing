# Step 12: 택배 정보 모달 확장 + 카드 카테고리 칩

상세 화면의 메모 편집 모달을 **메모 + 카테고리 + 금액**(택배 정보) 편집으로 확장하고, 송장 카드에 작은 카테고리 칩을 보조 표시한다(모두 **로컬 전용**, ADR-024). 카테고리·금액 규칙과 스토어는 phase 08 이 제공한다 — **소비**한다. 메모 진입 규칙·표시 규칙은 **회귀 락**이라 그대로 유지한다.

## 읽어야 할 파일

- `/docs/UI_GUIDE.md` — "택배 정보 모달"(line 196~200), 상세 행의 메모 모달 규칙(line 36 — 헤더 연필 → 모달, 인라인 박스 없음), "송장 카드 해부"/회귀 락, 카드 카테고리 칩(line 200·208), 신규 글리프 `Tag`·₩ 접두(line 281)
- `/docs/PRD.md` — "v1.1 기능 명세" 4(택배 정보·카테고리 목록·금액), 카드 칩(line 208)
- `/docs/ARCHITECTURE.md` — "v1.1 설계 보강 ⑥"(카테고리 미설정=값 없음·`기타`=catch-all·금액 0이상 정수, line 326~328), 앱 에러 매트릭스(금액 형식 오류, line 384)
- `/docs/ADR.md` — ADR-024(택배 정보 로컬 전용)
- **08 산출물**: `app/src/lib/info.ts`(`setInfo`·`getInfo`·`CATEGORIES`·`defaultMemoText`), `app/src/lib/amount.ts`(`parseAmount`·`formatAmount`)
- 코드: `app/app/shipment/[id].tsx`(상세 — 헤더 연필 `openMemo`·메모 모달 line 259·`headerTitle`·`saveMemo`), `app/src/components/ShipmentCard.tsx`(메모 표시 규칙), `app/src/components/icons/`(`Tag` 추가), `app/src/theme/`

## 작업

### 1. 정보 모달 확장 — `app/app/shipment/[id].tsx`
- 기존 헤더 연필 → 메모 모달을 **메모 + 카테고리 + 금액 3필드**로 확장한다. **본문 인라인 박스 추가 금지·헤더 연필 진입 규칙 유지**(회귀 락·사용자 요구). `headerTitle`(메모 || `defaultMemoText`)·메모 textarea 동작은 보존.
- **메모**: 기존 textarea(모달 내).
- **카테고리**: 고정 목록 `CATEGORIES`(08) 칩 또는 셀렉트. **선택 안 함이 기본(미설정=값 없음·칩 없음)** — 목록 마지막 `기타`는 실제 catch-all 카테고리이지 "미설정"이 아니다(혼동 금지).
- **금액**: 숫자 키패드 입력 + `₩` 접두/천단위 표시(`formatAmount`). 저장 전 `parseAmount` 로 **0 이상 정수만** 허용 — 음수·비정수·상한 초과·빈값은 **인라인 안내 + 저장 안 함**.
- 저장 = `setInfo(id, { memo, category, amount })`(로컬 `unboxing.shipment_info`). 빈 메모는 memo 필드 삭제, 카테고리 미설정·금액 빈값은 해당 필드 미저장.

### 2. 카드 카테고리 칩 — `app/src/components/ShipmentCard.tsx`
- 메모 줄 옆/아래에 작은 **카테고리 칩**(중립 또는 카테고리색, `Tag` 글리프). 카테고리 미설정이면 칩 없음.
- **메모 표시 규칙(중단·좌측·`primary`·대체문구 `defaultMemoText`)은 불변** — 칩은 보조(메모 줄을 밀어내거나 가리지 않는다).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차
1. 위 AC 실행(모달 저장·검증 분기는 통합 테스트 보류 가능[E-3]; `parseAmount`/`setInfo` 자체는 08 에서 단위 테스트됨). typecheck·기존 테스트 무파손.
2. 체크리스트: 헤더 연필 → 모달 진입 규칙 유지·본문 인라인 박스 없음(회귀 락) / 메모 표시 규칙 불변 / 카테고리 미설정=칩 없음(의사값 없음) / 금액 음수·비정수·상한 인라인 안내·미저장 / 카테고리·금액 로컬 저장만 / 색 토큰만.
3. `phases/09-ui-v0-v11-screens/index.json` step 4 업데이트(성공→completed+summary / 실패→error / 외부개입→blocked).

## 금지사항
- 상세 본문에 인라인 메모/정보 박스를 추가하지 마라. 이유: 편집은 헤더 연필 → 모달에서만(사용자 요구·UI_GUIDE 회귀 락).
- 메모 표시 규칙(중단·좌측·primary·대체문구)을 바꾸지 마라. 이유: 반복 회귀 항목 — 칩은 보조일 뿐.
- 금액을 음수·비정수·상한 초과로 저장하지 마라. 이유: `parseAmount` 계약(0 이상 정수만, 보강 ⑥).
- 카테고리·금액을 서버로 전송하지 마라. 이유: 로컬 전용(ADR-024) — 가계부 서버 집계는 Phase 2.
- "미지정" 의사 카테고리를 만들지 마라(미설정=값 없음). 기존 테스트를 깨뜨리지 마라.
