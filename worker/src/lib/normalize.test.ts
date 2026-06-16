import { describe, it, expect } from "vitest";
import { normalizeStatus } from "./normalize";
import type { Stage } from "./polling";

describe("normalizeStatus (전수 매핑)", () => {
  const cases: [string, Stage][] = [
    ["INFORMATION_RECEIVED", "등록"],
    ["AT_PICKUP", "집화"],
    ["IN_TRANSIT", "이동중"],
    ["OUT_FOR_DELIVERY", "배송출발"],
    ["DELIVERED", "배송완료"],
    ["AVAILABLE_FOR_PICKUP", "배송완료"],
    ["ATTEMPT_FAIL", "예외"],
    ["EXCEPTION", "예외"],
    ["UNKNOWN", "기타"],
  ];

  for (const [code, expected] of cases) {
    it(`${code} → ${expected}`, () => {
      expect(normalizeStatus(code)).toBe(expected);
    });
  }
});

describe("normalizeStatus (안전 폴백)", () => {
  it("미매핑 임의 문자열은 기타", () => {
    expect(normalizeStatus("WEIRD_CODE")).toBe("기타");
    expect(normalizeStatus("foo")).toBe("기타");
  });

  it("null/undefined/빈 문자열은 미등록", () => {
    expect(normalizeStatus(null)).toBe("미등록");
    expect(normalizeStatus(undefined)).toBe("미등록");
    expect(normalizeStatus("")).toBe("미등록");
  });

  it("미매핑 코드에서 throw 하지 않는다", () => {
    expect(() => normalizeStatus("ANY_NEW_CARRIER_CODE")).not.toThrow();
  });
});
