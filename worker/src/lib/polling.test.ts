import { describe, it, expect } from "vitest";
import { isDue, pollIntervalMs } from "./polling";

describe("pollIntervalMs", () => {
  it("배송출발은 1시간", () => {
    expect(pollIntervalMs("배송출발")).toBe(60 * 60_000);
  });

  it("배송완료는 폴링 중단(null)", () => {
    expect(pollIntervalMs("배송완료")).toBeNull();
  });
});

describe("isDue (고정 시계)", () => {
  const now = 1_700_000_000_000;

  it("한 번도 폴링 안 했으면 즉시 due", () => {
    expect(isDue("배송출발", null, now)).toBe(true);
  });

  it("간격 미달이면 false, 지나면 true", () => {
    expect(isDue("배송출발", now - 30 * 60_000, now)).toBe(false); // 30분 < 1시간
    expect(isDue("배송출발", now - 61 * 60_000, now)).toBe(true); // 61분 > 1시간
  });

  it("배송완료는 절대 due 아님", () => {
    expect(isDue("배송완료", null, now)).toBe(false);
  });
});
