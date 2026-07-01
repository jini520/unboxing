# Step 8: capture-progress-percent (#6 보강 — 캡처 분석 추정 진행률 % 표시)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-045**(캡처 분석 진행 표시) 전문 + **그 안의 "개정(2026-06-30 · #6 보강)"** — 추정 진행률 % 규칙(스테이지 가중·이징 점근·완료 시 100% 스냅).
- `/docs/UI_GUIDE.md` — "v1.1.2 — 캡처로 채우기" 의 **진행 표시 (v1.1.3 · ADR-045)** 항(오버레이 + 단계 텍스트 + **추정 % ** + 회귀 금지).
- `app/app/shipment/[id].tsx` — **이 step의 유일한 수정 대상.** step 6 에서 만든 오버레이를 보강한다. 현재:
  - `93~94`: `const [captureStage, setCaptureStage] = useState<null | "ocr" | "classify">(null); const capturing = captureStage !== null;`.
  - `onCaptureFill`: `setCaptureStage("ocr")`(`164`, `capturePurchaseText` 전) → `setCaptureStage("classify")`(`173`, `classifyPurchase` 전) → 자동채움 → `catch`(폴백 Alert) → `finally setCaptureStage(null)`(`184`).
  - 오버레이 JSX: `captureOverlay` View(`587`) > `captureOverlayBg`(`588`) > `<ActivityIndicator size="large">`(`589`) > `captureStageText`(`590~591`, `이미지 인식 중…`/`상품 분석 중…`).
  - 스타일: `captureOverlay`(`759`)·`captureOverlayBg`(`761`)·`captureStageText`(`762`).
- `app/src/theme/layout.ts`·`tokens.ts` — 큰 % 숫자 타이포(`fontSize.title1`/`title2` 등)·색 토큰.

## 작업

`app/app/shipment/[id].tsx` **한 파일만** 수정한다. **JS 전용**(네이티브 리빌드 무관 — Metro 리로드로 반영).

### (A) 진행률 상태 + 타이머
- `progress` 상태(0~100, number) 추가 + 타이머 `useRef`(`setInterval` 핸들).
- **이징 점근 램프**(원자적 호출이라 실제 세밀 진행 없음 — 추정): `captureStage` 에 따라 천장을 두고 그쪽으로 부드럽게 증가시키되 **단계 전환 전엔 천장에 못 닿게**:
  - `captureStage === "ocr"` → 천장 **45**.
  - `captureStage === "classify"` → 천장 **90**.
  - 매 틱(예: ~120ms) `setProgress(p => p + Math.max(1, Math.round((ceiling - p) * 0.08)))`, `ceiling` 도달 시 멈춤(이징이라 점근).
- **완료(성공)**: 분석이 성공해 자동채움까지 끝나면 `progress` 를 **100 으로 스냅**하고 **~250ms 유지 후** 오버레이를 닫는다(`setCaptureStage(null)` + `progress` 0 리셋). 현재 `finally` 의 즉시 `setCaptureStage(null)` 를 성공 경로에선 짧은 지연으로 바꾸되, **취소(`canceled`)·empty·`catch`(실패) 경로는 즉시 클리어**(% 0·오버레이 제거)하고 기존 폴백 `Alert` 그대로.
- 타이머는 `captureStage` 가 `null` 이 되면 반드시 `clearInterval`(언마운트 cleanup 포함) — 누수 금지.

### (B) 오버레이에 % 표시
- `captureOverlay` 안(스피너·단계 텍스트와 함께)에 **큰 % 숫자**(`{progress}%`)를 표시. 단계 텍스트와 한 줄로(`상품 분석 중… 72%`) 두거나 % 를 별도 큰 숫자로 — UI_GUIDE 톤. 색은 `tokens.text.body`/`accent`, 타이포는 프리미티브.
- **스피너·단계 텍스트는 유지**(제거 금지).

**핵심 규칙(ADR-045 개정 — 위반 금지):**
- **완료 전 100% 표시 금지** — 이징 천장(45/90)으로 막는다. 100% 는 **성공 직후에만**.
- 단계는 여전히 **OCR/분류 두 경계만**(가짜 중간 단계 금지). % 는 추정치(정확도 보장 아님).
- **폴백 전부 보존**: canceled 조용히·empty/`catch` Alert·직접 입력 흐름 안 멈춤(ADR-039). 오버레이/`Alert` 가림 금지. **ADR-005**(OCR 원문·에러 미로그) 불변.
- `capture.ts` 네이티브 경계 무수정. 타이머 누수 금지(clear 철저).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

> ⚠️ 실제 % 애니메이션·단계 전환은 시뮬에서 확인(`capture.ts` 는 coverage 제외 — P-10). 자동 AC는 typecheck/test green 까지. JS 전용이라 리빌드 없이 Metro 리로드로 동작.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처/회귀 체크리스트:
   - `progress` 가 ocr 구간 ~45, classify 구간 ~90 천장으로 점근(완료 전 100% 없음), 성공 시 100% 스냅 후 종료.
   - 취소·empty·실패 경로는 즉시 % 0·오버레이 제거 + 기존 Alert.
   - 타이머 `clearInterval`(stage null·언마운트) — 누수 없음.
   - 스피너·단계 텍스트 유지, capture.ts 무수정, ADR-005 미로그.
3. 결과에 따라 `phases/v1_1_3/index.json` 의 step 8 을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "캡처 오버레이에 추정 진행률 %(setInterval 이징 점근·ocr45/classify90 천장·성공 100% 스냅·실패/취소 즉시 클리어·타이머 누수가드). 단계텍스트·스피너 유지·폴백·ADR-005 불변. JS 전용."`.
   - 수정 3회 실패 → `"status": "error"`, `"error_message": "..."`.

## 금지사항

- 완료 전에 100%를 표시하지 마라. 이유: 이징 천장(45/90)으로 막아야 — 실제 끝나기 전 100%는 거짓 신호(ADR-045 개정 회귀 락).
- 가짜 중간 단계/세부 %를 실제 진행처럼 만들지 마라. 이유: OCR·분류는 원자적 호출 — % 는 명시적 추정치(사용자 합의).
- 폴백(canceled·empty·catch Alert·직접 입력)을 제거하거나 오버레이로 가리지 마라. 이유: 캡처는 보조, 어느 단계가 죽어도 입력 흐름 유지(ADR-039).
- `setInterval` 을 clear 하지 않고 두지 마라. 이유: 타이머 누수 → 리렌더·상태 오염.
- `capture.ts`·모달 다른 부분(헤더·저장·필드)을 손대지 마라. 이유: surgical — 이 step은 progress 상태 + 오버레이 % 표시만.
- 기존 테스트를 깨뜨리지 마라.
