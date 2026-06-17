import { describe, it, expect } from "vitest";
import { isQuietHours, isUrgentStage } from "./quiet";
import type { Stage } from "./polling";

/** 주어진 KST 시:분 의 epoch ms (날짜는 임의 고정 — 시각 판정만 검증). KST = UTC+9. */
function kstAt(hour: number, minute = 0): number {
  return Date.UTC(2023, 10, 15, hour - 9, minute, 0);
}

describe("isQuietHours (KST 22:00–08:00 경계)", () => {
  it("22:00 정각 → 야간(포함)", () => {
    expect(isQuietHours(kstAt(22, 0))).toBe(true);
  });

  it("21:59 → 주간(22:00 직전)", () => {
    expect(isQuietHours(kstAt(21, 59))).toBe(false);
  });

  it("08:00 정각 → 주간(끝 미포함)", () => {
    expect(isQuietHours(kstAt(8, 0))).toBe(false);
  });

  it("07:59 → 야간(08:00 직전)", () => {
    expect(isQuietHours(kstAt(7, 59))).toBe(true);
  });

  it("자정·새벽(00:00·02:00) → 야간", () => {
    expect(isQuietHours(kstAt(0, 0))).toBe(true);
    expect(isQuietHours(kstAt(2, 0))).toBe(true);
  });

  it("한낮(12:00·14:00) → 주간", () => {
    expect(isQuietHours(kstAt(12, 0))).toBe(false);
    expect(isQuietHours(kstAt(14, 0))).toBe(false);
  });

  it("23:00 → 야간", () => {
    expect(isQuietHours(kstAt(23, 0))).toBe(true);
  });
});

describe("isUrgentStage (야간에도 즉시 발송)", () => {
  it("예외·배송완료 → 긴급(true)", () => {
    expect(isUrgentStage("예외")).toBe(true);
    expect(isUrgentStage("배송완료")).toBe(true);
  });

  it("그 외 단계 → 비긴급(false)", () => {
    const nonUrgent: Stage[] = ["미등록", "등록", "집화", "이동중", "배송출발", "기타"];
    for (const stage of nonUrgent) {
      expect(isUrgentStage(stage)).toBe(false);
    }
  });
});
