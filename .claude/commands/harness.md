이 프로젝트는 Harness 프레임워크를 사용한다. 아래 워크플로우에 따라 작업을 진행하라.

---

## 워크플로우

### A. 탐색

`/docs/` 하위 문서(PRD, ARCHITECTURE, ADR, UI_GUIDE)를 읽고 프로젝트의 기획·아키텍처·설계 의도를 파악한다. 필요시 Explore 에이전트를 병렬로 사용한다.

### B. 논의

구현을 위해 구체화하거나 기술적으로 결정해야 할 사항이 있으면 사용자에게 제시하고 논의한다.

### C. Step 설계

사용자가 구현 계획 작성을 지시하면 여러 step으로 나뉜 초안을 작성해 피드백을 요청한다.

설계 원칙:

1. **Scope 최소화** — 하나의 step에서 하나의 레이어 또는 모듈만 다룬다. 여러 모듈을 동시에 수정해야 하면 step을 쪼갠다.
2. **자기완결성** — 각 step 파일은 독립된 Claude 세션에서 실행된다. "이전 대화에서 논의한 바와 같이" 같은 외부 참조는 금지한다. 필요한 정보는 전부 파일 안에 적는다.
3. **사전 준비 강제** — 관련 문서 경로와 이전 step에서 생성/수정된 파일 경로를 명시한다. 세션이 코드를 읽고 맥락을 파악한 뒤 작업하도록 유도한다.
4. **시그니처 수준 지시** — 함수/클래스의 인터페이스만 제시하고 내부 구현은 에이전트 재량에 맡긴다. 단, 설계 의도에서 벗어나면 안 되는 핵심 규칙(멱등성, 보안, 데이터 무결성 등)은 반드시 명시한다.
5. **AC는 실행 가능한 커맨드** — "~가 동작해야 한다" 같은 추상적 서술이 아닌 `npm run verify` 같은 실제 실행 가능한 검증 커맨드를 포함한다.
6. **주의사항은 구체적으로** — "조심해라" 대신 "X를 하지 마라. 이유: Y" 형식으로 적는다.
7. **네이밍 (CRITICAL — 버전 단위 디렉토리)**

   **Phase 디렉토리 = release 버전 1개**: `v{MAJOR}_{MINOR}_{PATCH}` 형식으로 만든다(예: `v1_1_0`). 카테고리·글로벌 순번·descriptor 없음. execute.py 가 이 규칙을 정규식(`^v\d+_\d+_\d+$`)으로 검증하고(어긋나면 경고), 브랜치(`feat-{디렉토리}`, 예 `feat-v1_1_0`)를 이 이름에서 파생한다.
   - 버전은 `app/app.json` 의 `version`(=출시 버전)과 일치시킨다. 점(`.`)은 디렉토리명에 `_` 로 쓴다(`1.1.0` → `v1_1_0`).
   - **버전당 디렉토리 1개.** 같은 버전으로 나가는 추가/수정 작업은 **새 디렉토리를 만들지 말고 이 디렉토리에 step 을 append** 한다(아래 원칙 8).
   - 새 디렉토리는 **버전을 bump 해서 출시**할 때만 만든다(`1.1.0`→`1.2.0` 새 기능, `1.1.0`→`1.1.1` 패치 등).
   - 예: `v1_0_0`(Phase 1 MVP) · `v1_1_0`(v1.1) · `v1_2_0`.

   **커밋 scope = step 의 layer**: 카테고리는 디렉토리에서 빠지고 **step 속성(`layer`)** 으로 내려간다. execute.py 가 step 의 `layer` 를 커밋 scope 로 쓴다(`feat(backend): …`, `feat(frontend): …`). layer 누락 시 `misc` 폴백.

   **layer(확정 목록·진행 순서)** — 한 버전 안의 step 은 아래 순서로 나열한다(원칙 8). 주된 산출물/레이어로 분류. 새 layer 가 필요하면 이 목록에 **먼저 추가**하고 사용한다.
   1. `backend`: Cloudflare Worker·D1·cron·HTTP API·tracker.delivery 연동 등 서버.
   2. `frontend`: Expo 앱 화면·컴포넌트·클라이언트 로직·네비게이션.
   3. `qa`: 테스트·사양 감사·버그 수정·스토어 제출 준비.
   4. `infra`: 툴링·CI·harness·빌드/배포 설정.
   5. `docs`: 문서 전용 작업.

   **Step name**: kebab-case slug로 해당 step의 핵심 모듈/작업을 한두 단어로 표현한다 (예: `project-setup`, `api-layer`, `auth-flow`). step 파일명에 그대로 들어간다(`step{N}_{name}.md` — 원칙 8·D-3).

8. **버전 단위 분할·layer 순서 (CRITICAL)**
   - 한 release 버전의 모든 작업은 **하나의 `v{X}_{Y}_{Z}` 디렉토리**에 step 으로 모은다(레이어별로 디렉토리를 쪼개지 않는다).
   - step 은 **`backend` → `frontend` → `qa` → `infra` → `docs`** layer 순서로 나열한다. 같은 layer 안에서는 의존 순서대로.
   - 이미 완료된 버전 디렉토리에 **같은 버전 출시로 추가 작업이 생기면** 새 디렉토리를 만들지 말고 **다음 step 번호로 append** 한다. 추가한 step 의 status(및 `phases/index.json` 의 해당 항목 status)를 `pending` 으로 두고 execute.py 를 재실행하면 미완 step 만 이어서 실행된다.

### D. 파일 생성

사용자가 승인하면 아래 파일들을 생성한다.

#### D-1. `phases/index.json` (전체 현황)

