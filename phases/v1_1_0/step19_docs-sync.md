# Step 19: docs-sync (A1·A2 설계 정정의 SoT 동기화)

A1·A2는 "의도와 다르게 구현됨 → 설계 정정"이다. 코드(step0~3)가 새 사양으로 바뀌었으니, **권위 문서(PRD·UI_GUIDE·ADR)를 구현된 현실과 일치**시킨다. 이 step은 문서만 — 코드는 건드리지 않는다.

## 읽어야 할 파일

- `/docs/PRD.md` — "v1.1" 대시보드 / 택배함 필터 사양
- `/docs/UI_GUIDE.md` — "대시보드" / "택배함"(필터 칩) / "설정 / About"(표시 섹션) 사양
- `/docs/ADR.md` — 필터·대시보드 관련 ADR(ADR-021·025 및 필터 칩을 규정한 항목)
- `/docs/ROADMAP.md` — "예정 작업"의 v1.1 Bug Fix 블록
- step0~3에서 바뀐 실제 코드(요약은 각 step summary 참조): `filter.ts`·`dashboard.ts`·`dashboard.tsx`·`index.tsx`·`settings.tsx`·`notifications.tsx`·`trash.tsx`

## 확정된 새 사양 (문서에 반영할 내용)

**A1 — 대시보드:**
- 카드는 **4개**: `진행 중 · 배송 완료 · 휴지통 · 새 알림`. "확인 필요(예외)"·"오늘 도착" 카드는 **삭제**.
- **예외 상태 건은 "진행 중"에 포함**(inProgress = 배송완료가 아닌 전체). 대시보드는 예외/오늘도착을 별도 집계하지 않는다.
- 각 카드 **의미색**(count>0 일 때, 0이면 중립): 진행 중=accent(블루), 배송 완료=stage.delivered(그린), 새 알림=stage.inTransit(골드), 휴지통=stage.exception(레드). 색 단독 금지(아이콘+라벨 동반).
- 카드 탭 → 진행 중/배송 완료=택배함 탭, 휴지통=/trash, 새 알림=/notifications (필터 프리셋 네비 제거).

**A2 — 택배함 필터:**
- 필터 칩(전체/진행중/임박/완료/예외) 기능 **전면 제거**.
- "배송 완료된 항목 감추기" 토글은 **택배함 상단**에 위치(설정 "표시" 섹션에서 제거). 시작 화면 라디오는 설정에 유지.
- `filterShipments` 는 `hideCompleted` 전용.

## 작업

1. **PRD.md / UI_GUIDE.md / ADR.md** 의 해당 v1.1 섹션을 위 새 사양으로 갱신한다.
   - 6카드·예외/오늘도착 카드·필터 칩을 전제한 서술을 새 사양으로 고친다(삭제·정정).
   - 필터 칩을 도입했던 ADR 항목이 있으면 "정정/철회(superseded)" 노트를 추가하되 **기존 ADR 번호·결정 이력은 보존**(덮어쓰지 말고 정정 사유를 덧붙인다 — ADR 관례).
   - 색 매핑·예외 흡수 규칙을 명시한다.
2. **ROADMAP.md** 갱신:
   - "예정 작업"의 **v1.1 Bug Fix 블록(A1·A2·B1·B2)**을 "진행 현황"으로 이동하고, `11-qa-v0-v11-fixes` 구현·정정 완료로 표기(권위 출처: `phases/index.json`·git).
   - **배포 전 외부 경계 실호출 스모크 미완** 항목은 그대로 남긴다(이번 phase가 해소하지 않음).
3. CLAUDE.md 100줄 규칙: 본 step은 `docs/` 만 수정한다(CLAUDE.md 본문 편집 금지 — 메모리 [[claude-md-100-line-limit]]).

## Acceptance Criteria

```bash
npm run verify   # 코드 미변경이라 그대로 green 유지(문서 변경이 코드/테스트를 깨지 않았는지 확인)
```

## 검증 절차

1. AC 실행 green(문서 step이라 코드 영향 없어야 함).
2. 체크리스트:
   - PRD/UI_GUIDE/ADR 의 대시보드·필터 서술이 구현된 4카드·예외흡수·필터제거·토글이동과 **일치**하는가(드리프트 0).
   - ADR 이력 보존(번호 유지 + 정정 노트), ROADMAP 진행 현황 갱신.
   - 코드 파일(`.ts`/`.tsx`)을 수정하지 않았는가.
3. `index.json` step4 갱신:
   - 성공 → `"status":"completed"`, `"summary"`: PRD/UI_GUIDE/ADR v1.1 대시보드·필터 사양 정정(4카드+색·예외흡수·필터제거·토글이동), ROADMAP 진행현황 이동(스모크 미완 잔존).
   - 실패(3회) → `"error"` + `error_message` / 사용자 개입 → `"blocked"` + `blocked_reason`

## 금지사항

- 코드(`.ts`/`.tsx`)를 수정하지 마라. 이유: 이 step은 SoT 문서 동기화 전용. 코드는 step0~3에서 확정됐다.
- ADR 결정 이력을 덮어쓰거나 번호를 재사용하지 마라. 이유: ADR 은 append-only 관례 — 정정은 "superseded/정정" 노트로 남긴다.
- "실호출 스모크 미완" 경고를 ROADMAP 에서 지우지 마라. 이유: 이번 phase 는 UI 정정이고 원격 D1 마이그레이션·실 전환 푸시 확인은 여전히 미완이다.
- CLAUDE.md 본문을 늘리지 마라(100줄 규칙).
