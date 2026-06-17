# Step 2: lifecycle-notice (#10 P2 — 7일 '번호 확인' 안내)

미등록7일·예외7일 송장이 **조용히** 비활성되던 것을, 비활성 시 "번호 확인" 안내 1회를 보내도록 고친다. **이슈 #10(QA-007) 해소**.

## 읽어야 할 파일

- GitHub 이슈 **#10** 및 `/docs/QA_FINDINGS.md`의 **QA-007** 행
- `/docs/PRD.md` — 핵심 플로우 6("7일 미수신 시 '번호 확인' 안내 후 비활성")
- `/docs/ARCHITECTURE.md` — "데이터 수명주기 & 만료" 표(미등록7일/예외7일 → 비활성 + 안내)
- `/Users/jinni/Developments/unboxing/worker/src/lib/lifecycle.ts` — `lifecycleAction`(현재 7일 `notify:false`)
- `/Users/jinni/Developments/unboxing/worker/src/cron.ts` — `pollOne`의 `lifecycleAction` 처리·`notifyLost`
- `/Users/jinni/Developments/unboxing/worker/src/push.ts` — `buildMessage`(알림 문구)
- `/Users/jinni/Developments/unboxing/worker/test/e2e/lifecycle.test.ts`·`src/lib/lifecycle.test.ts`
- **step0(register-fix) 산출**: `cron.ts`의 NULL-토큰 제외(`subscriberTokens`) — 안내 발송도 이를 재사용한다. (안내는 `deliver`/`fanOut` 경유로 — step3 조용시간이 덮을 수 있게.)

## 작업

1. **`lifecycle.ts`**: `미등록7일`·`예외7일` 의 `notify`를 `true`로(현재 `false`). reason은 유지(`미등록7일`/`예외7일`).
2. **`cron.ts`**: `lifecycleAction`이 `deactivate` + `notify:true` 일 때, reason에 맞는 안내 푸시를 발송. 현재 `notifyLost`(분실의심30일)와 별개로, 7일 reason엔 **"번호를 확인해 주세요"** 류 안내 문구를 보낸다. 데모 번호 제외(기존 가드 유지).
3. **`push.ts`**: 안내 문구 경로 추가(운영성 알림 — `buildMessage`의 단계 알림과 구분하거나 `notifyLost`처럼 직접 구성). 친근한 한글, 코드/기술용어 비노출, `data.shipment_id` 포함.

## 핵심 규칙 (벗어나면 안 됨)

- 안내는 비활성 시 **1회만**(중복 발송 금지). 이유: 멱등·과알림 방지. (비활성 후엔 due 대상이 아니라 재발송 안 됨 — 보장 확인.)
- 데모 번호는 안내 제외(기존 가드). 이유: 심사 데모 오발송 방지.
- 분실의심30일(`notifyLost`) 동작·문구를 깨지 마라. 이유: 별개 알림.
- 기존 멱등 단계 알림·CAS 동작 불변.

## 엣지케이스 & 에러 처리 (반드시 다룰 것)

- **reason별 문구 구분**: `미등록7일` → "운송장 번호를 확인해 주세요"(오타/잘못된 번호), `예외7일` → "배송 문제가 오래 지속돼요 — 확인이 필요해요". 한 문구로 뭉뚱그리지 마라(원인이 다름).
- **예외7일 중복 알림 검토**: `예외` 진입 시 사용자는 이미 `예외` 푸시를 1회 받았다. 7일 후 또 안내하면 같은 예외로 2회 알림 → 과알림 우려. PRD 플로우6은 *미등록* 7일 안내가 주목적이므로, **예외7일은 안내 생략(조용히 비활성)도 합리적 — 구현 전 정책 확정**(미등록7일만 안내 vs 둘 다). ARCH 만료표("예외7일 + 안내")와의 불일치도 함께 기록.
- **NULL 토큰 제외**: step0 으로 push_token 이 nullable — 안내 발송도 토큰 수집 시 `push_token IS NOT NULL`(step0 의 `subscriberTokens` 수정을 재사용). 토큰 없는 구독자에겐 발송 시도 금지.
- **발송 경로 공유**: 안내는 `deliver`/`fanOut` 같은 중앙 발송 경로를 타게 하라 — 그래야 step3(조용시간)이 나중에 이 안내에도 야간 보류를 적용한다(별도 경로로 직접 send 하면 조용시간을 우회한다).
- **best-effort 손실**: 비활성(`active=0`) 후엔 due 대상이 아니라 재폴링 안 됨 → 안내 push 가 실패하면 **재발송 안 되고 손실**된다(중복은 안전, 손실은 감수). 앱은 `active=0`+`미등록`을 보고 인앱으로도 안내할 수 있음(보조).
- **테스트 시계**: 이 step E2E 의 `now` 는 **주간(KST)**으로 둬라 — step3 가 deliver 에 야간 보류를 붙인 뒤에도 안내 즉시 발송 단언이 깨지지 않게(야간 now 면 보류돼 sendCalls=0 이 됨).

## 검증 (수정 증명)

- **`worker/src/lib/lifecycle.test.ts`(단위)의 기존 단언 갱신**: 현재 `미등록7일`·`예외7일` 이 `notify:false` 를 단언한다 → 정책에 맞게 갱신(`미등록7일` `notify:true`; `예외7일` 은 N3 결정대로 — 안내하면 `true`, 생략이면 `false` 유지). 이 단위 단언을 안 고치면 verify red.
- `worker/test/e2e/lifecycle.test.ts`의 QA-007 `it.todo`를 통과로 전환 + 현재 "안내 없음(`sendCalls=0`)"을 단언하던 재현 부분을 **안내 1건 발송**으로 뒤집기: 미등록7일 송장 폴링 → `active=0` + 안내 푸시 1건. **테스트 `now`는 주간(KST)** 으로(step3 조용시간과 충돌 방지). 재폴링 시 재발송 없음.

## Acceptance Criteria

```bash
npm run verify
```

## 검증 절차

1. AC 실행. 2. 체크리스트: 7일 비활성 시 안내 1회? 중복 없음? 데모 제외? 30일 분실 알림 불변? 3. `phases/qa-fixes/index.json` step 2 업데이트(summary "fixes #10"). 이슈 자동 닫기는 qa-fixes PR 본문에서.

## 금지사항

- 안내를 매 폴링 반복 발송하지 마라. 이유: 과알림(비활성 1회만).
- 30일 분실 알림 로직을 변경하지 마라(범위 밖). 이유: 별개 이슈 아님.
- 기존 테스트를 깨뜨리지 마라.
