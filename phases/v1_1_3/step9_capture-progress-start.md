# Step 9: capture-progress-start (#6 % 버그 — 진행률을 사진 선택(=OCR 시작) 시점부터 시작)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-045** 전문 + 특히 **"개정 2(2026-06-30 · #6 % 시작 시점 버그)"** — % 램프는 picker 열기 전이 아니라 **`onImagePicked`(사진 선택 직후·OCR 전)** 부터 시작해야 한다.
- `/docs/UI_GUIDE.md` — "진행 표시 (v1.1.3 · ADR-045)" 항.
- `app/src/lib/capture.ts` — **수정 대상 1.** 현재 `capturePurchaseText(): Promise<CaptureResult>` — `ImagePicker.launchImageLibraryAsync` 로 uri 획득 → `if (!uri) return {kind:"canceled"}` → `recognizeText(uri)`(OCR) → empty/ok 반환. **이미지·OCR 원문 기기이탈 금지(ADR-036·005) 불변** — 텍스트만 반환.
- `app/app/shipment/[id].tsx` — **수정 대상 2.** `onCaptureFill`(현재):
  - `208~209`: `setCaptureProgress(0); setCaptureStage("ocr");` — **`capturePurchaseText()` 호출(`211`) 전**(이게 버그: picker 여는 동안 램프가 돌아 사진 선택 시점에 이미 % 가 올라가 있음).
  - `211`: `const cap = await capturePurchaseText();`.
  - `222`: `setCaptureStage("classify")`(classifyPurchase 전) — 그대로.
  - 성공 100% 스냅·`catch`/empty/canceled 클리어·`captureProgress`/`captureStage`/타이머(step 8) — **동작 유지**.

## 작업

두 파일. **JS 전용**(네이티브 리빌드 무관 — Metro 리로드 반영).

### (A) `app/src/lib/capture.ts` — `onImagePicked` 콜백
- `capturePurchaseText` 에 옵션 인자 추가: `capturePurchaseText(opts?: { onImagePicked?: () => void }): Promise<CaptureResult>`.
- **picker 가 uri 를 반환한 직후, `recognizeText`(OCR) 호출 직전**에 `opts?.onImagePicked?.()` 를 부른다. 즉 `if (!uri) return { kind: "canceled" }` **다음**, `const text = await recognizeText(uri)` **전**.
- 그 외(반환 타입·OCR·기기이탈 금지)는 **불변**. 콜백 1개만 추가.

### (B) `app/app/shipment/[id].tsx` — init 을 onImagePicked 로 이동
- `capturePurchaseText()` **호출 전의** `setCaptureProgress(0); setCaptureStage("ocr");`(현재 `208~209`)를 **제거**한다.
- 대신 `capturePurchaseText({ onImagePicked: () => { setCaptureProgress(0); setCaptureStage("ocr"); } })` 로 호출해, **사진이 선택된 순간(OCR 시작 직전)** 에 오버레이·램프를 켠다.
- 결과: picker 가 열려 있는 동안(사진 고르는 중)엔 오버레이·% 가 **안 뜬다**. 사진 선택 → 0% 에서 시작해 오른다. **picker 취소 시 `onImagePicked` 미발화 → 오버레이 안 뜸**(기존 취소 시 깜빡임도 해소).

**핵심 규칙(ADR-045 개정 2 — 위반 금지):**
- stage/progress 를 **`capturePurchaseText`(picker) 호출 전에 켜지 마라** — picker 동안 램프가 돌아 % 가 미리 오른다(이 버그의 원인).
- `classify` 단계·성공 100% 스냅·취소/empty/실패 클리어·타이머 누수가드(step 8)·폴백 `Alert`·**ADR-005 미로그**·`recognizeText` 기기이탈 금지 — 전부 **불변**.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

> ⚠️ `capture.ts` 는 coverage 제외(네이티브 경계·P-10) — onImagePicked 실 호출 타이밍은 시뮬에서 확인. 자동 AC는 typecheck/test green(시그니처 변경이 컴파일되는지).

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처/회귀 체크리스트:
   - `capturePurchaseText` 가 uri 획득 후·`recognizeText` 전에 `onImagePicked` 호출(취소 시 미발화).
   - `onCaptureFill` 이 picker 호출 **전**엔 stage/progress 를 켜지 않고, `onImagePicked` 안에서만 켠다.
   - classify/100%/폴백/타이머/ADR-005 동작 불변.
3. 결과에 따라 `phases/v1_1_3/index.json` 의 step 9 를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "capture.ts onImagePicked 콜백(uri 후·OCR 전) + onCaptureFill 이 stage/progress 를 picker 전이 아닌 onImagePicked 에서 켜 % 가 사진 선택 시점부터 0→ 오름. 취소 시 오버레이 미표시. JS 전용."`.
   - 수정 3회 실패 → `"status": "error"`, `"error_message": "..."`.

## 금지사항

- stage/progress 초기화를 `capturePurchaseText()` 호출 전에 두지 마라. 이유: picker(사진 고르는 시간) 동안 램프가 돌아 % 가 미리 오른다 — 이 step이 고치는 바로 그 버그(ADR-045 개정 2).
- `recognizeText`·이미지 URI 를 외부로 보내거나 로그하지 마라. 이유: 이미지·OCR 원문 기기이탈 금지(ADR-036·005).
- step 8 의 램프/100% 스냅/타이머 누수가드/폴백을 바꾸지 마라. 이유: surgical — 이 step은 **시작 시점**만 옮긴다(onImagePicked).
- 기존 테스트를 깨뜨리지 마라.
