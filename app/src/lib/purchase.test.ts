import { describe, it, expect } from "@jest/globals";
import { mapClassificationToInfo } from "./purchase";
import { CATEGORIES, MEMO_MAX_LENGTH } from "./info";
import { AMOUNT_LIMIT } from "./amount";

describe("mapClassificationToInfo", () => {
  it("정상 응답 → memo·amount·category 모두 매핑한다", () => {
    expect(
      mapClassificationToInfo({ productName: "갤럭시 버즈3 프로", price: 189000, category: "전자·디지털" }),
    ).toEqual({ memo: "갤럭시 버즈3 프로", amount: 189000, category: "전자·디지털" });
  });

  it("상품명은 trim 후 memo 로 매핑한다", () => {
    expect(mapClassificationToInfo({ productName: "  백팩  ", price: null, category: null })).toEqual({
      memo: "백팩",
    });
  });

  it("빈/공백 상품명은 memo 미설정", () => {
    expect(mapClassificationToInfo({ productName: "   ", price: null, category: null })).toEqual({});
    expect(mapClassificationToInfo({ productName: "", price: null, category: null })).toEqual({});
  });

  it("상품명 100자 초과는 100자로 절단한다", () => {
    const long = "가".repeat(150);
    const out = mapClassificationToInfo({ productName: long, price: null, category: null });
    expect(out.memo).toHaveLength(MEMO_MAX_LENGTH);
    expect(out.memo).toBe("가".repeat(MEMO_MAX_LENGTH));
  });

  it("상품명 정확히 100자는 보존한다", () => {
    const exact = "가".repeat(MEMO_MAX_LENGTH);
    expect(mapClassificationToInfo({ productName: exact, price: null, category: null }).memo).toBe(exact);
  });

  it("가격 0 은 유효값이라 amount=0 으로 보존한다", () => {
    expect(mapClassificationToInfo({ productName: null, price: 0, category: null })).toEqual({ amount: 0 });
  });

  it("가격 양의 정수는 amount 로 매핑한다", () => {
    expect(mapClassificationToInfo({ productName: null, price: 60190, category: null })).toEqual({
      amount: 60190,
    });
  });

  it("가격 음수·비정수는 amount 미설정", () => {
    expect(mapClassificationToInfo({ productName: null, price: -1, category: null })).toEqual({});
    expect(mapClassificationToInfo({ productName: null, price: 1000.5, category: null })).toEqual({});
  });

  it("가격 상한(10^10) 이상은 amount 미설정", () => {
    expect(mapClassificationToInfo({ productName: null, price: AMOUNT_LIMIT, category: null })).toEqual({});
  });

  it("카테고리는 CATEGORIES 9종 중 정확히 일치할 때만 설정한다", () => {
    for (const c of CATEGORIES) {
      expect(mapClassificationToInfo({ productName: null, price: null, category: c }).category).toBe(c);
    }
  });

  it("카테고리 9종 밖 값은 미설정(미분류)", () => {
    expect(mapClassificationToInfo({ productName: null, price: null, category: "가전" })).toEqual({});
    expect(mapClassificationToInfo({ productName: null, price: null, category: "Electronics" })).toEqual({});
    expect(mapClassificationToInfo({ productName: null, price: null, category: "" })).toEqual({});
  });

  it("전부 null 이면 빈 객체", () => {
    expect(mapClassificationToInfo({ productName: null, price: null, category: null })).toEqual({});
  });

  it("필드 누락(undefined)도 빈 객체", () => {
    expect(mapClassificationToInfo({})).toEqual({});
  });
});