여러 task를 관리하는 top-level 인덱스. 이미 존재하면 `phases` 배열에 새 항목을 추가한다.

```json
{
  "phases": [
    {
      "dir": "v1_1_0",
      "status": "pending"
    }
  ]
}
```

- `dir`: phase 디렉토리명 — **`v{MAJOR}_{MINOR}_{PATCH}` 규칙(위 C-7)**. 같은 버전 작업이 이미 있으면 새 항목을 추가하지 말고 기존 디렉토리에 step 을 append 한다(C-7 원칙 8).
- `status`: `"pending"` | `"completed"` | `"error"` | `"blocked"`. execute.py가 실행 중 자동으로 업데이트한다.
- 타임스탬프(`completed_at`, `failed_at`, `blocked_at`)는 execute.py가 상태 변경 시 자동 기록한다. 생성 시 넣지 않는다.

#### D-2. `phases/{v{MAJOR}_{MINOR}_{PATCH}}/index.json` (task 상세)

```json
{
  "project": "unboxing",
  "version": "1.1.0",
  "steps": [
    { "step": 0, "name": "schema-migration", "status": "pending", "layer": "backend" },
    { "step": 1, "name": "callback-endpoint", "status": "pending", "layer": "backend" },
    { "step": 2, "name": "detail-screen", "status": "pending", "layer": "frontend" },
    { "step": 3, "name": "smoke-audit", "status": "pending", "layer": "qa" }
  ]
}
```

필드 규칙:

- `project`: 프로젝트명 (CLAUDE.md 참조).
- `version`: **출시 버전**(표시용) — `app/app.json` 의 `version` 과 일치(예 `"1.1.0"`). 디렉토리명(`v1_1_0`)과 같은 버전을 가리킨다. 브랜치는 execute.py 가 디렉토리명 전체로 만든다(`feat-v1_1_0`).
- `steps[].step`: 0부터 시작하는 순번. **append 시 기존 마지막 번호 + 1** 로 이어 붙인다.
- `steps[].name`: kebab-case slug. step 파일명에 들어간다(`step{N}_{name}.md`).
- `steps[].layer`: **커밋 scope**(`backend`/`frontend`/`qa`/`infra`/`docs`). step 은 이 순서로 나열(C-7 원칙 8). execute.py 가 `feat({layer}): …` 로 커밋한다.
- `steps[].status`: 초기값은 모두 `"pending"`.

상태 전이와 자동 기록 필드:

| 전이 | 기록되는 필드 | 기록 주체 |
|------|-------------|----------|
| → `completed` | `completed_at`, `summary` | Claude 세션 (summary), execute.py (timestamp) |
| → `error` | `failed_at`, `error_message` | Claude 세션 (message), execute.py (timestamp) |
| → `blocked` | `blocked_at`, `blocked_reason` | Claude 세션 (reason), execute.py (timestamp) |

`summary`는 step 완료 시 산출물을 한 줄로 요약한 것으로, execute.py가 다음 step 프롬프트에 컨텍스트로 누적 전달한다. 따라서 다음 step에 유용한 정보(생성된 파일, 핵심 결정 등)를 담아야 한다.

`created_at`은 execute.py가 최초 실행 시 task 레벨에 한 번만 기록한다. step 레벨의 `started_at`도 execute.py가 각 step 시작 시 자동 기록한다. 생성 시 넣지 않는다.

#### D-3. `phases/{버전-디렉토리}/step{N}_{name}.md` (각 step마다 1개)

> 파일명은 `step{번호}_{steps[].name}.md` 형식(예: `step0_schema-migration.md`). execute.py 가 step 의 번호·`name` 으로 이 파일을 찾으므로 index.json 의 `name` 과 파일명이 **정확히 일치**해야 한다.

```markdown
# Step {N}: {이름}

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`
- {이전 step에서 생성/수정된 파일 경로}

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

{구체적인 구현 지시. 파일 경로, 클래스/함수 시그니처, 로직 설명을 포함.
코드 스니펫은 인터페이스/시그니처 수준만 제시하고, 구현체는 에이전트에게 맡겨라.
단, 설계 의도에서 벗어나면 안 되는 핵심 규칙은 명확히 박아넣어라.}

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/{task-name}/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- {이 step에서 하지 말아야 할 것. "X를 하지 마라. 이유: Y" 형식}
- 기존 테스트를 깨뜨리지 마라
```

### E. 실행

```bash
python3 scripts/execute.py {task-name}        # 순차 실행
python3 scripts/execute.py {task-name} --push  # 실행 후 push
```

execute.py가 자동으로 처리하는 것:

- `feat-{task-name}` 브랜치 생성/checkout
- 가드레일 주입 — CLAUDE.md + docs/*.md 내용을 매 step 프롬프트에 포함
- 컨텍스트 누적 — 완료된 step의 summary를 다음 step 프롬프트에 전달
- 자가 교정 — 실패 시 최대 3회 재시도하며, 이전 에러 메시지를 프롬프트에 피드백
- 2단계 커밋 — 코드 변경(`feat`)과 메타데이터(`chore`)를 분리 커밋
- 타임스탬프 — started_at, completed_at, failed_at, blocked_at 자동 기록

에러 복구:

- **error 발생 시**: `phases/{task-name}/index.json`에서 해당 step의 `status`를 `"pending"`으로 바꾸고 `error_message`를 삭제한 뒤 재실행한다.
- **blocked 발생 시**: `blocked_reason`에 적힌 사유를 해결한 뒤, `status`를 `"pending"`으로 바꾸고 `blocked_reason`을 삭제한 뒤 재실행한다.
