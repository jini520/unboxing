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

## 적용 후 확인

```bash
# 스키마 확인
npx wrangler d1 execute unboxing --command="SELECT name FROM sqlite_master WHERE type='table'" --remote
# devices.push_token 이 nullable 인지(notnull=0)
npx wrangler d1 execute unboxing --command="PRAGMA table_info(devices)" --remote
```

`devices.push_token` 의 `notnull` 이 `0`, `notification_queue` 가 테이블 목록에 보이면 적용 완료.

## 관련 문서

- `docs/ARCHITECTURE.md` "스키마 진화 / 마이그레이션"·"데이터 모델"
- step0(register-fix)·step3(quiet-hours) 산출물 · `worker/schema.sql`
