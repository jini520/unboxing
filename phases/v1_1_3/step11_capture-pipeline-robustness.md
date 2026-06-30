# Step 11: capture-pipeline-robustness (코드리뷰 #2/#3/#6 — 캡처 상태머신 견고화 + 정리 #9/#10)

> 캡처 분석 파이프라인(`onCaptureFill` + ramp/hold effect + `clearCapture`)의 정확성 3건 + 정리 2건. 코드리뷰(xhigh) 검출. **JS 전용**(네이티브 무관).

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-045** 전문 + 그 **"개정 3(2026-06-30 · 코드리뷰 #2/#3/#6 ...)"** 절(이 step 의 SoT). **ADR-039**(캡처는 직접 입력의 보조·폴백 불변)·**ADR-005**(OCR 원문·에러 미로그)·**ADR-034**(모달 닫기 = `Keyboard.dismiss` 아닌 모달 닫기).
- `/docs/ENGINEERING.md` — **P-12 F1·F2·F3**(재진입 ref 가드·언마운트 active 가드·오버레이 탈출구). 같은 파일 `saveEdit` 의 **`saving.current` 동기 ref 가드** 패턴(이미 존재 — 이걸 그대로 본뜬다).
- `app/src/lib/capture.ts` — `capturePurchaseText(opts?)` 계약(수정 금지·읽기만).
- `app/src/lib/api.ts` — `classifyPurchase` → `request()` 가 주입 `fetch` 를 **타임아웃 없이** 호출(읽기만 — 이 step 에서 타임아웃 도입 안 함).
- `app/app/shipment/[id].tsx` — **유일한 수정 대상.** 현재 상태를 꼼꼼히 읽어라:
  - `captureStage`(`null`/`"ocr"`/`"classify"`)·`capturing = captureStage !== null`·`captureProgress`·`captureTimerRef`(ramp setInterval)·`captureHoldRef`(성공 100% 250ms setTimeout).
  - **ramp 효과**(`[captureStage]` — ceiling 45/90 이징, cleanup 에서 clearInterval).
  - **언마운트 효과**(`[]` — `captureHoldRef` 만 clearTimeout).
  - **`clearCapture`**(취소·empty·실패 — interval/timeout clear + stage null + progress 0).
  - **`onCaptureFill`**(`if (capturing) return` 진입 가드 → `capturePurchaseText({ onImagePicked })` → mask → `setCaptureStage("classify")` → `classifyPurchase` → 매핑 → 성공 100% 스냅+hold setTimeout / catch `clearCapture`+Alert).
  - **info `Modal`**(`onRequestClose={() => setInfoModal(false)}`)·**`ModalHeader`** ✕(`onClose={() => setInfoModal(false)}`)·**캡처 오버레이**(absolute, `modalCard` 전체를 덮음 — ✕·취소 포함).

## 작업

`app/app/shipment/[id].tsx` **한 파일만** 수정한다. 4가지를 적용하되 **% 이징·단계 경계·폴백·ADR-005 는 전부 불변**.

