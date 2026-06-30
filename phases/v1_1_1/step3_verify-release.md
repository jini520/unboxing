# Step 3: verify-release (전체 verify · 버전 범프 · 스모크 체크리스트)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/docs/PRD.md` — "v1.1.1 완료 기준(DoD)" 전체(#1~#4 + 외부 경계 스모크).
- `/docs/ENGINEERING.md` — **P-9**(키보드 회피 모달 스모크 — jest가 못 잡는 런타임 네이티브 경계) 및 "실호출 체크리스트"의 v1.1.1 항목(수취인 마스킹 게이트·키보드 회피 모달).
- `/CLAUDE.md` — **mock `verify` green은 순수 로직만 보증**한다. 외부 경계(플랫폼 네이티브·tracker.delivery)는 green이어도 깨질 수 있어 **머지·배포 전 실호출/실기기 스모크 1회 필수**.
- `app/app.json` — 현재 `version: "1.1.0"`.
- step 0~2 산출물: `app/src/lib/recipient.ts`(+test), `app/app/shipment/[id].tsx`, `app/app/(tabs)/settings.tsx`.

## 작업

### 1. 전체 verify
- `npm run verify` 를 실행해 typecheck + test(app + worker + harness) 전부 green 확인. red면 **이 step에서 고치지 말고** 해당 step(0~2)의 회귀이므로 원인 step을 짚어 `error_message` 에 남긴다.

### 2. 버전 범프 (ADR-035 패치 라인)
- `app/app.json` 의 `version` 을 `"1.1.0"` → `"1.1.1"` 로 올린다.
- `app.json` 에 iOS `ios.buildNumber`·Android `android.versionCode` 가 있으면 스토어 업로드용으로 1 증가시킨다(없으면 생략 — 실제 스토어 업로드는 외부 작업).

### 3. 스모크 체크리스트 기록 (실행은 외부 경계)
- `npm run verify` 가 **못 잡는** 두 외부 경계를 체크리스트로 남긴다(이미 ENGINEERING 실호출 체크리스트 v1.1.1 항목에 있음 — 없으면 보강, 있으면 "미수행" 상태로 명시):
  - **#4 키보드 회피 모달**(P-9): 상세의 택배 정보·운송장 수정 모달을 **시뮬레이터/실기기**에서 열고 입력 포커스 → 입력·액션 버튼이 키보드에 안 가리는지, **바깥 탭으로 안 닫히는지(키보드만 접힘)** 확인.
  - **#1 수취인 마스킹 게이트**(ADR-032): 실 운송장 중 **마스킹 케이스**(예 한진 `받는 분`·`김**`) 1건으로 라벨/완전마스킹은 숨고 부분마스킹은 표시되는지 확인(denylist 보강 입력).
- 이 스모크는 **이 세션에서 실행 불가**(실기기·실 운송장 외부 의존). 체크리스트만 남기고, summary에 **"실 스모크 미수행 — 사용자 수행 필요"** 를 명시한다.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 green
```
- `app/app.json` 의 `version` 이 `"1.1.1"`.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - `version` 이 `1.1.1` 로 범프됐다.
   - 외부 경계 스모크 2건이 체크리스트로 남았고, 미수행이면 summary에 명시됐다.
   - CLAUDE.md "mock green ≠ 런타임 정상" 원칙대로, verify green만으로 완료라 단정하지 않았다.
3. 결과에 따라 `phases/v1_1_1/index.json` 의 step 3 을 업데이트한다:
   - 성공(verify green + 버전 범프 + 체크리스트) → `"status": "completed"`, `"summary": "verify green·version 1.1.1·실 스모크(#1·#4) 미수행 사용자 수행 필요"`.
   - verify red → `"status": "error"`, `"error_message": "어느 step의 회귀인지 + 에러"`.

## 금지사항

- 실행하지 않은 스모크를 "통과"로 적지 마라. 이유: 외부 경계는 실호출로만 검증된다(CLAUDE.md). 거짓 green은 배포 사고로 이어진다.
- step 0~2 의 코드를 이 step에서 리팩터링하지 마라. 이유: 이 step은 verify·버전·체크리스트만. red면 원인 step을 짚어 되돌린다.
- 버전을 마이너(1.2.0)로 올리지 마라. 이유: 본 묶음은 패치 라인 v1.1.1(ADR-035).
- 기존 테스트를 깨뜨리지 마라.
