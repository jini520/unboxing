# Step 0: 택배함 v1.1 통합 + 삭제 UX 복원(stash pop)

택배함(주화면)에 v1.1 요소를 통합한다 — **헤더 알림 종(미읽음 배지)·필터 칩 행·삭제 시 휴지통 적재·sync 시 휴지통 정합**. 동시에, 이 phase 착수 전에 손으로 구현해 둔 **삭제 확인 다이얼로그(Undo 토스트 폐기) + 스와이프 2단계 햅틱** 변경이 git stash 에 보관돼 있다 — 이 step 맨 처음에 그것을 복원(pop)해 보존하고 그 위에 작업한다. 순수 로직은 직전 phase 08(`08-ui-v0-v11-logic`)이 이미 만들어 머지됐다 — **그 libs 를 import 해 소비**하고 재구현하지 않는다.

## 읽어야 할 파일

먼저 아래를 읽고 택배함의 현재 구조·인터랙션·회귀 락·v1.1 설계 의도를 파악하라:

- `/docs/UI_GUIDE.md` — "**송장 카드 해부**"/회귀 락 섹션(반드시), "v1.1 화면/컴포넌트"의 **헤더 알림 종+미읽음 배지**(line 181~183)·**택배함 필터 칩**(line 202~205), "인터랙션"(line 261~266, 양방향 스와이프·확인 다이얼로그·햅틱), "아이콘"의 v1.1 신규 글리프(line 281)
- `/docs/PRD.md` — "v1.1 기능 명세" 6(택배함 필터링)·삭제 확인(line 75), 3(헤더 종)
- `/docs/ARCHITECTURE.md` — "데이터 흐름"(삭제→확인→DELETE+휴지통 적재, line 244), "v1.1 설계 보강 ④"(휴지통 정합·스냅샷 먼저, line 317~321), 앱 에러 매트릭스(line 381~384)
- `/docs/ADR.md` — ADR-022(휴지통 소프트 삭제·재등록 복구), ADR-014(서버 SOT·캐시 우선)
- **08 산출물(소비 대상, export 경로는 코드를 읽어 확인)**: `app/src/lib/bucket.ts`(`filterShipments`·`stageBucket`), `app/src/lib/trash.ts`(`addTrash`·`reconcileTrash`), `app/src/lib/info.ts`(`getInfo`), `app/src/lib/notif.ts`(`unreadCount`·`loadNotifLastSeen` 등), `list_filter` 스토어(`hideCompleted`)
- 코드: `app/app/(tabs)/index.tsx`(택배함 — **stash pop 후** 읽어라), `app/src/components/ShipmentCard.tsx`, `app/src/components/icons/icons.tsx`(Bell·BellOff 존재), `app/src/lib/api.ts`(listShipments·deleteShipment), `app/src/lib/sort.ts`(sortShipments), `app/src/lib/selection.ts`, `app/src/lib/cache.ts`, `app/src/theme/tokens.ts`·`layout.ts`

## 작업

### 1. (맨 먼저) stash pop 으로 삭제 UX 복원
- `git stash list` 로 확인 → `stash@{0}`("v1.1 app 변경 — 삭제 확인 다이얼로그+햅틱·app.json·eas.json·expo-haptics")를 **`git stash pop`** 한다.
- 이 stash 에는 이미 구현된 **삭제 확인 다이얼로그(`Alert.alert("삭제할까요?", …)`, Undo 토스트·`UNDO_WINDOW_MS`·`pending` 로직 폐기)** 와 **스와이프 2단계 임계 도달 시 `expo-haptics` 진동**(ShipmentCard) 과 `app.json`(supportsTablet·encryption·faceID)·`eas.json`(track)·`package.json`(expo-haptics) 변경이 들어 있다. 이 변경을 **보존**(회귀 금지)하고 그 위에 본 step 작업을 얹는다. pop 된 변경은 이 step 커밋에 함께 흡수된다(사용자 결정: 삭제 UX 는 09 phase 에 포함).
- pop 시 충돌이 나면 충돌 파일을 수동 병합(이전 phase 07·08 은 `index.tsx`/`ShipmentCard.tsx`/`app.json` 을 건드리지 않으므로 충돌은 없어야 정상). **stash 가 이미 없으면**(누군가 먼저 pop) `app/app/(tabs)/index.tsx` 가 확인 다이얼로그·햅틱을 이미 갖췄는지 확인하고, 없으면 UI_GUIDE 인터랙션 절대로 구현하라.

