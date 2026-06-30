# Step 21: store-manual (스토어 준비 감사 + 수동 테스트플랜 + 통합 요약)

스토어 제출 준비도를 감사하고, 자동화 불가 항목을 위한 수동 QA 테스트플랜을 완성하며, 전체 발견을 통합 요약한다. (발견·기록만 — 수정 금지.)

> **QA 철칙: 버그를 고치지 마라.** 갭은 `docs/QA_FINDINGS.md` 기록. verify green 유지. 이 step은 문서 위주라 코드 테스트 변동이 적다.

## 읽어야 할 파일

- `/docs/PRD.md` — "스토어 정책 & 컴플라이언스"(Apple·Google·한국 법규), "MVP 완료 기준(DoD)"
- `/docs/ADR.md` — ADR-017(데이터 삭제)·018(거래성 알림)·019(데모 경로)
- `/docs/ARCHITECTURE.md` — "데모/리뷰 경로", "환경변수 & 시크릿"
- `/Users/jinni/Developments/unboxing/app/app/settings.tsx`(개인정보처리방침·데이터삭제·버전), `app/src/lib/wipe.ts`
- `/Users/jinni/Developments/unboxing/phases/qa-mvp/step0.md`~`step4.md` 산출 + `docs/QA_FINDINGS.md`·`docs/QA_TESTPLAN.md`

## 작업

### 1. 스토어 준비 감사 → `docs/QA_FINDINGS.md`

- **개인정보처리방침 URL**: settings.tsx의 값이 placeholder(`https://unboxing.app/privacy`)인지 → 미확정이면 갭(P1, 제출 차단).
- **인앱 데이터 삭제**(Apple 5.1.1(v)/Google): `DELETE /me` + 로컬 폐기가 설정에 눈에 띄게 있는지(동작은 step3에서 검증).
- **데모 경로(ADR-019)**: `DEMO_TRACKING_NUMBER` 분기가 실폴링 우회 + 캔드 응답인지, 리뷰 노트용 샘플 번호가 준비됐는지.
- **거래성 알림만(ADR-018)**: 마케팅/광고 알림 경로 부재.
- **App Privacy / Data Safety 신고 항목**: 수집(운송장·푸시토큰)·제3자 제공(tracker.delivery)·국외이전(Cloudflare) — 신고 초안이 문서화됐는지.
- **Privacy Manifest / required-reason API**(클립보드 등) 준비 여부.

### 2. `docs/QA_TESTPLAN.md` 완성 (수동 QA)

- **실기기 푸시 시나리오**: 권한 priming→허용→등록→(서버 단계전환 트리거)→알림 수신→탭 딥링크. iOS/Android 각각, 거부 graceful, Android 채널.
- **시뮬레이터/기기 화면별 런스루**: 목록(빈/캐시/오프라인)·상세(타임라인/실패)·등록(클립보드/미지원 딥링크/입력보존)·온보딩·설정(테마·데이터삭제 확인).
- **스토어 제출 체크리스트**: 위 1의 항목 + 스크린샷·연령등급·target SDK.

### 3. 통합 요약 → `docs/QA_FINDINGS.md` 상단

전체 step 발견을 **심각도별(P0~P3)로 집계**하고, **이슈 등록 후보 목록**(QA-001=#3 외 신규)을 정리한다. (이슈 생성 자체는 phase 종료 후 사람이 검토해 수행 — 격리 세션에서 gh 호출 금지.)

## 핵심 규칙 (벗어나면 안 됨)

- 갭은 FINDINGS 기록만. 코드 수정·이슈 자동생성 금지(gh 호출 금지). 이유: find↔fix 분리 + 중복 이슈 방지.
- DoD(PRD) 대비 미충족 항목을 빠짐없이 집계한다.

## Acceptance Criteria

```bash
npm run verify
```

## 검증 절차

1. AC 실행. 2. 체크리스트: 스토어 차단 항목(개인정보 URL·데이터삭제·데모·신고)이 감사됐는가? `QA_TESTPLAN.md`가 실기기 푸시·화면 런스루·제출 체크리스트를 담는가? `QA_FINDINGS.md`에 심각도별 집계 + 이슈 후보가 정리됐는가? 3. `phases/qa-mvp/index.json` step 5 업데이트 + phase 완료.

## 금지사항

- 발견을 고치거나 `gh issue`를 자동 생성하지 마라. 이유: QA 전용 + 중복 방지(사람이 검토 후 등록).
- 기존 테스트를 깨뜨리지 마라.
