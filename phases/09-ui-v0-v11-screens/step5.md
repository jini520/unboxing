# Step 5: 설정(시작 화면·완료 숨기기) + 콜드스타트 라우팅

설정에 **시작 화면**(택배함/대시보드)·**완료된 항목 숨기기** 토글을 추가하고, "모든 데이터 삭제"를 확장된 wipe 에 배선한다. 또 앱 콜드스타트 시 **알림 딥링크 > 시작 화면 preference > 택배함** 우선순위로 초기 화면을 라우팅하고, 메모→정보 마이그레이션을 부팅 1회 실행한다. 라우팅·스토어·`wipeAllData`·마이그레이션은 phase 08 이 제공한다 — **소비**한다.

## 읽어야 할 파일

- `/docs/UI_GUIDE.md` — 설정 행(line 38·167, 시작 화면 라디오·완료 숨기기·모든 데이터 삭제), 콜드스타트 초기 탭(line 42)
- `/docs/PRD.md` — "v1.1 기능 명세" 5(시작 화면)·6(완료 숨기기), 데이터·프라이버시(모든 데이터 삭제 커버리지, line 240~244)
- `/docs/ARCHITECTURE.md` — "v1.1 설계 보강 ③"(콜드스타트 라우팅 우선순위, line 314~315)·"⑦"(마이그레이션 트리거·wipe 커버리지, line 330~332), 로컬 스토어 표(`home_screen`·`list_filter`, line 235~237)
- `/docs/ADR.md` — ADR-025(시작 화면 로컬 preference), ADR-017(모든 데이터 삭제)
- **08 산출물**: 라우팅 `resolveInitialRoute({ lastNotificationResponse, homePref })`, `home_screen` 스토어 get/set, `list_filter`(`hideCompleted`) 스토어, `migrateMemosToInfo`, 확장된 `wipe.ts`(`wipeAllData`)
- 코드: `app/app/(tabs)/settings.tsx`(현 설정·테마 라디오 스타일 참고), `app/app/_layout.tsx`(루트·부트스트랩), `app/src/lib/bootstrap.ts`, `app/src/lib/push.ts`(`getLastNotificationResponseAsync`·`routeForNotification`), `app/src/theme/`

## 작업

### 1. 설정 "표시" 섹션 — `app/app/(tabs)/settings.tsx`
- **시작 화면**: 택배함 / 대시보드 라디오 그룹(테마와 같은 스타일 — 선택 = `accent` + 체크, **기본 택배함**). 변경 시 `home_screen` 로컬 저장.
- **완료된 항목 숨기기**: 토글. `list_filter.hideCompleted` 지속 저장(택배함 step0 필터가 이 값을 읽음).
- **모든 데이터 삭제**: 확장된 `wipeAllData`(08 — 신규 로컬 키 `shipment_info`·`trash`·`notif_last_seen`·`home_screen`·`list_filter` + 기존 cache·device_id·memo 잔여 + 서버 `DELETE /me`) 호출하도록 배선. 안내 카피에 "메모·카테고리·금액·휴지통 포함" 반영.

### 2. 콜드스타트 라우팅 — `app/app/_layout.tsx` / `app/src/lib/bootstrap.ts`
- 부팅 시 `resolveInitialRoute({ lastNotificationResponse: getLastNotificationResponseAsync(), homePref: home_screen })`(08)로 초기 화면 결정: **① 알림 콜드스타트 딥링크(최우선) → ② `home_screen` preference(택배함/대시보드) → ③ 택배함 폴백**.
- `migrateMemosToInfo(store)`(08)를 **부팅에서 1회**(목록·info 첫 읽기 전) 멱등 실행.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차
1. 위 AC 실행(`resolveInitialRoute`·`wipeAllData`·`migrateMemosToInfo` 자체는 08 단위 테스트됨; 배선은 보류 가능[E-3]). typecheck·기존 테스트 무파손.
2. 체크리스트: 콜드스타트 **딥링크 최우선**(시작 화면이 이기지 않음, 보강 ③) / 마이그레이션 부팅 1회 / "모든 데이터 삭제" 가 신규 키 전부 + 서버 `DELETE /me` 폐기(누락 0, 보강 ⑦) / 시작 화면·필터는 로컬 저장(서버 아님) / 색 토큰만.
3. `phases/09-ui-v0-v11-screens/index.json` step 5 업데이트(성공→completed+summary / 실패→error / 외부개입→blocked).

## 금지사항
- 알림 딥링크보다 시작 화면 preference 를 우선하지 마라. 이유: 알림으로 켜지면 해당 상세가 시작 화면을 이긴다(보강 ③).
- "모든 데이터 삭제"에서 신규 로컬 키를 빠뜨리지 마라. 이유: 잔존 데이터 — 회귀 금지(보강 ⑦). 반드시 08 의 `wipeAllData` 를 단일 경로로 사용.
- 시작 화면·필터 설정을 서버에 저장하지 마라. 이유: 로컬 preference(ADR-025) — 비영속·익명 모델 유지.
- `migrateMemosToInfo` 를 매 부팅마다 변환 실행하지 마라(멱등 1회 — 신 키 있으면 no-op). 기존 테스트를 깨뜨리지 마라.