### 2. 헤더 알림 종 공용 컴포넌트 — `app/src/components/HeaderBell.tsx`
- 라인 `Bell` 글리프 + 미읽음 배지(우상단 작은 점/숫자, 배경 `accent`·글자 `onAccent`). 미읽음=0 이면 배지 없음. 미읽음 수는 08 `unreadCount`(99+ 상한 헬퍼) 결과를 prop 으로 받는다.
- 탭 → `router.push("/notifications")`. a11y 라벨 "알림(미읽음 N개)". 터치 타깃 ≥44.
- 택배함 헤더 우측에 배치(대시보드도 step1 에서 같은 컴포넌트 재사용).

### 3. 필터 칩 행 (헤더 아래)
- 칩: **전체 / 진행 중 / 임박 / 완료 / 예외**. 선택 칩 = `accent` 보더·배경(색+굵기 — 색 단독 금지). 상태 칩은 **세션 UI 상태(미지속)**.
- 목록 파이프라인: `filterShipments(list, selectedChip, { hideCompleted })`(08) → **그 결과를 기존 `sortShipments` 에 넘긴다**(filter→sort 순서·정렬 로직 불변).
- "완료 숨기기"는 설정의 지속 토글(`list_filter.hideCompleted`, step5 에서 설정 UI). 본 step 은 그 값을 읽어 `전체`·`진행 중` 뷰에서 `배송완료` 제외. 단 **`완료` 칩 명시 선택 시 토글 무시·완료 표시**(명시 우선).
- 결과 0건 → "조건에 맞는 택배가 없어요"(입력 0건="운송장만 넣어두면…" 빈 상태와 **구분**). 멀티선택 모드와 공존(전체선택은 **필터된 목록 기준**).

### 4. 삭제 → 휴지통 적재 (보강 ④ 순서)
- 확인 다이얼로그(1번에서 복원됨) "삭제" 확정 시: ① 라이브 `getInfo`(08) 읽기 → ② **`addTrash`(키 `carrier:trackingNo`, status·createdAt·statusChangedAt·**info 스냅샷 포함**, `deletedAt=now`)** → ③ 기존 서버 `deleteShipment`(DELETE /shipments) → ④ 다음 sync 의 prune. **②(스냅샷)가 prune 보다 먼저** — info 유실 방지.
- 일괄삭제(멀티선택)도 항목별로 동일하게 `addTrash` 후 서버 삭제. 부분 실패는 기존 복원 규칙 유지.

### 5. sync reconciliation
- `sync()` 에서 서버 목록을 받은 뒤 `reconcileTrash(서버에 존재하는 carrier:trackingNo 키 집합)`(08) 호출 → 수동 재등록·타 기기 복구로 서버에 다시 나타난 키를 휴지통에서 제거(중복 표시 방지).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차
1. 위 AC 실행. (택배함 화면은 jest-expo 통합 테스트 보류 가능[QA E-3] — 최소 typecheck·기존 테스트 무파손.)
2. 체크리스트: stash pop 으로 확인 다이얼로그·햅틱 **보존**(Undo 토스트 부활 없음) / "송장 카드 해부"·메모 표시 규칙 **불변**(회귀 락) / 필터는 `filterShipments`→`sortShipments` 순서·정렬 불변 / 삭제 시 `addTrash` 가 서버 DELETE·prune **앞** / 색 토큰만(하드코딩 없음) / 완료 칩 명시 시 hideCompleted 무시.
3. `phases/09-ui-v0-v11-screens/index.json` step 0 업데이트(성공→completed+summary / 3회 실패→error / 외부개입[stash 충돌 등]→blocked).

## 금지사항
- "송장 카드 해부"·메모 표시 규칙(중단·좌측·primary·대체문구)을 바꾸지 마라. 이유: UI_GUIDE 회귀 락 — 반복 회귀 항목.
- Undo 토스트(`UNDO_WINDOW_MS`·`pending`·"실행취소")를 되살리지 마라. 이유: 단건·일괄 삭제는 확인 다이얼로그로 통일(사용자 요구·PRD line 75).
- `addTrash` 를 서버 DELETE 성공 **뒤**로 미루지 마라. 이유: prune 이 먼저 돌면 info 스냅샷이 유실된다(보강 ④).
- 필터가 `sortShipments` 의 정렬 순서를 바꾸게 하지 마라. 이유: filter→sort 는 별개 단계(설계 단일 책임).
- 색을 하드코딩하지 마라(시맨틱 토큰만). 상태를 색 단독으로 표현하지 마라(색+아이콘+텍스트).
- 기존 테스트를 깨뜨리지 마라.
