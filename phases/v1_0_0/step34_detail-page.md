# Step 34: detail-page — 배송 상세: 단계 인디케이터·현재 상태 문구·수취인 정보

상세 화면에 **상단 단계 진행 인디케이터**(현재 단계 강조), **현재 상태 문구**(예: `6월 6일 (수) 06:26 · 배달 준비`), **수취인 정보**(화면 전용·미저장)를 추가한다.

## 읽어야 할 파일
- `app/AGENTS.md` — Expo SDK 56. https://docs.expo.dev/versions/v56.0.0/ 확인.
- `/docs/ARCHITECTURE.md` — "상태 정규화 & 알림"(표준 단계 7+기타), "HTTP API 계약"(`GET /shipments/:id` 가 phase 05에서 `recipient` 추가)
- `/docs/ADR.md` — **ADR-005(수령인 비영속 — 화면 표시 후 폐기, 저장/복사/로그 금지)**, ADR-011(타임라인 미저장)
- `/docs/UI_GUIDE.md` — "타임라인", "단계 배지", "테마 & 색상"(stage 토큰), "접근성"
- `phases/06-ui-v0-redesign-pages/step1.md` summary(api `getShipment` 가 `recipient: Contact|null` 반환), `phases/05-backend-v0-redesign-data/step2.md`(recipient 계약)
- `app/app/shipment/[id].tsx`(현 상세), `app/src/components/StageBadge.tsx`, `app/src/components/Timeline.tsx`, `app/src/lib/time.ts`(`relativeTime`,`absoluteKST`), `app/src/lib/api.ts`(`Stage`,`Shipment`,`Contact`,`TimelineEvent`), `app/src/components/icons/`(단계 글리프·`Truck`/`CheckCircle`/`AlertTriangle`/`Clock`/`DotSmall`)

## 작업

### 1. 단계 진행 인디케이터 — `app/src/components/StageProgress.tsx`(신규)
- happy-path 5단계를 가로 스텝퍼로: **`등록 → 집화 → 이동중 → 배송출발 → 배송완료`**(ARCHITECTURE 표준 단계에 1:1, 사용자 사양 "현재 프로젝트 사양에 맞게").
- 순수 매핑 헬퍼를 분리(테스트 대상): `stageProgress(stage: Stage): { index: number; track: "normal" | "exception" | "pre" }`.
  - 등록=0 … 배송완료=4. 각 단계의 인덱스로 "지난 단계=채움(중립), 현재=강조(색+굵게), 이후=빈 점".
  - **off-track 처리(엣지케이스)**:
    - `미등록` → `track:"pre"`, 모든 스텝 비활성(채움 0). 안내: 아직 조회 전.
    - `예외` → `track:"exception"`. 선형 바를 예외 색으로 흐리게/중단 표시 + `AlertTriangle` 강조(어느 스텝에서 멈췄는지 알 수 없으므로 바 위에 예외 배지). 선형 진행 강제 매핑 ❌.
    - `기타` → 중립 처리(가장 가까운 진행 추정 없이 현재=중립 점, 바는 비강조).
- 현재 단계 강조: 색=해당 stage 토큰(배송출발=outForDelivery, 배송완료=delivered, 예외=exception, 그 외 중립), 아이콘=step0 단계 글리프. **색 단독 금지** — 아이콘+라벨 동반.
- a11y: `accessibilityLabel="배송 단계: {현재단계}, {index+1}/5"`.

### 2. 현재 상태 문구 — 시간 포맷터 + 조합
- `app/src/lib/time.ts` 에 **`absoluteKSTLong(input: number|string): string`** 추가: `M월 D일 (요일) HH:mm`(KST, 한글 요일 `일~토`). 파싱 불가 → `""`. 기존 `absoluteKST` 와 별개(타임라인은 기존 유지).
- 상세 상단(단계 배지 아래)에 **현재 상태 한 줄**: `{absoluteKSTLong(현재이벤트시각)} · {현재이벤트 설명}`.
  - 현재 이벤트 = 타임라인 최신 이벤트(`Timeline` 정렬과 동일: 시각 내림차순 첫 항목). 설명 없으면 단계 한 줄 요약(`STAGE_SUMMARY` 재사용 가능) 으로 폴백.
  - **엣지케이스**: 타임라인이 비었거나(offline/unavailable/notfound) 시각 파싱 불가 → 시간부 생략하고 단계 요약만, 또는 `status_changed_at` 기준 시각으로 폴백.
- `time.ts` 단위 테스트 추가(`absoluteKSTLong`: 요일·자정/정오 경계·KST 변환·파싱 실패).

### 3. 수취인 정보 — 화면 전용(미저장)
- `getShipment` 의 `recipient`(`{name?, regionName?}|null`)를 상세에 표시: 섹션 "받는 분"에 `name`(예: `홍**`)과 `regionName`(예: `서울 강남`).
- **null/빈 값이면 섹션 자체를 숨긴다**(자격증명 없음·upstream 실패·미제공 케이스). 한쪽만 있으면 있는 것만.
- **CRITICAL(ADR-005)**: recipient 를 `AsyncStorage`/캐시/로그에 저장하지 마라. 화면 state로만 들고 화면 이탈 시 폐기(캐시된 shipment에는 recipient 없음 — 실시간 조회분만). 복사 버튼 등 영속 유도 UI 금지.

### 4. 기존 요소 보존
- 단계 배지(캐시 즉시)·타임라인(실시간)·당겨서 새로고침·삭제 버튼·offline/unavailable/notfound 분기 유지. 헤더는 step1에서 title 없음·아이콘 뒤로가기.

## 엣지케이스 / 에러 핸들링
- `미등록`(등록 직후) 상세: 인디케이터 pre 상태 + "아직 조회 전" 톤, 빈 타임라인 카피 유지.
- `예외`: 인디케이터 예외 표시 + 타임라인의 예외 이벤트 강조. 기술 코드 노출 금지.
- 오프라인: 캐시 단계 배지만(인디케이터는 캐시 stage로 그림), 수취인/상태문구는 실시간분 없으면 생략 + "타임라인 못 불러왔어요, 다시 시도".

## 금지사항
- recipient 를 저장·캐시·로그하지 마라(ADR-005 CRITICAL). 화면 state 한정.
- off-track 단계(예외·미등록·기타)를 선형 스텝 인덱스에 억지 매핑하지 마라(오해 유발) — 전용 표시.
- 색만으로 단계를 구분하지 마라 — 아이콘+라벨 동반.
- 상품명·사진 자리를 만들지 마라(데이터 없음 — phase 조사 결론).
- 기존 테스트를 깨뜨리지 마라.

## Acceptance Criteria
```bash
npm run verify
```
- 순수 로직(`stageProgress`, `absoluteKSTLong`) 단위 테스트 포함.

## 검증 절차
1. AC 실행.
2. 체크리스트: 인디케이터(현재 강조·off-track 처리) / 상태 문구(`M월 D일 (요일) HH:mm · 설명`·폴백) / 수취인(있을 때만·미저장) / 색단독 아님 / 기존 분기(offline/notfound) 보존.
3. `phases/06-ui-v0-redesign-pages/index.json` step 3 업데이트.
