# Step 7: info-prefill (#7 "택배 정보" 모달 — 모든 열기 경로에서 저장값 prefill)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-046**("택배 정보" 모달 = 모든 열기 경로에서 저장값 prefill, 로드 효과에서 draft 미러) 전문. **ADR-043**(#4 등록후 자동오픈 딥링크)·**ADR-024/039**(택배 정보 = 로컬 ShipmentInfo·D1 미저장).
- `/docs/UI_GUIDE.md` — "v1.1.3" 섹션의 **저장값 prefill (#7 · ADR-046)** 항.
- `app/src/lib/info.ts` — `getInfo(id, {store})` 반환 형태(`ShipmentInfo`: `memo?`·`category?`·`amount?`)·`infoStore`.
- `app/app/shipment/[id].tsx` — **이 step의 유일한 수정 대상.** 현재 상태를 꼼꼼히 읽어라:
  - `88~90`: draft 상태 — `memoDraft`(`""`)·`categoryDraft`(`undefined`)·`amountDraft`(`""`).
  - `105~117`: **저장값 로드 효과** — `getInfo(id, {store: infoStore}).then((info) => { setMemoState(info.memo ?? ""); setCategory(info.category); setAmount(info.amount); })`. mount 시 1회(`[id]`), **비동기**.
  - `121~126`: **#4 자동오픈 딥링크 효과** — `openInfoParam === "1"` 이면 `setInfoModal(true)` **만**(현재 draft prefill **안 함** — 이게 빈 칸 버그).
  - `128~134`: **헤더 `openInfo` 콜백** — `setMemoDraft(memo)`·`setCategoryDraft(category)`·`setAmountDraft(amount === undefined ? "" : String(amount))` 후 `setInfoModal(true)`. **(이미 prefill — 유지)**.
  - `155~`: `onCaptureFill`(캡처 자동채움이 draft 를 덮음 — ADR-045, 이 동작 불변).

## 작업

`app/app/shipment/[id].tsx` **한 파일만** 수정한다(ADR-046). 목표: 헤더 버튼이든 #4 자동오픈이든 모달이 **저장값을 채운 채로** 열리게 한다.

- **저장값 로드 효과(`105~117`)의 `getInfo(...).then()`** 안에서 memo/category/amount 상태를 set 한 직후, **draft 도 같이 미러**한다:
  ```ts
  setMemoDraft(info.memo ?? "");
  setCategoryDraft(info.category);
  setAmountDraft(info.amount === undefined ? "" : String(info.amount)); // 헤더 openInfo 와 동일 포맷(순수 숫자 문자열)
  ```
- 이로써 #4 딥링크 경로(`setInfoModal(true)` 만)도 로드 완료 시점에 draft 가 채워져 저장값이 보인다. **딥링크 효과 자체는 수정 불필요**(로드 효과가 draft 를 채우므로).
- 헤더 `openInfo` 콜백(`128~134`)의 재-prefill 은 **그대로 둔다**(재오픈 시 미저장 편집 폐기 — 회귀 락).

**핵심 규칙(ADR-046 — 위반 금지):**
- 금액 draft 는 **순수 숫자 문자열**(미설정이면 `""`) — 헤더 `openInfo` 와 동일 포맷(₩·천단위 표시 전용은 입력 draft 에 넣지 않음).
- 캡처 자동채움(ADR-045·`onCaptureFill` 172~174)이 draft 를 덮는 동작은 **불변**(로드 효과는 mount 1회·캡처 전이라 충돌 없음).
- **서버·D1 무변경** — 로컬 draft 초기화만(ADR-024/039·005 불변). 새 저장 경로·API 추가 금지.
- 헤더 `openInfo` 재-prefill 을 제거하지 마라(재오픈 편집 폐기 유지).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

> ⚠️ 모달 열기 시 실제 prefill 표시는 시뮬/실기기에서 확인(네이티브 렌더). 자동 AC는 typecheck/test green.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처/회귀 체크리스트:
   - `getInfo(...).then()` 이 memo/category/amount **및 draft 3종**을 모두 set(저장값 미러).
   - 헤더 `openInfo` 콜백의 재-prefill 유지(제거 안 함).
   - 금액 draft 포맷이 헤더 경로와 동일(순수 숫자 문자열/`""`).
   - 캡처 자동채움·`setInfo` 저장 경로·서버/D1 무변경.
3. 결과에 따라 `phases/v1_1_3/index.json` 의 step 7 을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "getInfo 로드 효과에서 draft(memo/category/amount) 미러 → 헤더·#4 자동오픈 모두 저장값 prefill(비동기 안전). 헤더 재-prefill·캡처 자동채움 불변."`.
   - 수정 3회 실패 → `"status": "error"`, `"error_message": "..."`.

## 금지사항

- 헤더 `openInfo` 콜백의 재-prefill 을 제거하지 마라. 이유: 재오픈 시 미저장 편집을 저장값으로 되돌리는 동작 유지(ADR-046 회귀 락).
- 금액 draft 에 ₩·천단위 구분 문자열을 넣지 마라. 이유: 입력 draft 는 순수 숫자 문자열(파싱·헤더 경로 일관) — 표시 포맷은 별개.
- 저장(`setInfo`)·서버·D1 경로를 추가/변경하지 마라. 이유: 이 step은 **모달 열 때 draft 초기화**만(저장 동작 불변·ADR-024/039/005).
- 캡처 자동채움(ADR-045) 동작을 바꾸지 마라. 이유: surgical — 이 step은 저장값 로드→draft 미러만.
- 기존 테스트를 깨뜨리지 마라.
