# Step 1: register-flow (등록 여정 E2E QA)

운송장 등록 사용자 여정을 **지름길 없이** E2E로 검증하고 사양 갭을 기록한다. (이 phase는 발견·기록만 — 수정 금지.)

> **QA 철칙: 버그를 고치지 마라.** 갭은 `it.todo("QA-NNN: …")` + `docs/QA_FINDINGS.md` 기록. AC(verify)는 green 유지. find↔fix 분리.

## 읽어야 할 파일

- `/docs/PRD.md` — "핵심 플로우" 1(등록)·5(권한 거부 시 등록 가능)·6(미등록/오타 번호), "핵심 기능" 1~2
- `/docs/ARCHITECTURE.md` — "HTTP API 계약"(`/devices`·`/shipments`), "동시성"(dedupe), "보안"(throttle)
- `/docs/ADR.md` — ADR-002/007(익명·device_id), ADR-008(throttle·상한)
- `/Users/jinni/Developments/unboxing/worker/src/index.ts` — `handleRegisterDevice`·`handleCreateShipment`·`enforceIpRateLimit`
- `/Users/jinni/Developments/unboxing/app/src/lib/api.ts`·`app/app/register.tsx`·`app/src/lib/carrier.ts`
- `/Users/jinni/Developments/unboxing/phases/qa-mvp/step0.md` 산출 `worker/test/e2e/scenario.ts`, `docs/QA_FINDINGS.md`

## 작업

`worker/test/e2e/register.test.ts`에 **사용자 순서 그대로**의 시나리오 테스트:

1. **(P0 재확인) 푸시 없이 등록** — device 선등록 없이 `POST /shipments` → 현재 401. PRD 플로우5는 "권한 거부해도 등록 가능"이므로 **갭**. `it.todo("QA-001: 푸시 없이 등록 불가 — issue #3")`로 두고 `QA_FINDINGS.md` 확인(이미 시드됨).
2. **정상 흐름**(device를 토큰으로 등록한 뒤): 운송장 등록 201 → 동일 기기 재등록 200(멱등, 행 1) → 두 기기 같은 송장 dedupe(shipments 1·subscriptions 2) → `GET /shipments` 내 것만 → 타 기기 `GET/DELETE /:id` 404 → 활성 상한 초과 429.
3. **형식/매핑**: carrier 형식 오류 409·운송장 `^\d{9,14}$` 위반 422 → 앱이 친근한 카피로 매핑하는지(register.tsx ERROR_COPY, 코드 비노출) audit.
4. **택배사 추정**(app `carrier.ts`): 번호 형식별 후보가 사양대로인지, 빈/무효 입력 처리 audit.

발견한 모든 갭을 `docs/QA_FINDINGS.md`에 append(ID·심각도·재현·현재·기대·제안수정).

## 핵심 규칙 (벗어나면 안 됨)

- 테스트가 device를 **임의로 INSERT하지 마라** — 앱이 하듯 `POST /devices`를 거치거나, 안 거친 상태 그대로 테스트한다. 이유: 지름길이 QA-001을 못 잡은 원인.
- 갭은 todo/skip + FINDINGS. 코드 수정 금지.

## Acceptance Criteria

```bash
npm run verify
```

## 검증 절차

1. AC 실행. 2. 체크리스트: 지름길 없는 시나리오인가? 멱등·dedupe·인가404·throttle이 실 흐름으로 검증되는가? 갭이 FINDINGS에 기록됐는가? 3. `phases/qa-mvp/index.json` step 1 업데이트(summary에 발견 건수·ID 명시).

## 금지사항

- 버그를 고치지 마라(수정은 별도). 이유: QA 전용.
- 갭을 실패 단언으로 verify를 깨지 마라(todo/skip). 기존 테스트 깨뜨리지 마라.
