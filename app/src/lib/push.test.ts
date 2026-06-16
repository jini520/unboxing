import { describe, it, expect } from "@jest/globals";
import { routeForNotification } from "./push";

describe("routeForNotification", () => {
  it("{shipment_id} → /shipment/{id}", () => {
    expect(routeForNotification({ shipment_id: "abc" })).toBe("/shipment/abc");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["문자열", "abc"],
    ["숫자", 123],
    ["shipment_id 없는 객체", { other: "x" }],
    ["shipment_id 가 문자열이 아님", { shipment_id: 123 }],
    ["shipment_id 가 빈 문자열", { shipment_id: "" }],
  ])("잘못된 payload(%s) → null", (_label, data) => {
    expect(routeForNotification(data)).toBeNull();
  });
});
