# Step 5: trash-store — 휴지통(로컬 소프트 삭제) 스토어

삭제한 택배를 30일 안에 되살릴 수 있도록 **로컬 휴지통**을 만든다(ADR-022, 서버 무관). 삭제 시 스냅샷을 적재하고, 복구는 재등록(09 phase)으로 처리한다. 이 step 은 휴지통 스토어의 **순수 로직 + KeyValueStore 주입**만 다룬다(화면은 09 phase). test-first.

## 읽어야 할 파일

먼저 아래를 읽고 휴지통 설계·정합성 규칙·기존 스토어 패턴을 파악하라:

- `/docs/ARCHITECTURE.md` — "로컬 스토어" 표의 휴지통 항목(키·형태), "v1.1 설계 보강 ④"(휴지통 정합성: 스냅샷 먼저·reconcile·복구 id 귀속·pruneTrash 30일·용량 상한), 엣지(휴지통 30일·시계 변경·복구 실패)
- `/docs/ADR.md` — ADR-022(휴지통 = 클라이언트 로컬 소프트 삭제 + 멱등 재등록 복구, 0 마이그레이션·비영속 일관)
- `/docs/QA.md` — "E-1" 휴지통 스토어 케이스, "E-4" E4(reconcile)·E5(pruneTrash 30일·시계)
- `app/src/lib/memo.ts`·`app/src/lib/cache.ts` — `KeyValueStore` 주입 패턴(결정적 테스트), 손상 JSON graceful 처리 규칙
- `app/src/lib/api.ts` — `Shipment` 타입(스냅샷 필드: carrier·trackingNo·status·createdAt·statusChangedAt)

## 작업

### `app/src/lib/trash.ts` (스토어 키 `unboxing.trash`, `KeyValueStore`·`now` 주입)
- 형태: `Record<TrashKey, TrashEntry>`, `TrashKey = "carrier:tracking_no"`(dedupe 키),
  `TrashEntry = { carrier, trackingNo, status, createdAt, statusChangedAt, info?, deletedAt }`.
- 함수(시그니처 수준 — 구현은 재량):
  - `loadTrash(store): Promise<TrashMap>` — 손상 JSON·비객체 → 빈 객체(기존 `loadMemos` 규칙).
  - `addTrash(store, snapshot, now)` — 키=`carrier:trackingNo`·`info` 스냅샷 포함·`deletedAt=now`. 같은 키 재삭제 → **덮어씀**(최신 `deletedAt`).
  - `pruneTrash(store, now)` — `deletedAt < now-30일` 영구 제거 + **용량 상한**(상수, 예 200) 초과 시 **오래된 것부터** 정리. (bootstrap·휴지통 열람 시 호출.)
  - `reconcileTrash(store, serverKeys: Set<TrashKey>)` — 서버 목록에 다시 나타난 키 제거(수동 재등록·타 기기 복구 → 중복 표시 방지, E4).
  - `removeTrash(store, key)` — 영구삭제/복구 성공 후 제거.
  - `clearTrash(store)` — wipe(09 의 `wipeAllData` 가 호출).
- 30일·상한은 **로컬 시각(`now` 주입)** 기준(시계 급변 시 경계 어긋남은 로컬 편의 기능이라 허용·문서화됨).

## 테스트 (TDD)
- `trash.test.ts`(`now` 고정·mock `KeyValueStore`):
  - `addTrash`: 키·`info` 스냅샷·`deletedAt=now` 저장 / 같은 키 재삭제 → 덮어씀(최신 deletedAt).
  - `pruneTrash`: `deletedAt<now-30일` 제거·창 내 보존 / 용량 상한 초과 시 오래된 것부터(상한 개수만 남음).
  - `reconcileTrash`: 서버 키와 겹치는 항목 제거·나머지 유지(E4).
  - `removeTrash` / 손상 JSON → 빈 객체 graceful / `clearTrash` 전부 비움.

## Acceptance Criteria
```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차
1. 위 AC 실행.
2. 체크리스트: 키=carrier:tracking_no / 스냅샷에 `info` 포함 / `now` 주입(고정 시계) / 30일+용량 상한 / reconcile / 손상 graceful / ADR-022 일관(서버 무관·로컬 전용) / 기존 테스트 무파손.
3. `phases/08-ui-v0-v11-logic/index.json` step 1 업데이트(성공→completed+summary / 3회 실패→error / 외부개입→blocked).

## 금지사항
- 휴지통 데이터를 서버에 전송하지 마라. 이유: 휴지통은 로컬 전용(ADR-022) — 삭제는 곧 서버 구독 해제이고, 스냅샷은 기기 로컬에만 둔다.
- `now` 없이 `Date.now()` 를 직접 호출하지 마라. 이유: 30일 만료·정리가 결정적 테스트 가능해야 한다(고정 시계 주입).
- `info` 스냅샷을 빼고 적재하지 마라. 이유: 복구 시 메모/카테고리/금액 복원에 필요(보강④ — 스냅샷이 prune 보다 먼저).
- 용량 상한 정리를 생략하지 마라. 이유: 무한 증식 방지(보강④).
- 기존 테스트를 깨뜨리지 마라.
