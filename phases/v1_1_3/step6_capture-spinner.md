# Step 6: capture-spinner (#6 캡처 분석 진행 — 모달 오버레이 + 단계 스피너)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/app/AGENTS.md` — **Expo v56 문서 확인 후 구현.** 특히 `ActivityIndicator`·`Modal`·`StyleSheet`(absolute 오버레이).
- `/docs/ADR.md` — **ADR-045**(캡처 분석 진행 표시 = 모달 오버레이 + 단계 스피너, OCR/분류 두 경계만, 폴백·ADR-005 불변) 전문. **ADR-039**(캡처는 직접 입력의 보조·폴백 누락 금지)·**ADR-037**(분류 1콜 반환).
- `/docs/UI_GUIDE.md` — "v1.1.2 — 캡처로 채우기" 섹션의 **진행 표시 (v1.1.3 · ADR-045)** 항(오버레이·단계 텍스트·회귀 금지)과 **폴백(누락 금지)** 항.
- `/docs/ENGINEERING.md` — **P-10**(OCR 네이티브 모듈·`capture.ts` coverage 제외) — 캡처 경계는 jest 무관, 실 동작은 dev build 스모크.
- `app/app/shipment/[id].tsx` — **이 step의 유일한 수정 대상.** 현재 상태를 꼼꼼히 읽어라:
  - `155~178` `onCaptureFill`: ① `capturePurchaseText()`(이미지 선택+OCR) `159` → empty/canceled 분기 `160~164` → ② `maskPurchaseText` `165` → ③ `classifyPurchase(masked, apiDeps)` `166` → ④ `mapClassificationToInfo` + 드래프트 자동채움 `167~171` → catch(폴백 Alert) `172~174` → finally `setCapturing(false)` `175~177`.
  - `capturing` 상태(현재 boolean): `setCapturing(true)` `157`, `setCapturing(false)` `176`, 선언부는 다른 `useState` 근처(예: `setInfoModal` `84` 부근).
  - 캡처 버튼 `454~470`(infoModal 카드 안): `disabled={capturing}`·`opacity: capturing ? 0.6 : 1`·`capturing ? <ActivityIndicator/> : <Camera/>`·`{capturing ? "분석 중…" : "캡처로 채우기"}`.
  - 모달 카드 구조: `modalAvoider`(`448` KeyboardAvoidingView) > `modalCard`(`450` `Pressable`) > `ModalHeader`(`452`) > 캡처 버튼(`454`) > `ScrollView`(`471` 필드들). `ActivityIndicator` 이미 import(`8`).
- `app/src/theme/tokens.ts`·`layout.ts` — 오버레이 배경(표면색 위 반투명)·스피너 `accent`·텍스트·간격 토큰.

## 작업

`app/app/shipment/[id].tsx` **한 파일만** 수정한다(ADR-045).

### (A) 단계 상태
- `capturing: boolean` 을 **`captureStage: null | "ocr" | "classify"`** 로 바꾼다(또는 추가). `capturing` 이 쓰이던 곳은 **`captureStage !== null`** 로 파생.
- `onCaptureFill` 에서 **실제 두 함수 경계에만** stage 를 set:
  - `capturePurchaseText()` 호출 전 → `setCaptureStage("ocr")`.
  - `classifyPurchase()` 호출 전 → `setCaptureStage("classify")`.
  - `finally` → `setCaptureStage(null)`(현재 `setCapturing(false)` 자리).
- 진입 가드(`if (capturing) return`)는 `captureStage !== null` 로 유지.

