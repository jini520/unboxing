/**
 * 캡처 분류(LLM) 응답 → 기존 ShipmentInfo 부분값 매핑(ADR-039, 자동 채움 초안·편집 가능).
 * docs/ARCHITECTURE.md "v1.1.2 출력 매핑"(memo←상품명·amount←가격·category).
 *
 * 순수 함수 — 저장(setInfo)·네트워크 없음(저장은 기존 setInfo 가 담당). 매핑 불가 필드는 비운다(사용자 직접 입력).
 * 기존 단일 출처를 그대로 재사용(드리프트 방지): CATEGORIES·MEMO_MAX_LENGTH(info.ts)·parseAmount(amount.ts).
 */
import { CATEGORIES, MEMO_MAX_LENGTH, type ShipmentInfo } from "./info";
import { parseAmount } from "./amount";

/** classify 응답 → ShipmentInfo 부분값. memo·amount·category 는 각 검증을 통과할 때만 채운다. */
export function mapClassificationToInfo(resp: {
  productName?: string | null;
  price?: number | null;
  category?: string | null;
}): Partial<ShipmentInfo> {
  const out: Partial<ShipmentInfo> = {};

  // memo ← 상품명: trim 후 100자 제한(기존 메모 모달 maxLength 와 동일 단일 출처). 빈값이면 미설정.
  const memo = resp.productName?.trim();
  if (memo) out.memo = memo.slice(0, MEMO_MAX_LENGTH);

  // amount ← 가격: parseAmount 검증(0 이상 정수 — 0 보존·음수·비정수·상한 거부). 실패/null 이면 미설정.
  if (resp.price != null) {
    const amount = parseAmount(resp.price);
    if (amount !== undefined) out.amount = amount;
  }

  // category ← 카테고리: CATEGORIES 9종 정확 일치만(그 외/null/빈값은 미분류 → 사용자가 직접 선택).
  if (resp.category && (CATEGORIES as readonly string[]).includes(resp.category)) {
    out.category = resp.category;
  }

  return out;
}
