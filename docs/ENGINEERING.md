# ENGINEERING (통합 문서)

> **비메인 참고 문서 — 실수 재발 방지가 목적이라 정밀하게 유지.** 런타임 함정(PITFALLS)과 D1 마이그레이션 절차를 통합.
> 메인 설계 문서는 `PRD`·`ADR`·`ARCHITECTURE`·`UI_GUIDE`. 각 절은 원문 그대로(verbatim) 보존.
> 본문에 나오는 옛 파일명(`PITFALLS.md`·`MIGRATION.md`)은 모두 **이 문서의 해당 절(A·B)**을 가리킨다.

## 목차
- [A. 런타임 함정 & 재발 방지](#a-런타임-함정--재발-방지-구-pitfallsmd)
- [B. D1 마이그레이션 절차](#b-d1-마이그레이션-절차-구-migrationmd)

<a id="a-런타임-함정--재발-방지-구-pitfallsmd"></a>

---

# A. 런타임 함정 & 재발 방지 (구 `PITFALLS.md`)

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
   - **수취인 패스스루(step2)**: `GET /shipments/:id` 응답의 `recipient`(이름·지역명)가 실제로 채워지는지·마스킹 형태 확인(쿼리 필드명 `recipient { name location { name } }` 변경은 외부 경계라 mock verify 가 못 잡음). 수취인은 **GET /:id track 패스스루(미저장, ADR-005)** — D1 저장·로그 금지, `phoneNumber` 미수신.
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


<a id="b-d1-마이그레이션-절차-구-migrationmd"></a>

---

# B. D1 마이그레이션 절차 (구 `MIGRATION.md`)

# 배포 마이그레이션 노트 (D1)

> 원격 D1 스키마를 코드와 일치시키는 **수동 적용 절차**. `qa-fixes` phase 가 바꾼 스키마를 집계한다.
> 스키마 단일 출처: `worker/schema.sql`(= `worker/src/schema.ts SCHEMA_STATEMENTS`, 1:1 유지).

## 적용 명령 (worker/ 에서)

```bash
npx wrangler d1 execute unboxing --file=./schema.sql --remote
```

`schema.sql` 은 idempotent(`CREATE TABLE/INDEX IF NOT EXISTS`)라 **반복 실행 안전**하다. 단, 아래 두 변경은 `IF NOT EXISTS` 만으로 **기존 원격 테이블에 자동 반영되지 않으므로** 주의한다.

## qa-fixes phase 스키마 변경

### 1. `devices.push_token` NOT NULL → nullable (step0, QA-001)

- **변경**: `push_token TEXT NOT NULL UNIQUE` → `push_token TEXT UNIQUE`(NULL 허용). 푸시 거부/미허용 기기도 등록 가능(등록 데드락 해소).
- **주의**: SQLite 는 `ALTER TABLE ... DROP NOT NULL` 을 지원하지 않는다. **이미 `NOT NULL` 로 생성된 원격 `devices` 테이블에는 `CREATE TABLE IF NOT EXISTS` 가 효과 없다**(이미 존재 → skip).
- **적용 절차(기존 테이블이 NOT NULL 인 경우만)** — 테이블 재생성:

  ```sql
  -- worker/ 에서 한 번만 실행. devices 데이터는 비영속(device_id 소실 허용, ADR-002/005)이라 보존 부담 작음.
  PRAGMA foreign_keys=OFF;
  PRAGMA legacy_alter_table=ON;   -- CRITICAL: RENAME 이 다른 테이블 FK 까지 새 이름으로 재작성하는 것을 막는다(아래 주의 참고).
  ALTER TABLE devices RENAME TO devices_old;
  CREATE TABLE devices (
    id          TEXT PRIMARY KEY,
    push_token  TEXT UNIQUE,            -- NULL 허용
    platform    TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  INSERT INTO devices (id, push_token, platform, created_at)
    SELECT id, push_token, platform, created_at FROM devices_old;
  DROP TABLE devices_old;
  PRAGMA legacy_alter_table=OFF;
  PRAGMA foreign_keys=ON;
  ```

  - **CRITICAL — `legacy_alter_table=ON` 필수**: 최신 SQLite(D1 포함)는 기본적으로 `ALTER TABLE ... RENAME` 시 **다른 테이블·트리거·뷰의 참조까지 새 이름으로 자동 재작성**한다. 이 PRAGMA 없이 `devices`→`devices_old` 로 rename 하면 `subscriptions.device_id` 의 FK 가 `REFERENCES devices_old(id)` 로 바뀌고, 직후 `DROP TABLE devices_old` 로 깨진다(이후 구독 INSERT 가 `no such table: devices_old` 로 500). `legacy_alter_table=ON` 으로 전파를 끄면 `subscriptions` FK 는 `devices(id)` 를 그대로 가리켜 재생성된 새 `devices` 에 정상 연결된다.
  - `subscriptions.device_id` 는 `devices(id)` 를 FK 참조한다 → `foreign_keys=OFF` 로 잠시 끄고 데이터 보존 후 다시 켠다. `id` 값은 보존되므로 구독 관계는 유지된다.
  - **신규 배포(아직 `devices` 미생성)**: 위 절차 불필요 — `schema.sql` 이 처음부터 nullable 로 생성한다.

### 2. `notification_queue` 신규 테이블 (step3, 조용시간 보류 큐)

- **변경**: `CREATE TABLE IF NOT EXISTS notification_queue (...)` 추가(야간 보류 메시지 스냅샷).
- **적용**: `IF NOT EXISTS` 라 `schema.sql` 재실행 시 **자동 생성**된다(별도 수동 작업 불필요).
- `shipment_id` 는 `shipments(id) ON DELETE CASCADE` 참조 — 송장 삭제 시 보류분 자동 정리.

## 05-redesign-data phase 스키마 변경

### 3. `shipments.status_changed_at` 신규 컬럼 (step0, 상태 변경 시각)

- **변경**: `ALTER TABLE shipments ADD COLUMN status_changed_at INTEGER` 추가(현재 단계가 시작된 시각, epoch ms). 단계 전환 시에만 갱신한다(폴링마다 ❌).
- **주의**: `ALTER TABLE ... ADD COLUMN` 은 컬럼이 이미 있으면 `duplicate column` 으로 throw → `schema.sql` 전체 재실행으로 자동 반영되지 **않는다**. 기존 원격 `shipments` 에는 아래 명령을 **최초 1회만** 실행한다. 단순 ADD COLUMN 이라 RENAME 전파(P-2) 이슈는 없다.

  ```bash
  # worker/ 에서. 최초 1회만(재실행 시 duplicate column 에러).
  npx wrangler d1 execute unboxing --remote --command "ALTER TABLE shipments ADD COLUMN status_changed_at INTEGER"
  ```

- **backfill 안전**: 기존 행은 컬럼이 NULL 이 되지만 API 직렬화가 `status_changed_at ?? created_at` 으로 폴백하므로 backfill 없이도 안전하다(등록 시각을 단계 시작 시각으로 표시).
- **신규 배포(아직 `shipments` 미생성)**: 위 명령 불필요 — `schema.sql` 의 ALTER 가 처음 적용 시 컬럼을 만든다.

### 4. `subscriptions.muted` 신규 컬럼 (step1, ADR-020 송장별 음소거)

- **변경**: `ALTER TABLE subscriptions ADD COLUMN muted INTEGER NOT NULL DEFAULT 0` 추가(per-구독 알림 음소거, 1=음소거/0=켜짐). 기존 구독은 DEFAULT 0 으로 전부 알림 켜짐 유지(안전).
- **주의**: status_changed_at(§3)과 동일 — `ADD COLUMN` 은 컬럼이 이미 있으면 `duplicate column` throw → 기존 원격 `subscriptions` 에는 아래 명령을 **최초 1회만**. 단순 ADD COLUMN 이라 RENAME 전파(P-2) 이슈 없음.

  ```bash
  # worker/ 에서. 최초 1회만(재실행 시 duplicate column 에러).
  npx wrangler d1 execute unboxing --remote --command "ALTER TABLE subscriptions ADD COLUMN muted INTEGER NOT NULL DEFAULT 0"
  ```

- **NOT NULL+DEFAULT 0 안전**: SQLite 는 NOT NULL 컬럼도 DEFAULT 가 있으면 기존 행에 그 값을 채워 ADD COLUMN 이 성공한다.
- **신규 배포(아직 `subscriptions` 미생성)**: 위 명령 불필요 — `schema.sql` 의 ALTER 가 처음 적용 시 컬럼을 만든다.

## 적용 후 확인

```bash
# 스키마 확인
npx wrangler d1 execute unboxing --command="SELECT name FROM sqlite_master WHERE type='table'" --remote
# devices.push_token 이 nullable 인지(notnull=0)
npx wrangler d1 execute unboxing --command="PRAGMA table_info(devices)" --remote
# shipments.status_changed_at 컬럼 존재 확인
npx wrangler d1 execute unboxing --command="PRAGMA table_info(shipments)" --remote
# subscriptions.muted 컬럼 존재 확인(notnull=1, dflt=0)
npx wrangler d1 execute unboxing --command="PRAGMA table_info(subscriptions)" --remote
```

`devices.push_token` 의 `notnull` 이 `0`, `notification_queue` 가 테이블 목록에 보이고, `shipments` 에 `status_changed_at`·`subscriptions` 에 `muted` 컬럼이 보이면 적용 완료.

## 관련 문서

- `docs/ARCHITECTURE.md` "스키마 진화 / 마이그레이션"·"데이터 모델"
- step0(register-fix)·step3(quiet-hours) 산출물 · `worker/schema.sql`
