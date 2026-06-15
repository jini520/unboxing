# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **상태: Phase 1 스캐폴딩 완료.** `app/`(Expo blank-typescript) + `worker/`(Cloudflare Worker). 상세 설계는 `docs/design.md`.
> 이 파일은 **100줄 이하로 유지** — 늘어나면 상세를 `docs/`로 분리하고 여기엔 요약+포인터만 남긴다.

## 무엇을 만드는가

택배 조회·배송 추적 앱. 운송장 등록 시 **앱이 꺼져 있어도** 백그라운드 폴링 → 상태 변화 시 푸시.

- **Phase 1 (MVP)**: 국내, 익명(로그인 없음), tracker.delivery Tracking API(Free).
- **Phase 2**: 해외(17TRACK 등), 계정/기기 간 동기화.

## 절대 제약 (깨지 말 것)

1. **운영 서버 비용 0원** — 상시 서버 금지. 서버 작업은 무료 티어 서버리스(클라우드 함수+스케줄러)만.
2. **일반 대중 타깃 = 마찰 최소화** — 회원가입·API 키 입력을 기본 경로에 넣지 말 것.

## 아키텍처

```
[Expo 앱] ─등록/조회→ [Cloudflare D1] ←읽기─ [Cloudflare Workers Cron]
   ▲                   (송장·푸시토큰)         │ 주기 배치 폴링
   └── Expo Push ← 상태변화 푸시 ──────── [tracker.delivery API]
```

- **클라이언트**: Expo (React Native), iOS+Android 단일 코드베이스
- **백그라운드**: Cloudflare Workers **Cron** — 단일 배치로 전체 활성 송장 폴링 (사용자별 타이머 ❌)
- **저장**: Cloudflare D1 (SQLite, 무료) — Workers와 동일 생태계
- **알림**: Expo Push (무료·무제한)
- **데이터**: tracker.delivery Tracking API(Free·GraphQL). 미지원 택배사는 딥링크 폴백

→ 설계 근거·등록 플로우·상태 정규화·폴링 주기·데이터 모델: **`docs/design.md`**

## 비용 모델 (핵심)

병목은 컴퓨트가 아니라 **택배 API 무료 쿼터**. Expo Push·Cloudflare는 여유, API가 진짜 천장.
무료 한계 ≈ 수백 명(스마트 폴링 기준). 절감 레버: 완료 시 폴링 중단·상태별 적응 간격·동일 송장 dedupe. 상세 → `docs/design.md`.

## Repository layout

- `app/` — Expo (React Native) 클라이언트
- `worker/` — Cloudflare Worker: `src/index.ts`(fetch HTTP API + scheduled 폴링), `wrangler.toml`(15분 cron + D1), `schema.sql`

## Commands

```bash
# Expo 앱 (app/)
npm --prefix app start              # 개발 서버 (run ios | android | web)

# Cloudflare Worker (worker/)
npm --prefix worker run dev         # 로컬 실행
npm --prefix worker run typecheck   # tsc --noEmit
npm --prefix worker run deploy      # 배포

# D1 최초 설정 (worker/ 에서 실행 — wrangler.toml 위치)
npx wrangler d1 create unboxing                              # → database_id를 wrangler.toml에 기입
npx wrangler d1 execute unboxing --file=schema.sql --remote # 스키마 적용
npx wrangler secret put DELIVERY_TRACKER_CLIENT_ID    # + _CLIENT_SECRET (tracker.delivery)
```

## 테스트

- **매 작업 후 검증**: 루트에서 `npm run verify` (app+worker typecheck + test). 변경은 green일 때만 완료로 본다.
- 도구: app = jest-expo, worker = Vitest + `@cloudflare/vitest-pool-workers`(workerd+D1)
- 범위: 핵심 순수 로직 + Worker HTTP/D1 통합. 앱 화면 컴포넌트·E2E는 Phase 2.
- 방식: 핵심 로직 test-first, 외부 API/푸시는 mock, 시간 의존은 `now` 주입(고정 시계).
- CI: `.github/workflows/ci.yml`가 push/PR마다 verify. 상세 → `docs/testing.md`.

## 고정비 (서버 비용 아님)

Apple Developer 연 $99(iOS 필수), Google Play 1회 $25.
