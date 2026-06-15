import { describe, it, expect } from "@jest/globals";
import { normalizeTrackingNumber, isValidTrackingNumber } from "./tracking";

describe("normalizeTrackingNumber", () => {
  it("공백·하이픈을 제거한다", () => {
    expect(normalizeTrackingNumber(" 1234-5678-9012 ")).toBe("123456789012");
  });
});

describe("isValidTrackingNumber", () => {
  it("9~14자리 숫자는 유효", () => {
    expect(isValidTrackingNumber("123456789")).toBe(true);
    expect(isValidTrackingNumber("1234-5678-9012")).toBe(true);
  });

  it("너무 짧거나 문자가 섞이면 무효", () => {
    expect(isValidTrackingNumber("123")).toBe(false);
    expect(isValidTrackingNumber("abc123456")).toBe(false);
  });
});
