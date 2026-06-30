# Step 22: register-fix (#3 P0 — 푸시 없이 등록 데드락 해소)

기기 등록을 푸시 토큰에서 분리해, 푸시를 거부/미허용한 사용자(시뮬레이터 포함)도 운송장 등록이 되게 한다. **이슈 #3(QA-001) 해소** — 핵심 기능 차단 제거.

## 읽어야 할 파일

- GitHub 이슈 **#3** 및 `/docs/QA_FINDINGS.md`의 **QA-001** 행(재현·제안수정)
- `/docs/PRD.md` — 핵심 플로우 5("권한 거부 시 등록·인앱 조회 가능"), NFR
- `/docs/ARCHITECTURE.md` — "HTTP API 계약"(`POST /devices`·`/shipments`), "디바이스 식별 & 인증/인가"
- `/docs/ADR.md` — ADR-007(device_id가 자격), ADR-002(익명)
- `/Users/jinni/Developments/unboxing/worker/schema.sql`·`worker/src/schema.ts` — `devices` 정의
- `/Users/jinni/Developments/unboxing/worker/src/index.ts` — `handleRegisterDevice`·`handleCreateShipment`
- `/Users/jinni/Developments/unboxing/app/src/lib/api.ts`·`device.ts`·`deps.ts`, `app/app/_layout.tsx`, `app/src/lib/usePushNotifications.ts`
- `/Users/jinni/Developments/unboxing/worker/test/e2e/register.test.ts` — qa-mvp가 남긴 `it.todo("QA-001: …")`

## 작업

근본 원인: `devices.push_token NOT NULL` + `POST /devices`가 유효 토큰 필수 → 토큰 없으면 device 미등록 → `POST /shipments`가 401. **device 식별(ADR-007)과 push_token을 분리**한다.

1. **schema** (`schema.sql` + `schema.ts` 동일하게): `devices.push_token`을 **nullable**로 (`TEXT UNIQUE`, NOT NULL 제거 — SQLite는 UNIQUE 컬럼의 NULL 중복 허용). 다른 컬럼·제약 불변.
2. **worker `handleRegisterDevice`**: 바디를 `{platform, push_token?}`로 — `push_token`이 있으면 `EXPO_TOKEN_RE` 검증 후 저장, **없으면 NULL로 device 행 생성/갱신**(upsert). platform은 필수 유지. 토큰 없이도 200 `{device_id}`.
3. **app**: `api.ts`의 `registerDevice`를 토큰 optional로(또는 `ensureDevice(platform)` 추가). **앱 시작 시(`_layout` 또는 `apiDeps` 부트스트랩) 푸시와 무관하게 device를 1회 등록**(`POST /devices {platform}`, 토큰 생략). 푸시 허용 시 기존 경로가 토큰을 갱신(`usePushNotifications`/온보딩/설정). 등록 화면 진입 전 device가 존재하도록 보장.

## 핵심 규칙 (벗어나면 안 됨)

- device_id는 여전히 자격(ADR-007) — 클라가 생성, Bearer로 전송, 로그 금지. push_token만 분리한다.
- `push_token UNIQUE` 유지(중복 비-NULL 토큰 금지). NULL은 여러 행 허용.
- `POST /shipments`의 "기기 선등록 필요" 자체는 유지 — 단 이제 토큰 없이도 기기가 등록되므로 거부 사용자도 통과한다.
- 개인정보 비영속·기존 멱등/dedupe 동작 불변.

## 엣지케이스 & 에러 처리 (반드시 다룰 것)

