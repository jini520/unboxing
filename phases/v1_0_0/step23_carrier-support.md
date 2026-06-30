# Step 23: carrier-support (#5 P2 — 미지원 택배사 409 딥링크)

형식만 맞으면 미지원 택배사도 수락하던 문제를 고쳐, 미지원이면 `409 CARRIER_UNSUPPORTED`로 앱이 딥링크 폴백을 띄우게 한다. **이슈 #5(QA-002) 해소**.

## 읽어야 할 파일

- GitHub 이슈 **#5** 및 `/docs/QA_FINDINGS.md`의 **QA-002** 행
- `/docs/PRD.md` — 핵심 플로우 4(미지원→딥링크), 핵심 기능 2(자동인식·확인)
- `/docs/ARCHITECTURE.md` — "HTTP API 계약"(`409 CARRIER_UNSUPPORTED`), "tracker.delivery 연동"(`carriers` 쿼리)
- `/Users/jinni/Developments/unboxing/worker/src/index.ts` — `handleCreateShipment`의 `CARRIER_RE` 검사
- `/Users/jinni/Developments/unboxing/worker/src/tracker.ts` — `carriers()`(지원 목록)
- `/Users/jinni/Developments/unboxing/app/app/register.tsx` — 409 처리(`openCarrierLookup` 딥링크), `app/src/lib/carrier.ts`(`CARRIERS`)
- step0 산출(`register-fix`) — device 등록 전제

## 작업

미지원 판별 방식을 정한다(둘 중 하나, 단순한 쪽 권장):

- **(A) 서버 허용목록 대조**: `handleCreateShipment`에서 carrier를 **지원 택배사 집합과 대조**해 미지원이면 `409`. Phase 1 국내 택배사는 `app/src/lib/carrier.ts`의 `CARRIERS`(8종) id와 동일 집합이므로, worker에 같은 carrierId 상수 집합을 두고 대조(외부 `carriers()` 호출은 subrequest/지연이라 등록 핫패스에선 지양 — 코드 상수 권장, ADR-009 정신). 또는
- **(B) 앱 사전 차단**: 앱이 등록 전 carrier가 지원 목록인지 확인하고 미지원이면 딥링크 카드(서버 왕복 없이).

**권장: (A)** — 서버가 단일 권위. worker에 지원 carrierId 상수 집합 + 미지원 시 `409 CARRIER_UNSUPPORTED`. 앱 `register.tsx`는 이미 409→딥링크 경로가 있으니 동작 확인·연결만.

## 핵심 규칙 (벗어나면 안 됨)

- 등록 핫패스에서 외부 `carriers()` 동기 호출로 지연/субrequest를 늘리지 마라 — 코드 상수 집합 대조 권장. 이유: 비용·지연(ARCHITECTURE).
- 지원 목록을 worker·app 두 곳에 흩지 말고 가능하면 단일 출처(혹은 명시적 동기화 주석). 이유: 드리프트 방지.
- 형식 검증(`^\d{9,14}$`)·기존 멱등/dedupe 동작 불변.

## 엣지케이스 & 에러 처리 (반드시 다룰 것)

- **'미지원'이 앱 UI 에서 도달 가능한가 — 핵심 전제**: 앱은 `carrier.ts` 의 `CARRIERS`(8종)만 드롭다운으로 제시한다. worker 가 같은 8종으로 대조하면 **앱 경로에선 409 가 절대 안 뜬다**(409 는 직접 API 호출 robustness 용). PRD 플로우4(미지원→딥링크)가 실제로 트리거되려면 *앱이 tracker.delivery 미지원 택배사도 제시*해야 한다. → 이 step에서 **8종 중 자동추적 가능 carrier 와 '딥링크 전용' carrier 를 구분**할지 결정하라(현재는 8종 모두 추적 가정). 딥링크 전용을 둘 거면 그 carrier 는 등록 대신 딥링크 카드로(앱), 두지 않을 거면 409 는 API 방어용으로만 두고 그 사실을 주석에 명시.
- **409 응답 본문**: ARCHITECTURE 는 "409 + 딥링크 정보 포함"을 권장. 앱이 자체적으로 택배사 조회 URL(`register.tsx openCarrierLookup`)을 만들면 서버 body 는 `{error, code}` 로 충분 — 단 앱이 409 를 받았을 때 carrier 명을 안내에 쓸 수 있게 한다.
- **빈/공백 carrier**: 기존 400/409 경로 유지(회귀 금지).
- **데모 carrier(step4)**: 데모 번호가 쓰는 carrier 가 지원목록을 통과해야 등록까지 도달.

## 검증 (수정 증명)

> qa-mvp `it.todo`·`[QA-NNN 재현]` 의 위치는 grep 으로 확인.

- `worker/test/e2e/register.test.ts`의 QA-002 `it.todo`를 통과로 전환: 미지원 carrier로 `POST /shipments` → **409 CARRIER_UNSUPPORTED**. 지원 carrier는 계속 201.
- **`it("[QA-002 재현] … → 201")` 도 처리**: 현재 버그(미지원도 201)를 단언하는 재현 테스트를 **409 로 뒤집기**(또는 todo 와 병합). 방치 시 수정 후 verify red.
- 앱: 409 응답 시 `register.tsx`가 딥링크 안내로 분기하는지(로직 테스트 가능 범위).

## Acceptance Criteria

```bash
npm run verify
```

## 검증 절차

1. AC 실행. 2. 체크리스트: 미지원 409·지원 201? 외부 호출로 핫패스 지연 없음? 앱 딥링크 연결? 3. `phases/qa-fixes/index.json` step 1 업데이트(summary "fixes #5"). 이슈 자동 닫기는 qa-fixes PR 본문에서.

## 금지사항

- 모든 carrier를 무조건 수락하지 마라(현 버그). 이유: 미지원이 영구 미등록으로 쌓임.
- 등록마다 외부 `carriers()`를 호출하지 마라. 이유: 비용·지연.
- 기존 테스트를 깨뜨리지 마라.
