import { describe, it, expect } from "vitest";
import { isDue, pollIntervalMs, WEBHOOK_FALLBACK_MS, unregisteredInterval, fallbackInterval } from "./polling";

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

describe("isDue — webhook 조건부 폴백 (4번째 인자, ADR-028)", () => {
  const now = 1_700_000_000_000;
  const H = 60 * 60 * 1000;

  it("webhookExpiresAt 미지정(기본 null) → 적응형 그대로(하위호환)", () => {
    expect(isDue("배송출발", now - 61 * 60_000, now)).toBe(true); // 61분 > 1h
    expect(isDue("배송출발", now - 30 * 60_000, now)).toBe(false); // 30분 < 1h
  });

  it("미등록분(expiresAt=null)은 명시해도 적응형 그대로", () => {
    expect(isDue("배송출발", now - 61 * 60_000, now, null)).toBe(true);
  });

  it("webhook 등록분(expiresAt 있음)은 ~12h 안전망 — 1h 지나도 due 아님", () => {
    const expiresAt = now + 48 * H;
    expect(isDue("배송출발", now - 2 * H, now, expiresAt)).toBe(false); // 2h < 12h
    expect(isDue("배송출발", now - (WEBHOOK_FALLBACK_MS + 1), now, expiresAt)).toBe(true); // 12h 초과
  });

  it("배송완료는 webhook 유무와 무관하게 due 아님", () => {
    expect(isDue("배송완료", null, now, now + 48 * H)).toBe(false);
  });
});

describe("미등록 시간대 윈도 폴링 (ADR-031, KST)", () => {
  const kst = (s: string) => Date.parse(s); // "...+09:00" → KST 결정적

  it("06:00–18:00 낮 → 15분", () => {
    expect(unregisteredInterval(kst("2026-06-27T06:00:00+09:00"))).toBe(15 * 60_000); // 경계 포함
    expect(unregisteredInterval(kst("2026-06-27T12:00:00+09:00"))).toBe(15 * 60_000);
    expect(unregisteredInterval(kst("2026-06-27T17:59:00+09:00"))).toBe(15 * 60_000);
  });

  it("18:00–21:00 저녁 → 1시간", () => {
    expect(unregisteredInterval(kst("2026-06-27T18:00:00+09:00"))).toBe(60 * 60_000); // 경계 포함
    expect(unregisteredInterval(kst("2026-06-27T20:59:00+09:00"))).toBe(60 * 60_000);
  });

  it("21:00–06:00 밤 → null(폴링 안 함)", () => {
    expect(unregisteredInterval(kst("2026-06-27T21:00:00+09:00"))).toBeNull(); // 경계 포함
    expect(unregisteredInterval(kst("2026-06-27T23:30:00+09:00"))).toBeNull();
    expect(unregisteredInterval(kst("2026-06-27T03:00:00+09:00"))).toBeNull();
    expect(unregisteredInterval(kst("2026-06-27T05:59:00+09:00"))).toBeNull();
  });

  it("fallbackInterval 이 미등록에 시간대 윈도 적용(webhook 무관)", () => {
    const day = kst("2026-06-27T12:00:00+09:00");
    const night = kst("2026-06-27T23:00:00+09:00");
    expect(fallbackInterval("미등록", null, day)).toBe(15 * 60_000);
    expect(fallbackInterval("미등록", day + 48 * 3_600_000, day)).toBe(15 * 60_000); // webhook 있어도 시간대 윈도
    expect(fallbackInterval("미등록", null, night)).toBeNull();
  });

  it("isDue: 밤엔 재폴링 skip하되 첫 폴링(null)은 1회 허용 [(c)·ADR-031], 낮엔 15분마다", () => {
    const night = kst("2026-06-27T23:00:00+09:00");
    expect(isDue("미등록", null, night)).toBe(true); // (c) 한 번도 안 본 송장은 밤에도 1회
    expect(isDue("미등록", night - 60_000, night)).toBe(false); // 이미 폴링됨 → 밤엔 재폴링 skip
    const day = kst("2026-06-27T12:00:00+09:00");
    expect(isDue("미등록", null, day)).toBe(true); // 낮·미폴링 → 즉시
    expect(isDue("미등록", day - 15 * 60_000, day)).toBe(true); // 15분 경과 → due
    expect(isDue("미등록", day - 14 * 60_000, day)).toBe(false); // 14분 → 아직
  });
});
