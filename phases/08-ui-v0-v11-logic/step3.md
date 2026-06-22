# Step 3: unread-route-wipe — 알림 미읽음 계산 + 콜드스타트 라우팅 + wipe 확장 + 설정 스토어

알림 미읽음 수(로컬 읽음 상태), 콜드스타트 초기 라우팅 우선순위, 시작화면·필터 설정 스토어, 그리고 "모든 데이터 삭제"가 v1.1 신규 로컬 키까지 폐기하도록 `wipeAllData` 를 확장한다. 모두 순수 로직·스토어 주입. test-first. 화면 배선은 09 phase.

## 읽어야 할 파일

먼저 아래를 읽고 읽음/라우팅/설정 스토어·wipe 커버리지를 파악하라:

- `/docs/ARCHITECTURE.md` — "로컬 스토어" 표(알림 읽음·시작 화면·택배함 필터), "v1.1 설계 보강 ③"(콜드스타트 우선순위: 딥링크 > 시작화면 > 택배함)·"⑤"(읽음 첫 실행 `now` 초기화·`99+`)·"⑦"(wipe 커버리지)
- `/docs/ADR.md` — ADR-023(읽음은 로컬), ADR-025(시작화면 preference·기본 택배함), ADR-017(모든 데이터 삭제 = 로컬 전부 + 서버 `DELETE /me`)
- `/docs/QA.md` — "E-1" 알림 읽음/미읽음·콜드스타트 라우팅 케이스, "E-4" E11(첫 실행 lastSeen)·E17(딥링크 우선)·E19(wipe 신규 키)
- `app/src/lib/wipe.ts` — 현 `wipeAllData`(폐기 대상 확장), `app/src/lib/bootstrap.ts`(콜드스타트·`routeForNotification` 있으면 재사용), `app/src/lib/cache.ts`(KeyValueStore), `app/src/lib/api.ts`(`DELETE /me` 호출), `app/src/lib/push.ts`/`usePushNotifications.ts`(알림 응답 타입)

## 작업

### 1. `app/src/lib/notif.ts` — 미읽음/읽음 (보강⑤)
- 읽음 스토어 `unboxing.notif_last_seen`(`number` epoch ms, KeyValueStore 주입).
- `unreadCount(notifs, lastSeen): number` — `sentAt > lastSeen` 수. **`lastSeen` 미설정(첫 fetch) → `now` 로 초기화 → 0**(기존 기록 미읽음 폭주 방지, E11).
- `markSeen(store, now, latestSentAt)` — `lastSeen = max(now, latestSentAt)` 저장(알림 화면 열람·모두읽음).
- `badgeText(count): string` — `99+` 상한 표시 헬퍼.

### 2. 콜드스타트 라우팅 (보강③) — `resolveInitialRoute`
- `resolveInitialRoute({ lastNotificationResponse, homePref }): Route`
  - ① 알림 딥링크 존재(`lastNotificationResponse` 의 shipment id) → `/shipment/:id`(**최우선**).
  - ② 없으면 `homePref`(`"list"`|`"dashboard"`).
  - ③ 미설정/실패 → 택배함(`"list"`).
- 기존 `routeForNotification`(있으면) 재사용(딥링크 대상 해석). `app/src/lib/route.ts` 신규 또는 `bootstrap.ts` 확장 — 기존 구조에 맞춰 배치.

### 3. 설정 스토어 (순수 load/save)
- 시작 화면 `unboxing.home_screen`(`"list"|"dashboard"`, 기본 `"list"`) — `loadHomePref`/`saveHomePref`.
- 택배함 필터 `unboxing.list_filter`(`{ hideCompleted: boolean }`, 기본 false) — `loadListFilter`/`saveListFilter`. (상태 칩은 세션 UI 상태라 비지속 — 여기 저장 안 함.)

### 4. `wipeAllData` 확장 (보강⑦) — `wipe.ts`
- **신규 로컬 키 전부** 폐기: `shipment_info`·`trash`·`notif_last_seen`·`home_screen`·`list_filter`(step1·2 의 `clearTrash`/`clearInfo` 재사용 + 읽음·설정 키 제거) + 기존(cache·device_id·memo 잔여) + 서버 `DELETE /me`(→ `notifications` 정리, 07 phase).
- 누락 시 잔존 데이터(회귀 금지).

## 테스트 (TDD)
- `notif.test.ts`(`now` 고정): `unreadCount`=`sentAt>lastSeen` / `lastSeen` 미설정 → `now` 초기화 → 0(E11) / `markSeen`=`max(now, 최신 sentAt)` / `badgeText` `99+` 상한.
- `route.test.ts`(또는 bootstrap): 딥링크 존재 → `/shipment/:id`(E17 최우선) / 없으면 homePref / 미설정·실패 → 택배함.
- 설정 스토어: load 기본값·save 왕복.
- `wipe.test.ts` 확장: `wipeAllData` 가 **신규 로컬 키 전부**(`shipment_info`·`trash`·`notif_last_seen`·`home_screen`·`list_filter`) + 서버 `DELETE /me` 호출(누락 0, E19).

## Acceptance Criteria
```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차
1. 위 AC 실행.
2. 체크리스트: 첫 실행 `now` 초기화(폭주 없음) / 딥링크 최우선 / 시작화면·필터 기본값 / wipe **신규 키 누락 0** / `now` 주입 / 로컬 전용 / 기존 테스트 무파손.
3. `phases/08-ui-v0-v11-logic/index.json` step 3 업데이트(성공→completed+summary / 3회 실패→error / 외부개입→blocked).

## 금지사항
- `lastSeen` 미설정 시 전체를 미읽음으로 세지 마라. 이유: 기존 기록이 한꺼번에 미읽음 배지로 폭주(보강⑤ — `now` 초기화).
- `resolveInitialRoute` 에서 시작화면 preference 가 알림 딥링크를 이기게 하지 마라. 이유: 알림으로 켜진 앱은 그 상세로 가야 한다(보강③ 우선순위).
- `wipeAllData` 에서 신규 로컬 키를 빠뜨리지 마라. 이유: "모든 데이터 삭제" 후 잔존 데이터 = 회귀(E19).
- 읽음/설정/필터를 서버에 동기화하지 마라. 이유: 로컬 전용(ADR-023·025) — 계정 동기화는 Phase 2.
- 기존 테스트를 깨뜨리지 마라.
