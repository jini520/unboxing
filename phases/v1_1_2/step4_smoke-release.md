# Step 4: smoke-release (verify · 워커 배포 · e2e 스모크 · 버전 범프)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/docs/PRD.md` — "v1.1.2 완료 기준(DoD)" 전체.
- `/docs/ENGINEERING.md` — "실호출 체크리스트" · `CRITICAL: mock verify green 은 순수 로직만 보증` 원칙.
- `/CLAUDE.md` — 외부 경계(Workers AI·OCR·플랫폼) 실호출 1회 필수. worker 배포 커맨드.
- 이전 step 산출물: worker `POST /classify-purchase`(step 0), `purchaseMask`(1), `purchase`(2), `[id].tsx` 캡처 UX(3), `worker/wrangler.toml` `[ai]` 바인딩.
- `app/app.json` — 현재 `version: "1.1.1"`.

## 작업

### 1. 전체 verify
- `npm run verify` green 확인. red 면 원인 step 을 짚어 `error_message` 에 남긴다(이 step 에서 임의 수정 금지).

### 2. 워커 배포 (`[ai]` 바인딩 반영)
- `npm --prefix worker run deploy` 로 `POST /classify-purchase` + `[ai]` 바인딩을 운영에 반영. (배포는 외부 자격증명 필요 — 안 되면 `blocked: 배포 자격증명 필요`.)

### 3. 버전 범프
- `app/app.json` `version` `"1.1.1"` → `"1.1.2"`(ADR-035 패치 라인). buildNumber/versionCode 키 있으면 +1(없으면 생략·eas remote 자동).

### 4. e2e 실호출 스모크 (DoD — 머지·배포 전 1회, 외부 경계)
체크리스트로 남기고 가능하면 실행. **실행 불가(실 캡처·CF 자격증명 의존)면 미수행 명시**(거짓 통과 금지):
- **실 네이버페이 주문상세 캡처 1건** → 앱 "캡처로 채우기" → 온디바이스 OCR → `maskPurchaseText` → **마스킹 결과에 PII 누출 0**(이름·전화·주소·카드 없음) 육안+`detectResidualPII` 확인 → `POST /classify-purchase` → `{상품명·가격·카테고리}` 정확(예: 백팩·60,190·의류·패션) → 모달 자동 채움 → 편집·저장.
- 네트워크 캡처로 **서버에 이미지·원문 PII 가 안 갔는지**(마스킹 텍스트만) 확인.

## Acceptance Criteria

```bash
npm run verify   # 모두 green
```
- `app/app.json` `version` 이 `"1.1.2"`.

## 검증 절차

1. 위 AC 실행.
2. 체크리스트:
   - version `1.1.2` 범프됨.
   - 워커 배포 완료(또는 자격증명 부재로 blocked 명시).
   - e2e 스모크 2건(마스킹 누출 0·분류 정확·이미지 미전송)이 체크리스트로 남고, 미수행이면 summary 에 명시.
   - CLAUDE.md "mock green ≠ 런타임 정상" 대로 verify green 만으로 완료 단정 안 함.
3. `phases/v1_1_2/index.json` step 4 업데이트(성공 → completed + summary[배포·스모크 상태 명시] / verify red → error / 배포·자격증명 부재 → blocked).

## 금지사항

- 실행하지 않은 스모크를 "통과"로 적지 마라. 이유: 외부 경계는 실호출로만 검증(CLAUDE.md). 특히 **PII 누출 0** 은 실 캡처로만 최종 확인된다.
- step 0~3 코드를 이 step 에서 리팩터링하지 마라. 이유: 이 step 은 verify·배포·버전·스모크만.
- 버전을 마이너(1.2.0)로 올리지 마라. 이유: 패치 라인 v1.1.2(ADR-035).
- 기존 테스트를 깨뜨리지 마라.
