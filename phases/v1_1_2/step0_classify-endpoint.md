# Step 0: classify-endpoint (Workers AI 분류 — `POST /classify-purchase`)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-036**(하이브리드 파이프라인)·**ADR-037**(모델 `@cf/openai/gpt-oss-120b`·비학습·무료 한도·$0 폴백) 전문.
- `/docs/ARCHITECTURE.md` — "v1.1.2 — 구매 캡처 분석 파이프라인" 섹션(③ 분류 + 출력 매핑) 및 "에러 처리 매트릭스".
- `/CLAUDE.md` — `CRITICAL: 운영 서버 비용 0원`·`개인정보 비영속`. 핵심 순수 로직 test-first.
- `worker/src/index.ts` — `interface Env`(23행~), 라우팅 분기 패턴(`if (pathname === "/shipments" && method === "POST")` 788행~), IP 레이트리밋(`/devices`·`/shipments`).
- `worker/wrangler.toml` — `[[d1_databases]]` 등 바인딩 위치.
- `app/src/lib/info.ts` — `CATEGORIES` 9종(분류 강제 목록과 동일해야 함).

## 작업

기존 `unboxing-worker` 에 **신규 엔드포인트 1개**와 **AI 바인딩**을 추가한다. 상시 서버가 아니라 요청 시 실행($0 유지).

### 1. AI 바인딩
- `worker/wrangler.toml` 에 추가:
  ```toml
  [ai]
  binding = "AI"
  ```
- `worker/src/index.ts` 의 `interface Env` 에 `AI: Ai;` 추가(Workers AI 타입 — `@cloudflare/workers-types` 의 `Ai`).

### 2. `POST /classify-purchase`
- 입력: **마스킹된 텍스트만**(JSON 바디 `{ text: string }`). **이미지·원문 PII는 절대 받지 않는다.**
- 처리: 프롬프트(아래 규칙) + `env.AI.run("@cf/openai/gpt-oss-120b", { messages, ... })` → 응답 `content` 에서 JSON 추출.
- 출력: `{ productName: string, price: number | null, category: string | null }`.
  - `category` 는 **반드시 `CATEGORIES` 9종 중 하나**(식품·생활용품·의류·패션·뷰티·전자·디지털·도서·문구·가구·인테리어·유아·반려·기타). 그 외/불명이면 `null`(클라가 미분류 처리).
  - `price` 는 0 이상 정수 또는 `null`. 여러 금액이 있으면 **"총 결제금액/합계"** 를 고르도록 프롬프트로 유도(소계·정가·할인 아님).

### 3. 순수 헬퍼 (test-first)
프롬프트 빌드와 응답 파싱은 **순수 함수로 분리**해 `worker/src/` 에 두고 **test-first**:
- `buildClassifyPrompt(text: string): {messages: ...}` — CATEGORIES 목록을 프롬프트에 주입.
- `parseClassifyResponse(raw: string): { productName, price, category }` — content→JSON 추출, 카테고리 화이트리스트 강제, price 정수 검증. JSON 깨짐/카테고리 밖 → 안전 폴백(`category: null`).
- 테스트는 `env.AI.run` 을 **mock** 한다(외부 경계). 실호출 검증은 step 4 스모크.

### 4. 폴백·$0 (ADR-037)
- 무료 한도 초과·타임아웃·JSON 깨짐 → **에러로 크래시하지 말고** `category: null`(또는 503 + 클라 폴백)로 처리. 클라이언트가 "미분류 + 직접 입력"으로 흡수한다.
- 입력/출력 어떤 것도 **D1 에 저장 금지**(ADR-005).
- 기존 IP 레이트리밋 패턴을 이 엔드포인트에도 적용(남용 방어).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

> ⚠️ mock `verify` green 은 **실제 Workers AI 호출을 보증하지 않는다**(외부 경계). 실호출은 step 4.

## 검증 절차

1. 위 AC 커맨드 실행(특히 `parseClassifyResponse` 의 카테고리 강제·폴백 케이스 green).
2. 체크리스트:
   - 입력이 **텍스트 전용**(이미지 미수용)인가? 입력/출력 D1 미저장인가?(ADR-005)
   - category 가 `CATEGORIES` 9종 또는 `null` 로만 나오는가?
   - 한도/에러 시 크래시 아니라 폴백인가?($0·ADR-037)
   - `fetch` 주입 함정(P-1)은 이 엔드포인트와 무관하나 deps 패턴을 깨지 않았는가?
3. `phases/v1_1_2/index.json` 의 step 0 업데이트(성공 → completed + summary / 3회 실패 → error).

## 금지사항

- 이미지나 마스킹 안 된 원문을 입력으로 받지 마라. 이유: PII가 기기를 떠나면 안 됨(ADR-036·005). 이 엔드포인트는 **마스킹 텍스트 전용**.
- 입력·출력·중간값을 D1 에 저장하지 마라. 이유: 개인정보 비영속(CRITICAL·ADR-005).
- 카테고리를 `CATEGORIES` 밖 자유 문자열로 반환하지 마라. 이유: 앱 칩이 9종 고정(ADR-039) — 매핑 깨짐.
- 한도 초과를 throw 로 흘려 등록 흐름을 막지 마라. 이유: $0 정책 + 직접 입력 폴백(ADR-037).
- 기존 테스트를 깨뜨리지 마라.
