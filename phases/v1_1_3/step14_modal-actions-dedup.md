# Step 14: modal-actions-dedup (코드리뷰 cleanup #7 — 두 모달 푸터 복붙 제거)

> 정리(cleanup) 전용 — 정확성 변화 없음. "택배 정보"·"운송장 수정" 모달의 하단 액션 블록이 복붙이라 `ModalActions` 로 추출(이미 추출한 `ModalHeader` 와 대칭). 코드리뷰(xhigh) 검출 #7.

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-040** 전문 + 그 **"개정(2026-06-30 · 코드리뷰 cleanup #7 ...)"** 절(이 step 의 SoT). ①~④ 디자인(제목+✕ 헤더·구분선·채움형 저장 버튼·비활성 색 분기).
- `app/app/shipment/[id].tsx` — **유일한 수정 대상.** 꼼꼼히 읽어라:
  - 이미 추출된 **`ModalHeader({ title, onClose })`** 컴포넌트(파일 하단) — 추출 패턴의 본보기.
  - **"택배 정보" 모달 하단 액션**(취소 `Pressable` + 저장 `Pressable`) 블록과 **"운송장 수정" 모달 하단 액션** 블록 — 두 곳이 거의 동일(취소 텍스트 + 채움형 저장: `disabled`·`modalSaveBtn` 배경 `accent`/비활성 `bg.secondary`·라벨 `onAccent`/비활성 `text.disabled`). 다른 점은 `onCancel`/`onSave`/`disabled`(정보=`amountInvalid`, 수정=`editDisabled`)뿐.
  - 관련 스타일: `modalActions`·`modalCancel`·`modalSaveBtn`·`modalSave`.
  - **주의(step 11 선행)**: step 11 에서 "택배 정보" 모달의 **취소가 `closeInfoModal`(=clearCapture+close)** 로 바뀌어 있을 수 있다. `onCancel` 을 prop 으로 받으므로 그대로 위임하면 된다(정보 모달은 `closeInfoModal`, 수정 모달은 `setEditModal(false)`).

## 작업

`app/app/shipment/[id].tsx` **한 파일만** 수정한다. 두 모달의 하단 액션을 공통 컴포넌트로 추출(동작·픽셀 불변).

- `ModalHeader` 옆에 **`ModalActions`** 를 추가:
  ```ts
  function ModalActions({
    onCancel, onSave, saveDisabled,
  }: { onCancel: () => void; onSave: () => void; saveDisabled: boolean }) {
    const { tokens } = useTheme();
    // 기존 두 블록과 동일한 마크업: 취소(text·modalCancel) + 채움형 저장(modalSaveBtn·accent/bg.secondary, modalSave·onAccent/text.disabled).
    // a11y: accessibilityRole="button", accessibilityState={{ disabled: saveDisabled }}.
  }
  ```
- "택배 정보" 모달: `<ModalActions onCancel={closeInfoModal /* 또는 현행 취소 핸들러 */} onSave={saveInfo} saveDisabled={amountInvalid} />`.
- "운송장 수정" 모달: `<ModalActions onCancel={() => setEditModal(false)} onSave={() => void saveEdit()} saveDisabled={editDisabled} />`.
- 추출 후 **중복 마크업·중복 스타일 사용처를 정리**(스타일 객체 자체는 공유되므로 그대로 둠).

**불변(픽셀·동작):** 비활성 색 분기(`bg/secondary`+`text/disabled`)·채움형 저장(`accent`/`onAccent`)·취소 텍스트(`text/secondary`)·간격(`modalActions`)·a11y 상태. ADR-040 ①~④ 시각 유지.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 실행.
2. 회귀 체크리스트:
   - 두 모달이 `ModalActions` 사용·`onCancel`/`onSave`/`saveDisabled` 만 다름.
   - 시각(색·간격·비활성 분기)·a11y·동작 불변(순수 추출).
   - 정보 모달 취소가 step 11 의 닫기 핸들러(clearCapture 포함)를 위임하는지 확인(있다면).
3. `phases/v1_1_3/index.json` step 14 갱신(성공 → completed + summary / 실패 → error).

## 금지사항

- 저장 버튼 색을 `accent` 외(예: stage.*)로 바꾸지 마라. 이유: ADR-040 회귀 락.
- 비활성 색 분기나 a11y 상태를 빠뜨리지 마라. 이유: 순수 추출 — 동작 동일해야 함.
- 정보 모달 취소가 캡처 정리(step 11 `clearCapture`)를 잃지 않게 하라. 이유: 탈출구 회귀(코드리뷰 #3).
- 헤더(`ModalHeader`)·필드·캡처 버튼 등 다른 부분을 건드리지 마라. 이유: 이 step 은 푸터 추출만(surgical).
- 기존 테스트를 깨뜨리지 마라.
