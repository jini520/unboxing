# Step 13: list-detail (목록·상세 화면)

주화면(목록)과 상세(타임라인) 라우트 + 공용 컴포넌트(송장 카드·단계 배지·타임라인). 캐시 우선 렌더·당겨서 새로고침·딥링크 대상.

## 읽어야 할 파일

- `/docs/UI_GUIDE.md` — "화면 구성", "단계 배지(색+아이콘+라벨)", "송장 카드 해부", "타임라인 컴포넌트", "상태별 UI", "접근성", "AI 슬롭 안티패턴", "컴포넌트/레이아웃"
- `/docs/ARCHITECTURE.md` — "앱 아키텍처", "에러 처리 매트릭스 → 앱"
- `/docs/PRD.md` — "UX 세부"(상대 시간·정렬·삭제 Undo), "알림 정책"
- `/docs/ADR.md` — ADR-011(상세=실시간 조회), ADR-014(캐시 우선)
- step0 `app/src/theme/`(토큰·`useTheme`), step2 `app/src/lib/api.ts`, step3 `app/src/lib/cache.ts`
- **https://docs.expo.dev/router/** — 라우트·`[id]` 동적 세그먼트·`useLocalSearchParams`

## 작업

라우트:
- `app/app/index.tsx` — **목록**(주화면). step0 플레이스홀더 교체. `listShipments` + 캐시 우선 렌더, 당겨서 새로고침, 마지막 업데이트 표기, 빈 상태(가치 제안+등록 CTA), 정렬(진행 중 우선·`배송출발`·`예외` 강조).
- `app/app/shipment/[id].tsx` — **상세**. `useLocalSearchParams` 로 id → `getShipment` 실시간 타임라인. 단계 배지(즉시)+타임라인(스켈레톤→실시간). 삭제(확인 다이얼로그+Undo 토스트).

컴포넌트 `app/src/components/`:
- `StageBadge.tsx` — 단계별 색(토큰)+아이콘+라벨. **색 단독 금지**.
- `ShipmentCard.tsx` — 좌측정렬: 단계배지 · 택배사명·끝4자리 · 요약 · 상대시간. 탭→상세, 스와이프→삭제(확인+Undo).
- `Timeline.tsx` — 세로 단계 점(현재 강조)+시각(KST 상대+절대)+설명/허브명.

순수 헬퍼 `app/src/lib/time.ts`(+ `time.test.ts`): `relativeTime(iso, now)` → "방금 업데이트"·"2시간 전"(KST). 정렬 `sortShipments(list)` 도 순수·테스트 가능하면 분리.

## 핵심 규칙 (벗어나면 안 됨)

- **상태는 색 단독으로 표시하지 마라 — 색+아이콘+텍스트.** 이유: UI_GUIDE 접근성.
- 색은 `useTheme()` 토큰만. hex 하드코딩 금지. 이유: 라이트/다크 동등.
- **AI 슬롭 안티패턴 금지**: 글래스모피즘·그라데이션 텍스트·보라 브랜드·글로우 펄스·균일한 큰 borderRadius·과한 그림자. 이유: UI_GUIDE.
- 상세 타임라인은 **실시간 조회**(캐시/저장 아님). 오프라인이면 마지막 단계만. 이유: ADR-011.
- **에러 코드/기술 용어를 화면에 노출하지 마라**(친근한 한국어). device_id 등 민감값 표시 금지. 이유: PRD 톤, ADR-007.
- 캐시 우선 렌더 후 갱신. 이유: ADR-014, UI_GUIDE 로딩.

## 테스트

- `time.ts relativeTime` 순수 테스트(고정 `now`).
- `sortShipments` 분리 시 정렬 규칙 테스트.

> 화면 컴포넌트 렌더 테스트는 Phase 2 보류(테스트 전략). 이 step은 typecheck + 위 순수 테스트로 검증한다.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트: 색 단독 금지(아이콘+텍스트 동반)? 토큰만 사용? AI 슬롭 안티패턴 부재? 상세=실시간 조회? 에러 코드 미노출?
3. `phases/app-ui/index.json` 의 step 5 업데이트(규칙은 step0 동일).

## 금지사항

- 단계를 색만으로 구분하지 마라. 이유: 접근성(UI_GUIDE).
- hex 색을 컴포넌트에 박지 마라. 이유: 토큰 단일 출처.
- 타임라인을 로컬에 저장/캐시하지 마라. 이유: ADR-011.
- 서버 에러 코드·기술 메시지를 사용자에게 보여주지 마라. 이유: PRD 톤.
- 기존 테스트를 깨뜨리지 마라.