- **(C1) NULL 토큰을 푸시 경로에서 제외 — 회귀 방지**: push_token이 nullable이 되면 토큰 없는 device가 송장을 구독할 수 있다. `cron.ts`의 `subscriberTokens`(및 토큰을 모으는 모든 쿼리)에 **`WHERE d.push_token IS NOT NULL`** 를 추가하라. 안 하면 `sendPush({to: null})` 로 Expo 오발송/에러 — 데드락 고치다 알림을 깨는 회귀다.
- **(C3) 등록 보장 — 데드락 재발 방지**: 시작 시 `POST /devices` 가 오프라인/5xx 로 실패하면 device 미등록 → 등록에서 다시 401. 시작 1회로 끝내지 말고 **`createShipment` 직전에도 device 등록을 보장(ensure + 실패 시 재시도)**하라. 멱등 upsert 라 중복 호출 안전. **단 성공 시 세션 내 플래그로 캐시**해 매 등록마다 `/devices` 를 재호출하지 마라(중복 호출 + IP rate-limit(ADR-008) 소모 방지).
- **(E1) push_token UNIQUE 충돌**: 토큰이 기기 간 이동(재설치·복원)하면 `ON CONFLICT(id) DO UPDATE SET push_token` 이 다른 기기의 토큰과 `UNIQUE(push_token)` 충돌 → D1 에러(500). 같은 토큰을 보유한 **다른 device 의 토큰을 먼저 NULL 로 정리**하거나 충돌을 흡수하라(토큰은 전역 유일 유지).
- **device_id 있는데 행 없음(재설치)**: `POST /shipments` 는 device 존재를 요구(401 유지). ensure 경로가 재생성하므로 정상 흐름은 막히지 않아야 한다.
- **wipe 후 재등록(C3 하위)**: `DELETE /me` 로 device_id 폐기 후 새 device_id 가 생기는데 `_layout` 의 시작-시 등록은 재실행 안 됨 → **ensure-before-`createShipment`** 가 새 device_id 를 재등록해야 데드락 재발 안 함(설정의 wipe 직후 재등록도 연계).
- **앱측 E2E 부재**: 앱→실 worker 전체 경로는 자동 E2E 가 없다(RNTL 보류) → 로직 테스트(mock)로 ensure 호출을 검증하되, **수동 런스루**(QA_TESTPLAN: 시뮬레이터에서 푸시 거부 후 등록 성공)로 최종 확인을 권장하고 그 항목을 QA_TESTPLAN 에 추가.
- **마이그레이션**: 기존 D1 은 `CREATE IF NOT EXISTS` 라 자동 변경 안 됨(아래 배포 메모). 로컬 재테스트 시 `devices` 재생성 필요.

## 검증 (수정 증명)

> qa-mvp 가 남긴 `it.todo("QA-NNN…")` 의 정확한 위치는 **grep 으로 확인**하라(아래 파일 경로는 참고용).

- `worker/test/e2e/register.test.ts`의 `it.todo("QA-001…")`를 **통과 테스트로 전환**: 토큰 없이 `POST /devices {platform}` → 그 device로 `POST /shipments` → **201**(401 아님). 토큰 있는 기존 경로도 통과 유지.
- **같은 파일의 `it("[QA-001 재현] … → 401")` 도 처리**: qa-mvp 가 현재 버그(401)를 단언하는 재현 테스트를 남겼다 — 수정하면 401→201 로 깨지므로 **단언을 201 로 뒤집거나 todo 와 병합**하라(재현 테스트를 방치하면 verify red).
- **NULL 토큰 device 구독 송장이 전환돼도 cron이 그 device에 푸시하지 않음**(C1) — E2E 추가.
- **이중 등록 멱등**: 토큰 없이 등록 후, 토큰으로 재등록(upsert) → device 1행·push_token 갱신.
- app 테스트: `ensureDevice`(또는 토큰 optional `registerDevice`)가 토큰 없이 `{platform}`만으로 `/devices` 호출 + `createShipment` 전 ensure 보장(주입 fetch).
- 기존 `shipments.test.ts`(토큰으로 선등록하던 케이스)도 계속 green.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. AC 실행. 2. 체크리스트: 토큰 없이 등록→운송장 등록이 201인가? push_token UNIQUE·NULL 동작? device_id 로그 부재? ARCHITECTURE/ADR-007 정합? 3. `phases/qa-fixes/index.json` step 0 업데이트(summary에 "fixes #3 (#6 자동 해소)" 기록). **이슈 자동 닫기는 execute.py 고정 커밋이 아니라 qa-fixes PR 본문(`Closes #3 #6`)에서 처리** — step 세션은 summary 기록까지만.

## 금지사항

- device_id를 push_token에 다시 묶지 마라. 이유: 이 데드락의 근원.
- 기존 멱등(200/201)·dedupe·인가(404)·throttle을 깨지 마라. 이유: 회귀 금지.
- `push_token`을 nullable로 바꾸되 UNIQUE를 제거하지 마라. 이유: 동일 토큰 중복 등록 방지.
- 기존 테스트를 깨뜨리지 마라.

## 참고 (배포 메모, 이 step의 코드 범위 밖)

기존 원격/로컬 D1은 `CREATE IF NOT EXISTS`라 자동 변경 안 됨 → `devices` 테이블 재생성 마이그레이션이 배포 시 필요(테스트는 fresh schema라 영향 없음). 이 step은 schema 정의 + 코드까지; 원격 마이그레이션은 배포 단계.
