# Step 17: list-settings (A2 — 택배함 필터 제거 + 완료 숨기기 토글 이동)

택배함(`app/app/(tabs)/index.tsx`)과 설정(`app/app/(tabs)/settings.tsx`) 두 화면을 다룬다. step0에서 단순화된 `filterShipments(list, {hideCompleted})` 새 시그니처를 소비한다.

## 읽어야 할 파일

- `/docs/UI_GUIDE.md` — "택배함"(헤더·필터 위치), "설정 / About"
- `/docs/ADR.md` — ADR-025(시작 화면 로컬 저장)
- `/Users/jinni/Developments/unboxing/app/src/lib/filter.ts` — **step0에서 변경됨**(시그니처 `(list, {hideCompleted})`). 먼저 읽어 확인.
- `/Users/jinni/Developments/unboxing/app/src/lib/prefs.ts` — `loadListFilter`/`saveListFilter`(=`{hideCompleted}` 영속, 그대로 사용)
- `/Users/jinni/Developments/unboxing/app/app/(tabs)/index.tsx` — 대상 1
- `/Users/jinni/Developments/unboxing/app/app/(tabs)/settings.tsx` — 대상 2

## 배경 (확정된 설계 정정 A2)

필터 칩(전체/진행중/임박/완료/예외) 기능을 **전면 제거**한다. 대신 **"배송 완료된 항목 감추기" 토글을 설정에서 택배함 상단으로 이동**한다(시작 화면 라디오는 설정에 그대로 둔다). 토글 값은 기존 `prefs` 영속(`loadListFilter`/`saveListFilter`)을 **그대로 재사용**한다 — 저장 키·스토어 변경 없음.

## 작업 1 — `app/app/(tabs)/index.tsx` (택배함)

- 필터 칩 제거: `CHIPS` 상수, `selectedChip` state, 칩 ScrollView UI 블록, `filterParam`(`useLocalSearchParams<{filter?}>`) 과 그 `useEffect`(프리셋 반영)를 **전부 제거**한다. `ListFilter` import 제거.
- `visible` 계산을 새 시그니처로: `sortShipments(filterShipments(shipments ?? [], { hideCompleted }))`.
- `hideCompleted` state 와 `loadListFilter`(최초 + focus 복귀 재로드)는 **유지**한다. 단 이제 토글 UI 가 이 화면에 있으므로 변경 핸들러(`saveListFilter` + setState)를 추가한다.
- **토글 배치:** 헤더(택배함 제목/설명) 아래, 목록 위에 "배송 완료된 항목 감추기" 토글 행을 둔다. 송장이 있을 때(`shipments!==null && length>0`)·비선택 모드에서만 노출(빈 상태에선 의미 없음 — 기존 칩 노출 조건과 동일하게). 컴포넌트는 설정 화면의 토글 카드 스타일을 참고하되 택배함 레이아웃에 맞춘다(색은 토큰만, `Switch` trackColor=accent).
- "필터 결과 0건"과 "입력 0건" 분기는 hideCompleted 기준으로 유지(완료를 숨겨 0건이 될 수 있음 → "조건에 맞는 택배가 없어요" 분기 살림). 멀티선택 전체선택은 기존대로 `visible` 기준.

## 작업 2 — `app/app/(tabs)/settings.tsx` (설정)

- "표시" 섹션의 **"완료된 항목 숨기기" 토글 카드를 제거**한다(택배함으로 이동했으므로). **시작 화면 라디오 그룹은 유지**한다.
- 그로 인해 미사용이 된 것들 정리: `hideCompleted` state, `onHideCompleted`, `loadListFilter`/`saveListFilter` import, `Switch` import(다른 곳에서 안 쓰면). `loadHomePref`/`saveHomePref` 와 시작 화면 관련은 유지.
- 토글 제거로 빈 자리가 생기면 "표시" 섹션이 시작 화면 라디오 + 캡션만 남는다 — 레이아웃/간격이 자연스러운지 확인(인접 카드 마진 정리는 본인이 만든 변경 범위 내에서만).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) green
```

## 검증 절차

1. AC 실행 green.
2. 체크리스트:
   - 칩 관련 코드(CHIPS·selectedChip·filterParam·ListFilter)가 index.tsx 에 남지 않았는가.
   - 토글이 택배함에 1곳, 설정엔 없음(시작 화면 라디오는 설정에 유지).
   - 토글 값이 `prefs`(loadListFilter/saveListFilter) 그대로 영속되는가(키 변경 없음).
   - 미사용 import 없음, 색 토큰만.
3. (가능하면) 시뮬레이터: 택배함 토글 ON/OFF → 배송완료 노출 토글, 앱 재시작 후에도 유지.
4. `index.json` step2 갱신:
   - 성공 → `"status":"completed"`, `"summary"`: 필터 칩 제거·완료숨기기 토글 택배함 상단 이동(설정에서 제거)·시작화면 라디오 유지·prefs 영속 재사용.
   - 실패(3회) → `"error"` + `error_message` / 사용자 개입 → `"blocked"` + `blocked_reason`

## 금지사항

- `prefs.ts` 의 저장 키·시그니처를 바꾸지 마라. 이유: 기존 영속 값을 그대로 재사용해야 마이그레이션 없이 동작한다.
- 시작 화면(homePref) 라디오를 제거하지 마라. 이유: A2는 "완료 숨기기 토글"만 이동한다. 시작 화면 설정은 유지(ADR-025).
- 삭제/스와이프/멀티선택 등 택배함의 기존 인터랙션 로직을 건드리지 마라. 이유: 본 step 범위는 필터 제거 + 토글 이동뿐(회귀 금지, UI_GUIDE "송장 카드 해부").
- 기존 테스트를 깨뜨리지 마라.
