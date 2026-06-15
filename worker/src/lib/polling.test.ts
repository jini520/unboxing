import { describe, it, expect } from "vitest";
import { isDue, pollIntervalMs } from "./polling";

describe("pollIntervalMs", () => {
  it("배송출발: 기본 1시간, BYOK 30분", () => {
    expect(pollIntervalMs("배송출발", "shared")).toBe(60 * 60_000);
    expect(pollIntervalMs("배송출발", "byok")).toBe(30 * 60_000);
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

  it("간격 미달이면 false, BYOK 절반 간격이면 true", () => {
    const last = now - 30 * 60_000; // 30분 전
    expect(isDue("배송출발", last, now, "shared")).toBe(false); // 기본 1시간 미달
    expect(isDue("배송출발", last, now, "byok")).toBe(true); // BYOK 30분 도달
  });

  it("배송완료는 절대 due 아님", () => {
    expect(isDue("배송완료", null, now)).toBe(false);
  });
});
