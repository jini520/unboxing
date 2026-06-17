# ROADMAP & 진행 현황

> **비메인 참고 문서.** 메모리가 없어도 **무엇을 했는지(진행 현황)·무엇을 해야 하는지(예정 작업)**를 한 파일에서 파악하기 위한 문서.
> 권위 출처: 완료 단계는 `phases/index.json`·git 히스토리, 결정은 `ADR`, 발견 갭은 `QA`. 본 문서는 그 요약 + 예정 작업 계획.

## 진행 현황 (무엇을 했는가)

**Phase 1 (MVP) — 국내·익명·tracker.delivery Free.** 핵심 경로 구현·QA·런타임 버그 수정까지 완료, 로컬 iOS 시뮬레이터 + 로컬 worker 로 동작 확인됨.

완료 단계(`phases/` — 상세는 각 phase index.json·step):
- `01-backend-v0-mvp-worker` — Cloudflare Worker HTTP API + cron 폴링 + 멱등 푸시 + D1 (PR #1)
- `02-ui-v0-mvp-app` — Expo 앱: 목록/상세/등록/온보딩/설정 (PR #2)
- `03-qa-v0-mvp` — MVP QA: E2E 시나리오 + 사양 감사 (발견 12건, PR #4)
- `04-qa-v0-mvp-fixes` — P0~P2 수정: 등록 데드락·택배사·조용시간·데모·스토어 준비 (PR #16)

QA 이후 런타임 버그·UX 수정(main 머지):
- PR #17 — `fetch` this-binding(`Illegal invocation`) 수정: 실제 tracker.delivery 호출 복구. 재발 방지 문서화(`ENGINEERING` A절).
- PR #18 — CI flaky 타임아웃 해소(테스트 즉시 track no-op) + 목록·상세 **택배사 한글명** 표기.
- PR #19 — 등록 직후 목록에 **실제 상태 즉시 표시**(비종료 단계 저장).
- PR #20 — **배송완료 시 보관**(자동 삭제 폐기, 사용자 수동 삭제 — ADR-005 개정).

## 예정 작업 (무엇을 해야 하는가)

**열린 이슈(GitHub):**
- `#8` (P3) 알림 그룹화/요약 — 과알림 방지.
- `#9` (P3) 푸시 **title** 의 택배사 id(`kr.cjlogistics`) → 한글명. (목록·상세는 PR #18에서 해결, **푸시 발송 문구는 worker `buildMessage` 쪽 별개**로 남아 있음.)
- `#12` (P1·제출차단) 개인정보처리방침 URL — repo 방침 문서(`PRIVACY_POLICY.md`) 완료, **호스팅·URL 확정은 배포 시 외부 작업**.
- `#14` (P1·제출차단) App Privacy/Data Safety 신고 — 초안(`QA` D절) 완료, **콘솔 제출은 외부 작업**.

**계획된 기능(아래 §상세):**
- 배송완료 **자동 삭제 옵트인 설정** — 현재 기본은 보관(ADR-005 개정), 자동 삭제는 다음 phase 설정으로.

**Phase 2 (이후):** 해외·계정 동기화(CLAUDE.md). 별도 phase 설계 필요.

<a id="plan-auto-delete"></a>

---

# 계획: 배송완료 자동 삭제 (옵트인 설정) — 구 `PLAN_AUTO_DELETE_COMPLETED.md`


> **상태**: 계획(미구현). 본 phase에서 **기본 사양을 "완료 시 보관(active=0) + 사용자 수동 삭제"로 변경**했고(ADR-005 개정), 자동 삭제는 **옵트인 설정**으로 다음 phase에 추가한다.
> 관련: `docs/ADR.md` ADR-005 · `worker/src/cron.ts` `pollOne`(배송완료 처리) · `app/app/settings.tsx` · `worker/src/index.ts`(devices 등록·삭제).

## 1. 목표 & 기본값
- 설정에 **"배송완료 시 자동 삭제"** 토글 추가. **기본값 OFF**(= 현재 기본 사양: 완료 건 보관).
- ON이면 배송완료된 운송장이 **자동으로 목록에서 제거**된다(사용자가 일일이 삭제 안 해도 됨).
- 비영속 원칙(ADR-005)과 충돌 없음 — 보관 데이터는 운송장·택배사·상태뿐(수령인 PII 아님). 자동 삭제는 편의 기능.

## 2. 핵심 제약 (왜 단순하지 않은가)
- **익명·무로그인 + dedupe**: 한 shipment 행을 **여러 device가 공유**(같은 운송장 등록 시 `subscriptions`로 N:1). "삭제"는 곧 **내 구독 제거**이고, 행 자체는 **구독이 0이 될 때만** 삭제해야 한다(타인 구독 보호).
- **삭제 주체는 서버 cron**: 완료 감지는 cron(`pollOne`)에서 일어난다. device별 설정을 cron이 알아야 한다 → 설정을 **서버에 저장**해야 앱이 꺼져 있어도 자동 삭제가 동작한다.
- **per-device 설정**: 같은 shipment를 구독한 두 device가 서로 다른 설정일 수 있다 → **구독 단위**로 판정해야 한다.

## 3. 구현안

### 권장: 서버측 per-device 설정 (앱이 꺼져 있어도 동작)
**데이터 모델**
- `devices`에 컬럼 추가: `auto_delete_completed INTEGER NOT NULL DEFAULT 0`.
- 마이그레이션: `ALTER TABLE devices ADD COLUMN auto_delete_completed INTEGER NOT NULL DEFAULT 0;` (기존 행은 DEFAULT 0 = 현 기본값 유지, 안전). `docs/ENGINEERING.md`에 추가. **주의(PITFALLS P-2)**: 단순 ADD COLUMN이라 RENAME 전파 이슈 없음.

**API**
- 설정 저장: `POST /devices` 바디에 `auto_delete_completed?: boolean` 수용(기존 upsert에 컬럼 추가), 또는 전용 `PATCH /me/settings`. 마찰 최소 원칙상 기존 `/devices` upsert 확장이 간단.

**cron `pollOne` 배송완료 분기 변경** (현재: `active=0` 보관 단일 처리)
1. 전환 CAS 승리 시 알림 발송(종전과 동일).
2. 그 shipment의 구독자별로 `devices.auto_delete_completed` 조회:
   - `=1`인 구독은 `DELETE FROM subscriptions WHERE shipment_id=? AND device_id=?`.
   - `=0`인 구독은 유지.
3. 남은 구독이 0이면 `DELETE FROM shipments WHERE id=?`(FK CASCADE로 잔여 정리), 1건↑이면 `active=0` 보관.
- **원자성/멱등**: 알림은 전환 CAS로 정확히 1회(종전 보장 유지). 구독 정리·행 삭제는 알림 발송 뒤 별도 batch. 재실행돼도 `prev==배송완료`라 재진입 없음.

### 대안(단순·MVP): 클라이언트측 (앱 열렸을 때만)
- 설정을 로컬(`expo-secure-store`)에만 저장.
- 목록 로드 시 `배송완료` 항목이 보이고 설정 ON이면 앱이 `DELETE /shipments/:id`를 자동 호출.
- 장점: 서버 스키마·cron 변경 없음. 단점: **앱이 열릴 때만** 삭제(진정한 백그라운드 자동 아님), 푸시로 완료 안 뒤 앱 안 열면 목록에 남음.
- → 빠른 출시용. 백그라운드 자동까지 원하면 권장안(서버측).

## 4. UX (설정 화면)
- `app/app/settings.tsx` "알림" 또는 신규 "보관" 섹션에 토글 행: **"배송완료 시 자동 삭제"** (보조설명: "완료된 택배를 목록에서 자동으로 지워요. 기본은 직접 삭제예요.").
- 토글 변경 → (권장안) `registerDevice`/설정 API로 서버 반영 + 로컬 캐시. 실패 시 조용히 롤백(앱 계속 동작).
- 색·컴포넌트는 토큰만(UI_GUIDE). 광고성 아님(ADR-018 무관).

## 5. 테스트 계획
- **worker(cron)**: 단위/e2e —
  - 설정 OFF(기본): 완료 시 보관(active=0)·구독 유지(현 테스트 유지).
  - 설정 ON·단일 구독: 완료 시 구독+shipment 삭제(count 0), 알림 1회.
  - 설정 ON·**다중 구독 혼합**(A=ON, B=OFF): A 구독만 제거, shipment·B 구독 유지(active=0), 알림 1회.
  - 멱등: 재실행 시 재삭제·재발송 없음.
- **app**: 설정 토글 렌더·저장 호출(jest-expo, api mock). 순수 로직 없으니 통합 수준.
- 외부 경계는 실호출 스모크로 별도 확인(`docs/ENGINEERING.md`).

## 6. Acceptance Criteria
```bash
npm run verify   # 위 테스트 포함 green
```
- 마이그레이션 적용 후 `PRAGMA table_info(devices)`에 `auto_delete_completed` 존재(notnull=1, dflt=0).
- 설정 ON에서 실 배송완료 번호 등록·cron 후 목록에서 제거(다중 구독 시 본인 것만), 실 API 스모크로 확인.

## 7. 미결정 / 논의거리
- 설정 저장 방식: `/devices` upsert 확장 vs 전용 엔드포인트 — 마찰·단순성 기준으로 결정.
- "자동 삭제"를 완료 **즉시** vs **N일 유예 후**로 둘지(유예 두면 사용자가 푸시 보고 앱에서 한 번 더 확인 가능). 기본은 즉시 제안.
- 권장안 vs 대안: 백그라운드 자동이 필요하면 서버측, 빠른 출시면 클라이언트측.