### (B) 오버레이 + 단계 스피너
- `modalCard` 안에 **`captureStage !== null` 일 때만** 렌더되는 **absolute 오버레이**를 둔다: 카드 영역을 덮는 반투명 배경(표면색 베이스) + 중앙 `<ActivityIndicator size="large" color={tokens.accent}>` + 단계 텍스트.
- 단계 텍스트: `captureStage === "ocr"` → **"이미지 인식 중…"**, `"classify"` → **"상품 분석 중…"**.
- 오버레이는 `pointerEvents` 로 분석 중 카드 필드 오터치를 차단(터치 흡수). 색·간격은 토큰/프리미티브만(하드코딩·그라데이션/네온 금지).
- 캡처 버튼은 분석 중 `disabled`(기존 유지). 버튼 인라인 인디케이터는 오버레이로 대체되므로 단순화 가능(버튼은 흐림/비활성, 진행은 오버레이가 표시).

**핵심 규칙(ADR-045·ADR-039 — 위반 금지):**
- 단계는 **OCR/분류 두 경계로만**. 가짜 중간 단계(가짜 % 등)를 만들지 마라. 분류는 1콜 반환(ADR-037)이라 필드별 부분 단계 없음.
- **폴백 전부 보존**: canceled → 조용히 return(Alert 없음), empty → "글자를 인식하지 못했어요" Alert, catch → "지금은 캡처로 채울 수 없어요" Alert. 오버레이가 이 Alert 을 가리거나 막지 않게(stage 는 finally 에서 null 로 — Alert 은 그 위에 뜸).
- **ADR-005**: OCR 원문·에러 미로그(기존 주석 유지). 캡처 경로 실패해도 직접 입력 흐름 안 멈춤(ADR-039).
- 이미지 picker 는 풀스크린이라 `이미지 인식 중…` 오버레이는 picker 종료 후 보임 — `capturePurchaseText` 를 쪼개 pick/OCR 를 분리하지 마라(capture.ts 네이티브 경계 무수정).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

> ⚠️ 오버레이·스피너·단계 전환의 실 동작은 dev build 캡처에서만(`capture.ts` 는 coverage 제외 — P-10). 자동 AC는 typecheck/test green 까지. 실 동작은 dev build 수동 스모크(#6 — PRD DoD).

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처/회귀 체크리스트:
   - `captureStage` 가 `capturePurchaseText` 전 `"ocr"`, `classifyPurchase` 전 `"classify"`, finally `null` — 두 경계로만.
   - 오버레이가 `captureStage !== null` 일 때만 렌더, 단계 텍스트가 ocr→"이미지 인식 중…" / classify→"상품 분석 중…".
   - 폴백(canceled 조용히·empty/catch Alert·직접 입력) 동작 불변, ADR-005 미로그 유지.
   - 색·간격 토큰/프리미티브만, capture.ts 무수정.
3. 결과에 따라 `phases/v1_1_3/index.json` 의 step 6 을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "captureStage(ocr/classify) 단계 + 모달 오버레이 스피너·단계텍스트 / 폴백·ADR-005 불변. dev build 오버레이 스모크는 #6 수동 게이트."`.
   - 수정 3회 실패 → `"status": "error"`, `"error_message": "..."`.

## 금지사항

- 가짜 진행 단계(중간 %·필드별 단계)를 만들지 마라. 이유: 분류는 1콜 반환(ADR-037) — 실제 단계는 OCR/분류 둘뿐(ADR-045 회귀 락).
- 폴백 Alert·canceled 조용히·직접 입력 흐름을 제거하거나 오버레이로 가리지 마라. 이유: 캡처는 보조이고 어느 단계가 죽어도 입력 흐름은 안 멈춰야 함(ADR-039).
- `capture.ts`(네이티브 OCR 경계)를 수정하지 마라. 이유: pick/OCR 분리는 불필요하고 coverage 제외 경계다(P-10) — 진행 표시는 `[id].tsx` 의 stage 로 충분.
- OCR 원문·에러를 로그/전송하지 마라. 이유: ADR-005 비영속·미로그.
- 모달 다른 부분(헤더·저장 버튼·필드·ADR-034 backdrop)을 "개선"하지 마라. 이유: surgical — 이 step은 stage 상태 + 오버레이만.
- 기존 테스트를 깨뜨리지 마라.
