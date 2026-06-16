# Step 4: demo-path (#13 P2 — 심사 데모 번호·리뷰 노트)

심사자가 실배송 없이 검증할 데모 경로를 활성화한다(미설정으로 비활성이던 것). **이슈 #13(QA-010) 해소**. (step0의 등록 데드락 해소가 선결 — 데모 등록도 일반 경로를 탄다.)

## 읽어야 할 파일

- GitHub 이슈 **#13** 및 `/docs/QA_FINDINGS.md`의 **QA-010** 행
- `/docs/ADR.md` — ADR-019(데모 경로·리뷰 노트)
- `/docs/ARCHITECTURE.md` — "데모/리뷰 경로", "환경변수 & 시크릿"(`DEMO_TRACKING_NUMBER` var)
- `/Users/jinni/Developments/unboxing/worker/wrangler.toml` — `[vars]`
- `/Users/jinni/Developments/unboxing/worker/src/tracker.ts` — `demoResult`·`track`의 데모 분기, `worker/src/cron.ts` 데모 가드
- `/Users/jinni/Developments/unboxing/docs/QA_TESTPLAN.md` — 제출 체크리스트
- step0(register-fix) — 데모 등록 전제(device ensure)
- step1(carrier-support) — 데모 carrier 가 지원목록 대조(409)를 통과해야 함

## 작업

1. **`wrangler.toml [vars]`**: `DEMO_TRACKING_NUMBER = "<형식 유효한 데모 번호>"`(예: `"00000000000000"` 등 `^\d{9,14}$` 충족, 실제 운송장과 충돌 없는 값). 이 값이 `env.DEMO_TRACKING_NUMBER`로 주입돼 `tracker.ts`가 외부 호출 없이 캔드 타임라인 반환.
2. **리뷰 노트** `docs/REVIEW_NOTES.md`(또는 `QA_TESTPLAN.md`에 섹션): 심사 제출용 — 데모 운송장 번호, 등록 절차, 예상 동작(등록→이동중→배송출발 캔드 진행), 주의(실폴링 우회).
3. **데모 carrier**: 데모 번호 등록 시 사용할 carrier(예 `kr.cjlogistics`)가 step1의 지원목록 대조(409)를 통과하는지 확인.

## 핵심 규칙 (벗어나면 안 됨)

- `DEMO_TRACKING_NUMBER`는 **var(비밀 아님)** — `wrangler.toml [vars]`. 시크릿으로 다루지 마라. 이유: ARCHITECTURE 환경변수 표.
- 데모 분기는 외부 호출을 **완전 우회**하고 캔드 응답만(실폴링 금지). 이유: ADR-019.
- 데모 번호 형식이 운송장 검증(`^\d{9,14}$`)·carrier 지원목록을 통과해야 등록까지 도달. 이유: step0/step1 경로 정합.

## 엣지케이스 & 에러 처리 (반드시 다룰 것)

- **실 운송장과 충돌 금지**: `track()` 의 데모 분기는 번호만 일치하면 **누구에게나** 캔드 결과를 준다. 실제로 존재할 법한 번호를 쓰면 그 운송장을 등록한 실사용자가 가짜 데이터를 받는다 → **예약된/비현실적 값**(예 `00000000000000`)을 골라 충돌을 피하라.
- **데모 송장 잔존(M3) — 결정**: 데모 캔드가 `배송출발`에서 멈춰 60분마다 재폴링·30일 후 비활성. **기본은 "bounded 로 수용 + 문서화"**: dedupe 로 데모 번호는 항상 1행, 30일 후 `active=0`(분실 알림은 데모 가드로 제외)이라 누적·비용이 한정적이다 — 이 거동을 `demoResult` 주석 + 리뷰 노트에 명시한다. (선택 개선: 캔드를 `now` 기반으로 `배송완료`까지 진행시켜 자동 삭제 — 깔끔하나 필수 아님.)
- **데모도 step0 등록 경로**: 데모 등록 시 device 가 (토큰 유무와 무관하게) 등록돼 있어야 `POST /shipments` 통과 — step0 의 ensure 경로에 의존.
- **테스트 env 주입**: `wrangler.toml [vars]` 의 `DEMO_TRACKING_NUMBER` 는 `cloudflare:test` env 에도 주입된다 → 기존 테스트가 우연히 같은 번호를 쓰면 데모 분기를 타 깨질 수 있다. 기존 테스트 운송장(`123456789012`·`111111111111` 등)과 **겹치지 않는 값**을 고르고, 회귀 없는지 확인.

## 검증 (수정 증명)

- `tracker.test.ts`의 데모 케이스가 그대로 통과(외부 호출 0, 캔드 반환).
- E2E(가능 범위): `DEMO_TRACKING_NUMBER` 설정값으로 등록 → 폴링 → 캔드 단계 진행·알림 경로가 동작(데모 가드로 분실알림 제외 유지).
- `wrangler.toml`·`docs/REVIEW_NOTES.md` 존재.

## Acceptance Criteria

```bash
npm run verify
```

## 검증 절차

1. AC 실행. 2. 체크리스트: `DEMO_TRACKING_NUMBER` var 설정? 데모 분기 외부호출 우회? 리뷰 노트 작성? 데모 등록이 step0/step1 경로 통과? 3. `phases/qa-fixes/index.json` step 4 업데이트(summary "fixes #13"). 이슈 자동 닫기는 qa-fixes PR 본문에서.

## 금지사항

- 데모 번호를 시크릿(`wrangler secret`)으로 두지 마라. 이유: 비밀 아님(ARCHITECTURE).
- 데모가 실제 tracker.delivery를 호출하게 하지 마라. 이유: ADR-019(우회).
- 기존 테스트를 깨뜨리지 마라.
