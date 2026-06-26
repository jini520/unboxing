# Step 6: smoke-config (외부 경계 — 시크릿·운영 마이그레이션·실호출 스모크)

webhook 을 운영에 켜고 **실호출 스모크 1회**(mock green ≠ 런타임)를 수행한다. 이 step 은 배포·시크릿·실 운송장이 필요해 **사용자 개입(인증·자격증명)이 필요하면 `blocked` 로 표시하고 중단**한다.

## 읽어야 할 파일

- `/docs/QA.md` — **F-4 외부 경계 실호출 스모크**(체크리스트)·F-5 AC
- `/docs/ENGINEERING.md` — "외부 경계 실호출 체크리스트", **§6 운영 D1 마이그레이션 델타**, 함정 **T1·T4·T5·T6·T8**
- `/docs/ADR.md` — ADR-028·029(스모크로 확정할 미지수: 반환값·최대 TTL·재등록 멱등·미등록 등록 가부·서명 유무·deregister)
- `/docs/ARCHITECTURE.md` — "환경변수 & 시크릿"(`WEBHOOK_CALLBACK_SECRET`)
- step0~5 산출물(스키마·로직·등록·콜백·sweep)

## 작업

### 1. 운영 D1 마이그레이션 델타 (통째 재실행 ❌ — T8)

운영 D1 에 **컬럼 델타만** 1회 적용:
```bash
cd worker
npx wrangler d1 execute unboxing --remote --command "ALTER TABLE shipments ADD COLUMN webhook_expires_at INTEGER"
# 진단: 이미 있으면 duplicate column → 적용된 것. PRAGMA 로 확인:
npx wrangler d1 execute unboxing --remote --command "PRAGMA table_info(shipments)"
```
- `webhook_expires_at` 이 보이면 적용 완료. **`schema.sql` 통째 재실행 금지**(ALTER 중복 throw·P-3).

### 2. 시크릿 발급

```bash
# 추측 불가 고엔트로피 시크릿 생성 후:
npx wrangler secret put WEBHOOK_CALLBACK_SECRET    # 값 입력(로그·커밋 금지)
# tracker.delivery 가 서명(HMAC) 제공 시에만:
# npx wrangler secret put WEBHOOK_SIGNING_SECRET
```

### 3. 배포

```bash
npm --prefix worker run deploy
```

### 4. F-4 실호출 스모크 (머지·배포 전 1회)

`docs/QA.md` F-4 순서대로 실 운송장으로 확인하고 **결과를 문서에 반영**한다:
- **registerTrackWebhook 실호출** — 반환값 스키마·`expirationTime` 48h 수락·**최대 TTL**·**재등록이 중복 생성인지 갱신인지**(W9·T4).
- **미등록(이벤트 0) 번호 등록 가부**(W7·T5) — 안 받아주면 "폴링 승급" 경로가 정답임을 확인(설계대로).
- **실 콜백 수신** — 실 송장 상태 변화 시 `/webhooks/track/<secret>` POST 도착·페이로드 형태(`{carrierId,trackingNumber}`)·**서명 헤더 유무**(있으면 ADR-029 ① 서명검증 활성화).
- **위조 콜백 차단** — 잘못된 시크릿(`401`)·임의 번호(`202`·무처리) 무시 확인.
- **deregister API 존재 여부** — 슬롯 즉시 회수 가능한지.
- **fetch 바인딩(T1·P-1)** — `registerTrackWebhook` 실호출이 `Illegal invocation` 없이 되는지(맨 fetch 주입 시 여기서만 드러남).

### 5. 문서 반영

- 스모크로 확정된 사실(반환 스키마·최대 TTL·재등록 멱등·미등록 등록 가부·서명·deregister)을 `docs/ENGINEERING.md`(외부 경계)·해당 ADR(028/029)·`docs/QA.md` F-4 에 갱신. 설계 가정과 다르면 ADR 을 정정한다.
- `docs/ROADMAP.md` 진행 현황에 webhook-first 전환 + 스모크 결과를 1줄 추가.

## Acceptance Criteria

```bash
npm run verify   # 머지 전 mock green 재확인
```
- 운영 D1 `PRAGMA table_info(shipments)` 에 `webhook_expires_at` 존재.
- F-4 스모크 통과(특히 W9 재등록 멱등·W7 미등록 등록 가부·서명 유무·위조 차단)·결과 문서화.

## 검증 절차

1. `npm run verify` green 재확인(머지 게이트).
2. 위 1~4 를 수행. **수행 불가(인증·자격증명·실 운송장 부재)면** `phases/15-backend-v0-webhook-first/index.json` step6 을 `"status": "blocked"`, `"blocked_reason"` 에 무엇이 필요한지(예: `wrangler` 로그인·`WEBHOOK_CALLBACK_SECRET` 값·실 운송장) 적고 **즉시 중단**.
3. 스모크까지 끝나면 `"status": "completed"`, `"summary"` 에 확정된 외부 사실 요약.

## 금지사항

- 스모크 없이 **머지·운영 활성화를 완료로 표시하지 마라**. 이유: mock green 은 외부 경계(등록 API·콜백 수신·서명)를 보증하지 않는다(CLAUDE.md CRITICAL·verify-external-boundaries).
- 운영 D1 에 `schema.sql` 을 통째로 재실행하지 마라(T8·P-3). **ALTER 델타만**.
- 시크릿 값·콜백 URL 을 커밋·로그·문서에 남기지 마라(T6).
- 자격증명/인증이 없는데 추측해서 진행하지 마라. 이유: 외부 작업은 사용자 개입 — `blocked` 가 정답.
- 기존 테스트를 깨뜨리지 마라.
