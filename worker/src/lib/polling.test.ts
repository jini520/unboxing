import { describe, it, expect } from "vitest";
import { isDue, pollIntervalMs, WEBHOOK_FALLBACK_MS } from "./polling";

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
