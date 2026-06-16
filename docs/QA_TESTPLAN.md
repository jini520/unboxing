# QA 수동 테스트플랜 — 골격

> 자동화(vitest E2E)로 덮을 수 없는 항목의 수동 QA 절차. **골격만** — 상세 케이스는
> `qa-mvp` step5(`store-manual`)가 채운다. 자동 검증 가능한 흐름은 `worker/test/e2e/` 와
> `docs/QA_FINDINGS.md` 가 담당한다.
>
> 사양 출처: `docs/PRD.md`(플로우·알림 정책·스토어 컴플라이언스), `docs/ARCHITECTURE.md`(푸시 파이프라인),
> `docs/UI_GUIDE.md`(화면·상태별 UI).

## 1. 실기기 푸시 시나리오

> 시뮬레이터/유닛테스트로 검증 불가 — APNs/FCM 실제 전달, 권한 팝업, 딥링크가 실기기에서만 동작.

- (step5 채움) 권한 priming → 시스템 팝업 → 허용/거부 분기
- (step5 채움) 단계 전환 푸시 수신(등록·집화·배송출발·배송완료·예외) + 멱등(중복 없음)
- (step5 채움) 알림 탭 → 해당 상세 딥링크
- (step5 채움) Android "배송 상태" notification channel 분리 / 조용시간

## 2. 시뮬레이터 화면별 런스루

> 화면 컴포넌트 E2E(Maestro)는 Phase 2 보류 — 그 전까지 수동 런스루로 커버.

- (step5 채움) 목록 / 상세 / 등록 / 온보딩 / 설정 / 빈 상태
- (step5 채움) 로딩·오프라인·에러 상태별 UI(스켈레톤·배너·재시도)
- (step5 채움) 라이트/다크 테마 전환(시스템 추종)
- (step5 채움) 스와이프 삭제 + Undo, 당겨서 새로고침

## 3. 스토어 제출 체크리스트

> 제출/심사 통과 필수 — 코드만으로 검증 불가(콘솔 설정·심사 노트 포함).

- (step5 채움) 개인정보처리방침 URL(앱·스토어)
- (step5 채움) 인앱 "모든 데이터 삭제"(`DELETE /me`) 동작
- (step5 채움) Apple App Privacy / Google Data Safety 신고
- (step5 채움) Privacy Manifest(`PrivacyInfo.xcprivacy`) + required-reason API
- (step5 채움) 데모 운송장 + 리뷰 노트(실배송 없이 검증)