**① 동기 재진입 ref 가드 (#2)**
- `capturing` 은 `captureStage` 파생이라 stage 를 켜는 `onImagePicked`(picker 가 사진 반환 후) **전 await 구간에 두 번째 탭이 통과**한다 → picker 2개·헛된 실패 Alert.
- `saveEdit` 의 `saving.current` 처럼 **동기 ref 가드**를 둔다:
  ```ts
  const captureBusy = useRef(false);
  // onCaptureFill 맨 앞:
  if (captureBusy.current || capturing) return;
  captureBusy.current = true;
  // 종료(성공/취소/empty/실패)·clearCapture 에서 반드시 false 로 되돌린다.
  ```
- `onCaptureFill` 의 모든 종료 경로(취소·empty·성공 hold 진입·catch)에서 `captureBusy.current = false`. `clearCapture` 안에서도 `captureBusy.current = false`.

**② 언마운트 active 가드 (#6)**
- 분류 중 화면 이탈 시 `[]`-cleanup 이 먼저 돌아도 그 뒤 `await classifyPurchase` 가 resolve 하며 **cleanup 이후 hold setTimeout 을 새로 만들어** 누수된다.
- async 함수가 보는 **`active` ref** 를 두고(언마운트 효과에서 `active.current = false`), `onCaptureFill` 의 **await 재개 지점마다** `if (!active.current) return;`(특히 `classifyPurchase` 직후, setState·hold 타이머 만들기 전).

**③ 탈출구 — 모달 닫기 = 캡처 취소 (#3)**
- 오버레이가 ✕·취소를 덮고 `classifyPurchase` 엔 타임아웃이 없어 지연 시 갇히고, ✕/back 은 `setInfoModal(false)` 만 해 파이프라인이 계속 돌아 **닫힌 모달 위로 폴백 Alert** 이 뜬다.
- "택배 정보" 모달을 닫는 **모든 경로**(헤더 ✕ `onClose`·`Modal` `onRequestClose`·하단 취소)를 **하나의 핸들러**로 묶어 `setInfoModal(false)` **+ `clearCapture()`** 를 함께 호출한다:
  ```ts
  const closeInfoModal = useCallback(() => { clearCapture(); setInfoModal(false); }, [clearCapture]);
  ```
  세 곳(`ModalHeader onClose`·`Modal onRequestClose`·하단 취소 `Pressable onPress`)을 `closeInfoModal` 로 교체.
- **네트워크 타임아웃은 도입하지 않는다**(범위 밖 — 공용 `request` 를 건드리지 않음). 탈출구로 충분.

**④ 정리 (#9·#10)**
- 성공 100% 스냅 시 **ramp `setInterval` 을 즉시 clear**(hold 250ms 동안 헛도는 tick 제거). (`captureTimerRef` clear)
- teardown 로직 중복 정리 — `clearCapture` 가 단일 출처가 되게(hold setTimeout body·언마운트 효과가 같은 정리를 부분적으로 반복하지 않게). 단, 언마운트 효과는 `active.current=false` + 타이머 clear 책임 유지.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

> ⚠️ 더블탭·언마운트·지연은 타이밍이라 jest 무관(P-12). dev build 스모크(ENGINEERING #7②③⑤)는 step 15 게이트.

## 검증 절차

1. 위 AC 실행.
2. 회귀 체크리스트:
   - `captureBusy` ref 가 `onCaptureFill` 진입 즉시 set·모든 종료/`clearCapture` 에서 false.
   - `active` ref 로 언마운트 후 setState/타이머 생성 차단(await 재개마다 가드).
   - ✕·`onRequestClose`·취소 셋 다 `clearCapture()` 호출(모달 닫기=캡처 취소).
   - 성공 시 ramp interval 즉시 clear. teardown 중복 제거.
   - **불변**: % 이징 천장(45/90·완료 전 100% 금지)·OCR/분류 단계 경계·폴백(취소/empty/실패 Alert·직접입력 흐름)·ADR-005 미로그.
3. `phases/v1_1_3/index.json` step 11 갱신(성공 → completed + summary / 3회 실패 → error).

## 금지사항

- 재진입 가드를 `captureStage`(setState) 파생에만 의존하지 마라. 이유: stage 켜기 전 await 구간에 두 번째 탭이 통과한다(P-12 F1).
- `classifyPurchase`/공용 `request` 에 네트워크 타임아웃을 넣지 마라. 이유: 모든 API 호출 동작을 바꾸는 비-surgical 변경 — 이 step 은 탈출구(모달 닫기=취소)로 해소한다(ADR-045 개정3 범위).
- % 이징·OCR/분류 단계 텍스트·폴백 Alert·ADR-005 미로그 동작을 바꾸지 마라. 이유: 회귀 락.
- 오버레이가 폴백 `Alert`(네이티브) 을 가리게 만들지 마라. 이유: ADR-045 불변.
- 기존 테스트를 깨뜨리지 마라.
