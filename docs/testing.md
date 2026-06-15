# 테스트 정책

> 요약은 CLAUDE.md `## 테스트`. 이 파일은 상세.

## 도구
- `app/`: **jest-expo** + (컴포넌트 단계에서) React Native Testing Library. 테스트는 `@jest/globals`에서 import(전역 타입 의존 X).
- `worker/`: **Vitest + `@cloudflare/vitest-pool-workers`** — workerd 런타임에서 실행, wrangler.toml 바인딩(D1)을 테스트에 제공. config는 `vitest.config.mts`(ESM 필수 — pool-workers가 ESM-only). **v4 주의**: `defineWorkersConfig`(`/config` 서브패스)는 제거됨 → `vitest/config`의 `defineConfig` + `cloudflareTest()` 플러그인 사용.

## 우선순위
- **필수**(반드시): 순수 핵심 로직 — 상태 정규화 매핑(미매핑→`기타`), 알림 트리거·멱등(`이동중` 무알림, 같은 상태 재독 시 무발송), 폴링 due 계산, 만료 정책, 운송장 번호 검증.
- **권장**: Worker HTTP API + D1 통합(등록 dedupe·목록·삭제).
- **보류(Phase 2)**: 앱 화면 컴포넌트, E2E(Maestro).

## 방식
- 핵심 로직은 **test-first**.
- 외부 의존(tracker.delivery API, Expo Push)은 **mock** — 테스트에서 실제 호출 금지.
- 시간 의존 로직은 `now`를 인자로 주입해 **고정 시계**로 결정론 보장(예: `isDue(stage, lastPolledAt, now)`).
- 강제 커버리지 숫자는 없음. 단 "필수" 로직은 비어 있으면 안 됨.

## 위치
- 유닛: 소스 옆 `*.test.ts` — 예: `worker/src/lib/polling.test.ts`, `app/src/lib/tracking.test.ts`.
- Worker 통합: `worker/test/*.test.ts` — `cloudflare:test`의 `SELF`(fetch)·`env`(바인딩) 사용.

## CI
- `.github/workflows/ci.yml` — push/PR마다 app·worker 설치 후 `npm run verify`.
- 무료 GitHub Actions 티어 사용 ($0 운영 제약과 호환).

## 명령
- 전체: `npm run verify` (typecheck + test, app+worker)
- 개별: `npm --prefix app test` · `npm --prefix worker test`
