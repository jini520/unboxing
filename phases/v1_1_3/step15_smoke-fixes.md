# Step 15: smoke-fixes (코드리뷰 수정 묶음 verify 재확인 + dev build 스모크 체크리스트)

> step 10~14(코드리뷰 정확성 5 + 정리 4) 후 회귀 게이트 재확인 + 타이밍/런타임 스모크 항목 기록. 서버·D1·버전 무변경(이미 step 5 에서 1.1.3).

## 읽어야 할 파일

- `/docs/ENGINEERING.md` — **P-12**(비동기 UI 파이프라인 상태머신 4대 함정) + 외부 경계 체크리스트 **#7**(v1.1.3 코드리뷰 수정 dev build 스모크). **mock verify green ≠ 런타임 정상**.
- `/docs/ADR.md` — ADR-040/042/043/045/046 의 각 **"개정(2026-06-30 · 코드리뷰 ...)"** 절(이번 묶음에 들어간 결정).
- `phases/v1_1_3/index.json` — step 10~14 산출물 summary(이번에 바뀐 파일·결정 확인).
- 이번 묶음 수정 파일(예상): `app/app/shipment/[id].tsx`(step10·11·14)·`app/app/(tabs)/dashboard.tsx`·`app/app/(tabs)/index.tsx`(step12)·`app/app/register.tsx`(step13).

## 작업

자동 가능한 것만 수행하고, 타이밍/네이티브 스모크는 체크리스트로 남긴다(이 CLI 실행 불가).

### (A) verify green
- `npm run verify` green 확인(app typecheck + test, worker, harness). step 10~14 가 회귀를 내지 않았는지.
- `app/app.json` `version` 은 **`1.1.3` 유지**(이번 묶음은 bump 없음 — 같은 미출시 버전의 머지 전 수정).

### (B) dev build 스모크 체크리스트 (수동 — 스토어 제출/머지 전 1회 · P-12)
> 전부 타이밍/런타임이라 mock verify 가 못 잡는다. summary 에 "미수행(수동 게이트)"로 명시.
- **#1 draft 레이스**: 신규 등록 → "입력" 자동오픈 모달에 **즉시 메모 타이핑** → 친 글자가 잠시 뒤 사라지지 않는지(콜드/저사양 반복).
- **#2 재진입**: "캡처로 채우기" **빠른 더블탭** → picker 2개·헛된 "캡처로 채울 수 없어요" 안 뜸.
- **#3 탈출구**: 분류 지연(비행기모드 등) 중 **✕·안드로이드 back** 으로 오버레이 닫힘 + 닫은 뒤 폴백 `Alert` 따로 안 뜸.
- **#4 FAB 가림**: 목록·대시보드 **끝까지 스크롤** → 마지막 카드 칩·운송장번호·탭이 FAB 에 안 가림.
- **#5 priming(선택)**: (재현 어려움) 등록 성공 후 priming 경로가 storage 오류에도 온보딩으로 진행.
- **#6 언마운트**: 분류 중 화면 이탈→복귀 시 잔여 타이머/깜빡임 없음.

### (C) 기존 v1.1.3 네이티브 스모크(step 5 (C))는 그대로 유효
- #1 키보드·#4 자동오픈·#5 편집메뉴·OCR 캡처 — 이번 수정과 함께 dev build 1회에 묶어 확인.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

> ⚠️ (B)(C) 스모크는 mock verify 가 못 잡는다(P-12·P-9~11). 자동 AC 는 verify green 까지.

## 검증 절차

1. `npm run verify` → green.
2. `app/app.json` `version` == `1.1.3` 유지(bump 없음) 확인.
3. 릴리스 체크리스트:
   - 서버·D1·워커 변경 없음(클라이언트만).
   - (B)(C) 스모크가 summary 에 "수동 게이트(미수행)"로 기록.
   - merge(main)·EAS·스토어 제출은 외부 작업(범위 밖).
4. `phases/v1_1_3/index.json` 의 step 15 갱신:
   - 성공 → `"status": "completed"`, `"summary": "step10~14 코드리뷰 수정 후 verify green·version 1.1.3 유지·서버무변경. 타이밍/네이티브 스모크(#1draft·#2재진입·#3탈출구·#4FAB가림·#6언마운트 + 기존 #1키보드·#4자동오픈·#5편집메뉴·OCR)는 dev build 수동 게이트."`.
   - verify 실패 3회 → `"status": "error"`, `"error_message": "..."`.

## 금지사항

- 워커를 배포하지 마라. 이유: 코드리뷰 수정도 전부 클라이언트(서버·D1 무변경).
- `app.json` version 을 또 bump 하지 마라(1.1.4 금지). 이유: 같은 미출시 1.1.3 의 머지 전 수정 — 버전은 그대로.
- 네이티브/타이밍 스모크 미수행으로 step 을 `blocked` 로 만들지 마라. 이유: 자동 AC(verify)는 통과 — 스모크는 외부 dev build 게이트(summary 명시로 충분).
- merge/EAS/스토어 제출을 이 step 에서 실행하지 마라. 이유: 외부 작업 — 사용자 지시 대기.
- 기존 테스트를 깨뜨리지 마라.
