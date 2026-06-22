# 프로젝트: unboxing

택배 조회·배송 추적 앱. 운송장 등록 시 **앱이 꺼져 있어도** 백그라운드 폴링 → 상태 변화 시 푸시.
Phase 1 (MVP): 국내·익명(로그인 없음)·tracker.delivery Free / Phase 2: 해외·계정 동기화.
→ 문서: **메인** `docs/` = PRD · ARCHITECTURE · ADR · UI_GUIDE. **보조** = QA(발견·테스트·신고) · ENGINEERING(런타임 함정·마이그레이션, 실수 재발방지) · ROADMAP(진행현황·예정작업) · PRIVACY_POLICY · IOS_SUBMISSION(App Store 제출·정책검토). 진행/다음 작업은 `docs/ROADMAP.md`.

## 기술 스택
- Expo (React Native) — iOS+Android 단일 코드베이스
- Cloudflare Workers (fetch HTTP API + Cron scheduled) + D1 (SQLite)
- Expo Push (알림) · tracker.delivery Tracking API (Free·GraphQL)
- TypeScript strict mode

## 아키텍처 규칙
- CRITICAL: 운영 서버 비용 0원 — 상시 서버 금지. 무료 티어 서버리스(클라우드 함수+스케줄러)만.
- CRITICAL: 마찰 최소 — 회원가입·API 키 입력을 기본(default) 경로에 넣지 말 것.
- CRITICAL: 개인정보 비영속 — 수령인 이름·연락처·주소를 D1에 저장 금지(화면 표시 후 폐기).
- 백그라운드 폴링은 Workers Cron 단일 배치 — 사용자별 타이머 ❌. due된 송장만 폴링.
- 상태는 표준 단계로 정규화 후 단계 전환에만 알림(멱등). 상세 → `docs/ARCHITECTURE.md`.

## 개발 프로세스
- CRITICAL: **작업 순서 고정(반드시 준수·임의로 건너뛰기 금지)** — ① `docs/`(PRD·ARCHITECTURE·ADR·UI_GUIDE) 설계 작성 → ② **검토 ↔ 수정·보강을 여러 번 반복**해 다듬고(고정 단계 나열 아님·횟수 제한 없음) → ③ 사용자가 설계를 **확정**하면 → ④ **Harness 명령으로 구현 시작**(`/harness`, 실행 `python3 scripts/execute.py {phase}`). **확정 전엔 곧장 코드를 고치지 않는다**(사소해 보여도·핫픽스·UX 한 줄도 동일). Harness 는 설계 도구가 아니라 **구현 단계**다. 상세 `.claude/commands/harness.md`.
- CRITICAL: 핵심 순수 로직은 test-first(TDD). 변경은 `npm run verify`가 green일 때만 완료로 본다.
- CRITICAL: mock 기반 `verify` green은 **순수 로직만** 보증한다 — 외부 경계(tracker.delivery·Expo Push·D1 런타임·플랫폼 글로벌 `fetch`)는 green이어도 깨질 수 있다. 머지·배포 전 **실호출 스모크 1회** 필수(실 운송장 등록→실제 상태 확인 등). 체크리스트·과거 사례 → `docs/ENGINEERING.md`.
- CRITICAL: Workers에서 전역 `fetch`를 deps/옵션 객체로 주입할 땐 반드시 `fetch.bind(globalThis)` — 맨 `fetch` 주입 시 호출 때 "Illegal invocation"으로 throw(테스트는 mock fetch라 못 잡음). 상세 → `docs/ENGINEERING.md` P-1.
- 외부 의존(tracker.delivery·Expo Push)은 mock, 시간 의존 로직은 `now` 주입(고정 시계).
- 커밋 메시지는 conventional commits (feat:/fix:/docs:/refactor:/chore:).
- `.claude/settings.json` 훅: 위험 명령(`rm -rf`·force push·`reset --hard`·`DROP TABLE`) 자동 차단 + `worker/`·`app/` `.ts(x)` 편집 후 typecheck 자동 실행.
- 이 파일은 **100줄 이하 유지** — 넘으면 `docs/`로 분리하고 여기엔 요약+포인터만.

## 명령어
```bash
npm run verify                       # typecheck + test (app + worker + harness) — 매 작업 후 검증
npm --prefix app start               # Expo 개발 서버 (run ios | android | web)
npm --prefix worker run dev          # Worker 로컬 실행
npm --prefix worker run deploy       # Worker 배포
python3 -m pip install -r scripts/requirements.txt  # Harness 테스트 의존성 (최초 1회)
python3 scripts/execute.py {phase}   # Harness 단계 실행 (--push 로 완료 후 push)

# D1 최초 설정 (worker/ 에서 — wrangler.toml 위치)
npx wrangler d1 execute unboxing --file=schema.sql --remote
npx wrangler secret put DELIVERY_TRACKER_CLIENT_ID    # + _CLIENT_SECRET
```

## 고정비 (서버 비용 아님)
Apple Developer 연 $99(iOS 필수), Google Play 1회 $25.
