# 런타임 함정 & 재발 방지 (PITFALLS)

> 실제로 발생했던 버그와 **테스트가 못 잡은 이유**, 정확한 수정 패턴, 재발 방지 규칙을 기록한다.
> 핵심 교훈: **mock 기반 `npm run verify` green 은 순수 로직만 보증한다.** 외부 경계(tracker.delivery·Expo Push·D1 런타임·플랫폼 글로벌)는 green 이어도 깨질 수 있다 — 아래 "외부 경계 검증" 체크리스트로 별도 확인할 것.

---

## P-1. Workers: 플랫폼 글로벌(`fetch`)을 deps 로 주입할 때 `this` 유실

- **증상**: 실제 외부 호출이 전부 `Illegal invocation: function called with incorrect 'this' reference` 로 throw. `tryTrack`/cron 이 null 반환 → 운송장 상태가 항상 **"미등록"**. 등록 요청이 네트워크 왕복 없이 ~6ms 만에 실패(동기 throw).
- **원인**: `track(carrier, no, { fetch, ... })` 처럼 전역 `fetch` 를 객체 프로퍼티로 담아 나중에 `deps.fetch(url)` 로 호출하면 `this` 가 전역이 아닌 `deps` 가 되어 workerd 가 거부한다.
- **수정**: 주입 지점에서 바인딩한다 — `fetch: fetch.bind(globalThis)`. 뿌리는 둘:
  - `worker/src/index.ts` `tryTrack` (등록 즉시 1회 조회)
  - `worker/src/index.ts` `scheduled` (cron → `runPollingBatch`)
  - cron 내부(`cron.ts`)는 주입받은 `deps.fetch` 를 재사용하므로 뿌리만 바인딩하면 전파된다.
- **왜 테스트가 못 잡았나**: 모든 단위/통합 테스트가 **mock fetch(평범한 함수·클로저)** 를 주입한다 → `this` 문제가 없다. 전역 `fetch` 는 실제 런타임에서만 등장하므로 `verify` green 이 이 버그에 무의미했다.
- **재발 방지**:
  - 플랫폼 글로벌(`fetch` 등)을 객체 프로퍼티/콜백으로 넘길 땐 **항상** `*.bind(globalThis)` 또는 화살표 래퍼(`(...a) => fetch(...a)`).
  - 외부 호출을 하는 deps 주입 지점을 추가/수정하면 **실제 API 대상 스모크 1회**(아래 체크리스트)로 확인하기 전엔 "동작 확인" 처리 금지.

## P-2. SQLite `ALTER TABLE ... RENAME` 이 다른 테이블 FK 참조까지 전파

- **증상**: `devices` 재생성 마이그레이션 후 운송장 등록의 `INSERT INTO subscriptions` 가 `D1_ERROR: no such table: main.devices_old` 로 500.
- **원인**: 최신 SQLite(D1 포함) 기본값에서 `RENAME` 은 **다른 테이블·트리거·뷰의 참조까지 새 이름으로 자동 재작성**한다. `devices`→`devices_old` rename 시 `subscriptions.device_id` 의 FK 가 `REFERENCES devices_old(id)` 로 바뀌고, 직후 `DROP TABLE devices_old` 로 깨진다.
- **수정**: rename 전에 `PRAGMA legacy_alter_table=ON;` 으로 전파를 끈다. (`docs/MIGRATION.md §1` 반영 완료.)
- **재발 방지**: 테이블 재생성 마이그레이션 후 `SELECT name FROM sqlite_master WHERE sql LIKE '%<old_name>%'` 로 **옛 이름 잔재 0** 을 검증. 로컬·원격 동일 절차.

## P-3. 로컬 D1 스키마 드리프트 (코드는 바뀌었는데 로컬 D1 는 옛날 생성분)

- **증상**: 코드/`schema.sql` 은 바뀌었는데 로컬 D1 가 이전 생성분 → `push_token NOT NULL`·`notification_queue` 누락으로 **로컬에서만** 데드락·500 재현.
- **원인**: `CREATE TABLE IF NOT EXISTS` 는 **기존 테이블을 변경하지 않는다**(존재 → skip). 또 `schema.sql` 의 `ALTER TABLE ... ADD COLUMN` 은 컬럼이 이미 있으면 `duplicate column` 으로 throw 하여 **그 뒤 문장이 통째로 미적용**된다(예: 뒤에 오는 `notification_queue` 생성이 안 됨).
- **수정/재발 방지**: 스키마 변경 시 **로컬도** `docs/MIGRATION.md` 절차로 마이그레이션. 등록 같은 핫패스는 스키마 변경 후 **실제 요청 1회**로 검증. `npx wrangler d1 execute unboxing --local --command "PRAGMA table_info(<t>)"` 로 로컬 = `schema.sql` 일치 확인.

---

## 외부 경계 검증 체크리스트 (머지·배포 전 필수)

`npm run verify` 가 green 이어도 아래는 **수동/실호출**로 확인한다. 외부 경계는 mock 으로 가려져 단위테스트가 못 잡는다.

1. **tracker.delivery**: 실제 운송장 번호 1건을 로컬 worker(`wrangler dev`)에 등록 → 응답 status 가 실제 단계로 나오는지. (예: `522093451360`=CJ, `44593463530`=로젠 → `배송완료`.) `미등록` 만 나오면 `Illegal invocation`(P-1)·자격증명·NOT_FOUND 중 무엇인지 로그로 구분.
2. **cron 폴링**: `curl "http://localhost:8787/cdn-cgi/handler/scheduled"` 트리거 후 목록 status 가 저장·갱신되는지. (로컬 cron 은 자동 실행 안 됨.)
3. **Expo Push**(가능 시): 실제 토큰 1건으로 발송/리시트 경로 확인.
4. **로컬 D1**: `schema.sql` 과 로컬 스키마 일치(P-3).

## 설계(step) 단계 규칙

- "엣지/에러/테스트" 검토 시 **무엇이 테스트로 커버되고 무엇이 런타임에서만 드러나는지**를 명시한다. 후자(플랫폼 글로벌 바인딩·실 API 계약·D1 런타임 제약)는 **수동 검증 항목으로 AC 에 박는다**.
- 외부 의존을 mock 하는 테스트를 작성할 때, 그 mock 이 **숨기는 실패 모드**(바인딩·인증·rate limit·실제 응답 형태)를 주석/AC 로 남긴다.

## 관련 문서

- `docs/MIGRATION.md` — D1 스키마 마이그레이션 절차(P-2·P-3 적용)
- `docs/ARCHITECTURE.md` "tracker.delivery 연동" — 통합 제약(fetch 바인딩 포함)
- `CLAUDE.md` 개발 프로세스 — 외부 경계 검증 규칙(요약 + 본 문서 포인터)
