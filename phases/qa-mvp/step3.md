# Step 3: lifecycle-privacy (수명주기·삭제·개인정보·보안 QA)

데이터 수명주기·삭제 경로·개인정보 비영속·보안 규칙을 E2E + 정적 감사로 검증하고 갭을 기록한다. (발견·기록만 — 수정 금지.)

> **QA 철칙: 버그를 고치지 마라.** 갭은 `it.todo`/`.skip` + `docs/QA_FINDINGS.md`. verify green 유지.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — "데이터 수명주기 & 만료", "보안 & 공개 API 남용 방어", "관측성 & 로깅"
- `/docs/ADR.md` — ADR-005(개인정보 비영속)·011(타임라인 미저장)·017(데이터 삭제)
- `/Users/jinni/Developments/unboxing/CLAUDE.md` — CRITICAL(개인정보 비영속·SQLi·로그 금지)
- `/Users/jinni/Developments/unboxing/worker/src/index.ts`·`cron.ts`·`lib/lifecycle.ts`·`schema.sql`
- `/Users/jinni/Developments/unboxing/phases/qa-mvp/step0.md`~`step2.md` 산출 + `docs/QA_FINDINGS.md`

## 작업

`worker/test/e2e/lifecycle.test.ts` + 정적 감사:

1. **만료 E2E**: 미등록7일·예외7일 → `active=0`, 30일 미완료 → 비활성+분실 알림(데모 번호 제외).
2. **삭제 경로 E2E**: `DELETE /shipments/:id` 마지막 구독 → orphan 삭제. `DELETE /me`(ADR-017) → device+구독(CASCADE)+orphan+푸시토큰 폐기. 삭제 후 재조회 빈 결과.
3. **개인정보 비영속 감사(ADR-005/011)**: track 결과의 **수령인/description/location**이 D1 어느 테이블에도 저장되지 않는지 — 스키마(`schema.sql`) 컬럼 + 코드의 INSERT/UPDATE를 grep으로 확인. 타임라인 미저장(상세는 실시간 조회).
4. **SQLi 감사**: 모든 D1 쿼리가 `.bind()` prepared인지(문자열 결합 SQL 없는지) grep.
5. **로그 금지 감사(ADR-007)**: `console.*`에 `device_id`·`push_token`·수령인이 안 나오는지 grep(worker·app 전체).

갭(예: 저장 위반, 결합 SQL, 민감값 로깅, 삭제 누락)을 `QA_FINDINGS.md`에 기록.

## 핵심 규칙 (벗어나면 안 됨)

- 개인정보 비영속·SQLi·로그 금지는 CLAUDE.md CRITICAL — 위반 발견 시 **P0~P1**로 기록.
- 갭은 todo/skip + FINDINGS. 코드 수정 금지.

## Acceptance Criteria

```bash
npm run verify
```

## 검증 절차

1. AC 실행. 2. 체크리스트: 삭제 경로(특히 `DELETE /me`)가 E2E로 완전 폐기를 보장하는가? 비영속·SQLi·로그 감사 결과가 FINDINGS에 기록됐는가? 3. `phases/qa-mvp/index.json` step 3 업데이트.

## 금지사항

- 발견된 위반을 고치지 마라. 이유: QA 전용(수정은 별도·우선순위 높게 이슈화).
- 갭을 실패 단언으로 verify를 깨지 마라. 기존 테스트 깨뜨리지 마라.
