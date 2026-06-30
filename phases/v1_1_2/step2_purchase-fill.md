# Step 2: purchase-fill (LLM 응답 → ShipmentInfo 매핑 · test-first)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-039**(통합·저장 = 기존 ShipmentInfo 재사용·카테고리 9종 강제·D1 미저장).
- `/docs/ARCHITECTURE.md` — "v1.1.2" 출력 매핑(memo←상품명·amount←가격·category).
- `app/src/lib/info.ts` — **`ShipmentInfo` 타입·`CATEGORIES` 9종·`setInfo` 계약**(메모 100자·빈 메모 삭제 등). 이 파일을 꼭 읽고 기존 계약을 따르라.
- `app/src/lib/amount.ts` — `parseAmount`(0 ≤ n < 10^10 정수 검증). 가격 매핑에 재사용.
- `/CLAUDE.md` — 순수 로직 test-first.

## 작업

`app/src/lib/purchase.ts` 에 **순수 함수**를 신규 추가한다. **test-first**.

```ts
import type { ShipmentInfo } from "./info";

/** classify 응답 → 기존 ShipmentInfo 부분값. 자동 채움 초안(편집 가능). 매핑 불가 필드는 비움. */
export function mapClassificationToInfo(
  resp: { productName?: string | null; price?: number | null; category?: string | null }
): Partial<ShipmentInfo>;
```

매핑 규칙(ADR-039):
- **memo ← productName**: trim 후 **100자 제한**(`setInfo`/기존 메모 계약과 동일). 빈/공백이면 memo 미설정.
- **amount ← price**: `parseAmount` 로 검증(0 이상 정수). 실패/`null` 이면 amount 미설정.
- **category ← category**: **`CATEGORIES` 9종 중 정확히 일치할 때만** 설정. 그 외/`null` 이면 미설정(미분류 → 사용자가 직접 선택).

## Acceptance Criteria

```bash
npm run verify
```

## 검증 절차

1. 위 AC 실행 — 정상 매핑 / 카테고리 9종 밖(미설정) / 가격 음수·비정수(미설정) / 상품명 100자 초과(절단) / 전부 null(빈 객체) 케이스 green.
2. 체크리스트:
   - 순수 함수인가? `CATEGORIES`·`parseAmount`·메모 100자 등 **기존 계약을 재사용**했는가(중복 구현 금지)?
   - D1 저장 로직을 넣지 않았는가(매핑만 — 저장은 step 3 의 기존 `setInfo`)?
3. `phases/v1_1_2/index.json` step 2 업데이트.

## 금지사항

- `CATEGORIES`·`parseAmount`·메모 100자 규칙을 이 파일에 다시 구현하지 마라. 이유: 기존 단일 출처 재사용(드리프트 방지).
- 카테고리를 9종 밖 값으로 통과시키지 마라. 이유: 칩 매핑 깨짐(ADR-039).
- 저장(`setInfo`)·네트워크를 이 함수에 넣지 마라. 이유: 순수 매핑만(저장은 step 3).
- 기존 테스트를 깨뜨리지 마라.
