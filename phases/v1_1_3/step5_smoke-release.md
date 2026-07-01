# Step 5: smoke-release (버전 bump + verify + 네이티브 리빌드 스모크 체크리스트)

## 읽어야 할 파일

먼저 아래를 읽고 맥락을 파악하라:

- `/docs/PRD.md` — "v1.1.3 완료 기준 (DoD)" 전체(#1~#5 + verify + 외부 경계 스모크 1회).
- `/docs/ENGINEERING.md` — **P-9**(키보드 회피)·**P-10**(OCR 네이티브 모듈 — iOS Apple Vision)·**P-11**(로케일 리빌드). 외부 경계 실호출 체크리스트 절. **mock verify green ≠ 런타임 정상**.
- `/docs/ROADMAP.md` — "예정 작업" v1.1.3 항.
- `app/app.json` — `expo.version`(현재 `1.1.2`). `buildNumber`/`versionCode` 키는 없음(EAS remote 자동).
- `phases/v1_1_3/index.json` — step 0~4 산출물 summary(이번 릴리스에 포함된 변경 확인).
- 이전 step(0~4)에서 수정된 파일: `app/app/shipment/[id].tsx`·`app/src/components/ShipmentCard.tsx`·`app/src/components/Fab.tsx`·`app/app/(tabs)/dashboard.tsx`·`app/app/(tabs)/index.tsx`·`app/app/register.tsx`·`app/app.json`.

## 작업

서버·D1 무변경 묶음이라 **워커 배포 없음**(v1.1.2 와 다름). 자동 가능한 것만 수행하고, 네이티브 스모크는 체크리스트로 남긴다.

### (A) 버전 bump
- `app/app.json` `expo.version` `1.1.2` → **`1.1.3`**(ADR-035 패치 라인). `buildNumber`/`versionCode` 추가하지 마라(EAS remote 자동 — 키 신설 시 자동증가 깨짐).

### (B) verify green
- `npm run verify` 가 green 인지 확인(app typecheck + test, worker, harness). 회귀 게이트 유지.

### (C) 네이티브 리빌드 스모크 체크리스트 (수동 — 이 CLI에선 실행 불가)
> 이번 릴리스는 **네이티브 리빌드 필수**: #5 로케일 config plugin(P-11) **+ 이미 main 에 있는 OCR 네이티브 모듈**(P-10·`app/modules/ocr`). dev build/EAS 로만 검증된다(Expo Go·OTA ❌). 아래는 **스토어 제출 전 사용자가 1회** 수행할 항목 — summary 에 "미수행(수동 게이트)"로 명시한다.
- **#1**(P-9): 두 모달(택배 정보·운송장 수정) — 제목+✕ 헤더·구분선·채움형 저장 렌더 + 입력 포커스 시 키보드에 안 가림 + 바깥 탭으로 안 닫힘.
- **#2**: 카테고리 설정/미설정 송장 카드가 **3줄**(칩이 택배사·번호 줄 우측).
- **#3**: 대시보드·택배함 우하단 FAB → `/register`, 헤더 '+' 병존, 빈 상태·멀티선택 숨김.
- **#4**: 등록 성공 → 확인 다이얼로그 → "입력" 시 새 상세 + 택배 정보 모달 자동 오픈, "취소" 시 기존 흐름, 멱등 등록은 확인 스킵.
- **#5**(P-11): 한국어 기기/시뮬에서 텍스트 long-press → 편집 메뉴(복사/붙여넣기/전체 선택) **한국어**.
- **OCR 캡처(P-10·v1.1.2 잔여)**: 캡처→온디바이스 OCR(iOS Apple Vision·시뮬 동작)→마스킹→분류→자동채움 동작 + **이미지·원문 미전송**(마스킹 텍스트만). 이 리빌드로 v1.1.2 잔여 스모크 해소.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

> ⚠️ (C) 네이티브 스모크는 **mock verify 가 못 잡는다**(P-9·P-10·P-11 — 빌드/런타임 네이티브). 자동 AC는 버전 bump + verify green 까지. 실 동작은 dev build/EAS 수동 1회.

## 검증 절차

1. `npm run verify` 실행 → green 확인.
2. `app/app.json` `version` 이 `1.1.3` 인지 확인.
3. 릴리스 체크리스트:
   - 서버·D1·워커 변경 없음(이 묶음은 클라/빌드 설정만 — 워커 배포 불필요).
   - (C) 스모크 체크리스트가 summary 에 "수동 게이트(미수행)"로 기록됐는지.
   - merge(main) · EAS 빌드 · 스토어 제출은 **외부 작업**(이 step 범위 밖).
4. 결과에 따라 `phases/v1_1_3/index.json` 의 step 5 를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "verify green·version 1.1.2→1.1.3·서버무변경. 네이티브 스모크(#1키보드·#4자동오픈·#5편집메뉴·OCR캡처) dev build 수동 게이트로 잔여."`.
   - verify 실패 3회 → `"status": "error"`, `"error_message": "..."`.

## 금지사항

- 워커를 배포하지 마라. 이유: v1.1.3 은 서버·D1 무변경(클라/빌드 설정만).
- `buildNumber`/`versionCode` 를 `app.json` 에 신설하지 마라. 이유: EAS remote 자동증가가 깨진다(기존 관례).
- 네이티브 스모크가 미수행이라고 step 을 `blocked` 로 만들지 마라. 이유: 자동 AC(verify+bump)는 통과 — 네이티브 스모크는 항상 외부 dev build 게이트(summary 에 명시로 충분, v1.1.2 패턴).
- merge/EAS/스토어 제출을 이 step 에서 실행하지 마라. 이유: 외부 작업 — 사용자 지시 대기.
- 기존 테스트를 깨뜨리지 마라.
