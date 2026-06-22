import { describe, it, expect } from "@jest/globals";
import { parseAmount, formatAmount } from "./amount";

describe("parseAmount", () => {
  it("0 이상 정수 문자열은 number 로 파싱한다", () => {
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("12000")).toBe(12000);
    expect(parseAmount("9999999999")).toBe(9_999_999_999); // 10^10 미만(상한 직전)
  });

  it("앞뒤 공백은 무시한다", () => {
    expect(parseAmount("  12000  ")).toBe(12000);
  });

  it("number 입력도 0 이상 정수면 그대로 반환한다", () => {
    expect(parseAmount(0)).toBe(0);
    expect(parseAmount(34000)).toBe(34000);
  });

  it("음수는 거부한다(undefined)", () => {
    expect(parseAmount("-5")).toBeUndefined();
    expect(parseAmount(-5)).toBeUndefined();
  });

  it("소수·비정수는 거부한다", () => {
    expect(parseAmount("12.5")).toBeUndefined();
    expect(parseAmount("12000.0")).toBeUndefined();
    expect(parseAmount(12.5)).toBeUndefined();
  });

  it("빈 문자열·공백은 거부한다", () => {
    expect(parseAmount("")).toBeUndefined();
    expect(parseAmount("   ")).toBeUndefined();
  });

  it("비숫자 문자열은 거부한다", () => {
    expect(parseAmount("abc")).toBeUndefined();
    expect(parseAmount("1,200")).toBeUndefined(); // 쉼표 포함도 거부(원시 숫자만)
    expect(parseAmount("1e5")).toBeUndefined();
    expect(parseAmount("0x10")).toBeUndefined();
  });

  it("상한(10^10) 이상은 거부한다", () => {
    expect(parseAmount("10000000000")).toBeUndefined(); // 정확히 10^10
    expect(parseAmount("99999999999")).toBeUndefined();
    expect(parseAmount(10_000_000_000)).toBeUndefined();
  });
});

describe("formatAmount", () => {
  it("천단위 구분 + ₩ 접두", () => {
    expect(formatAmount(12000)).toBe("₩12,000");
    expect(formatAmount(1234567)).toBe("₩1,234,567");
    expect(formatAmount(999)).toBe("₩999");
  });

  it("0 은 ₩0", () => {
    expect(formatAmount(0)).toBe("₩0");
  });

  it("undefined 는 — (대시)", () => {
    expect(formatAmount(undefined)).toBe("—");
    expect(formatAmount()).toBe("—");
  });
});
