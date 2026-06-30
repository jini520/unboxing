# Step 3: capture-ux (캡처로 채우기 — OCR·picker·모달 통합)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/app/AGENTS.md` — **Expo는 바뀌었다. v56 문서(https://docs.expo.dev/versions/v56.0.0/)를 코드 작성 전 반드시 확인**(`expo-image-picker`·네이티브 모듈·config plugin).
- `/docs/ADR.md` — **ADR-036**(온디바이스 OCR·이미지 기기이탈 금지)·**ADR-039**(택배 정보 모달 통합·직접 입력 병행).
- `/docs/UI_GUIDE.md` — "v1.1.2 — 캡처로 채우기"(진입·단계적 표시·폴백·회귀 락).
- `/docs/ARCHITECTURE.md` — "v1.1.2" 파이프라인 전체.
- **이전 step 산출물**: `app/src/lib/purchaseMask.ts`(step 1), `app/src/lib/purchase.ts`(step 2), worker `POST /classify-purchase`(step 0). 이들을 와이어한다.
- `app/app/shipment/[id].tsx` — **"택배 정보" 모달**(`infoModal` ~398행, 메모·카테고리 칩·금액). 여기에 "캡처로 채우기" 추가.
- `app/src/lib/api.ts` — 서버 호출 패턴(`POST /classify-purchase` 호출 추가).
- `app/src/lib/info.ts` — 기존 `setInfo`(저장은 이걸 재사용).

## 작업

"택배 정보" 모달에 **"캡처로 채우기"** 를 추가하고 파이프라인을 와이어한다. **기존 직접 입력은 그대로 유지**(병행·ADR-039).

### 1. 네이티브 의존성
- **`expo-image-picker`** 추가(이미지 선택). Expo v56 문서대로 설치·권한.
- **온디바이스 OCR**: `@react-native-ml-kit/text-recognition`(iOS·Android ML Kit·한국어·온디바이스) 추가. dev build 리빌드 필요. **Expo SDK 56 호환·config plugin/prebuild 필요 여부를 문서로 먼저 확인**하라(AGENTS.md). 대안 라이브러리가 더 적합하면 ADR-036(온디바이스·무료·한국어) 제약 안에서 선택하고 사유를 summary 에 남겨라.

### 2. 파이프라인 와이어 (모달 "캡처로 채우기" 탭 시)
1. `expo-image-picker` 로 스크린샷 선택.
2. **온디바이스 OCR** → 텍스트(읽기순서). 0줄 → "인식 실패, 다시 촬영" 폴백.
3. **`maskPurchaseText`**(step 1) 로 마스킹 → **마스킹 텍스트만** `POST /classify-purchase`(step 0)로 전송. **이미지·원문 절대 전송 금지.**
4. 응답 → **`mapClassificationToInfo`**(step 2) → 모달의 메모·금액·카테고리 칩 **드래프트에 자동 채움**.
5. 사용자가 기존 칩/필드로 교정 → **기존 저장 경로**(`saveInfo`/`setInfo`)로 저장.

### 3. 단계적 표시·폴백 (UI_GUIDE)
- 상품명·가격은 OCR/분류 직후 먼저 채우고, **카테고리는 "분류 중" 스피너**로 비동기 표시(체감 레이턴시↓).
- 분류 5초+/한도초과/JSON 깨짐 → 카테고리 "미분류" + 수동 선택. **어느 단계가 죽어도 직접 입력·저장 흐름은 안 멈춘다.**

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 통과
```

> ⚠️ `verify`(jest/typecheck)는 **OCR·이미지 picker·실 분류 호출(네이티브·외부 경계)을 못 잡는다.** 자동 AC 는 typecheck/test green 까지. 실 동작은 step 4 스모크.

## 검증 절차

1. 위 AC 실행.
2. 회귀/아키텍처 체크리스트:
   - **직접 입력(메모·카테고리 칩·금액) 경로가 그대로 살아 있는가?**(캡처는 보조 — ADR-039·UI_GUIDE 회귀 락) 캡처를 강제 단계로 만들지 않았는가?
   - 서버로 **마스킹 텍스트만** 가는가? **이미지·원문 PII 전송 0**(ADR-036)?
   - OCR 0줄·분류 실패·한도 시 **폴백**으로 흐름이 안 멈추는가?
   - Expo v56 문서대로 `expo-image-picker`·OCR 네이티브를 썼는가?
   - 자동 채움 값이 **편집 가능한 드래프트**인가(확정 강제 아님)?
3. `phases/v1_1_2/index.json` step 3 업데이트(실 스모크가 step 4 에 남았음을 명시). 네이티브 리빌드·라이브러리 설치가 막히면 `blocked`(구체 사유).

## 금지사항

- 직접 입력 경로를 제거하거나 캡처를 필수 단계로 만들지 마라. 이유: 캡처는 보조다(ADR-039·마찰 최소 CLAUDE.md).
- 이미지나 마스킹 안 된 원문을 서버로 보내지 마라. 이유: PII 기기이탈 금지(ADR-036·005). `maskPurchaseText` 통과분만 전송.
- 추출 결과·캡처를 D1·서버에 저장하지 마라. 이유: 개인정보 비영속(ADR-005). 저장은 기존 로컬 `setInfo` 만.
- `purchaseMask`·`mapClassificationToInfo` 로직을 이 화면에 다시 구현하지 마라. 이유: step 1·2 순수함수 재사용.
- 기존 테스트를 깨뜨리지 마라.
