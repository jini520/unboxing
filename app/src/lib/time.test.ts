import { describe, it, expect } from "@jest/globals";
import { relativeTime, absoluteKST } from "./time";

const NOW = Date.parse("2026-06-16T12:00:00Z");

describe("relativeTime", () => {
  it("1분 미만은 '방금'", () => {
    expect(relativeTime("2026-06-16T11:59:30Z", NOW)).toBe("방금");
    expect(relativeTime("2026-06-16T12:00:00Z", NOW)).toBe("방금");
  });

  it("미래 시각도 '방금'으로 흡수", () => {
    expect(relativeTime("2026-06-16T12:05:00Z", NOW)).toBe("방금");
  });

  it("분 단위 — 'N분 전'", () => {
    expect(relativeTime("2026-06-16T11:58:00Z", NOW)).toBe("2분 전");
    expect(relativeTime("2026-06-16T11:01:00Z", NOW)).toBe("59분 전");
  });

  it("시간 단위 — 'N시간 전'", () => {
    expect(relativeTime("2026-06-16T10:00:00Z", NOW)).toBe("2시간 전");
    expect(relativeTime("2026-06-15T13:00:00Z", NOW)).toBe("23시간 전");
  });

  it("일 단위 — 'N일 전'", () => {
    expect(relativeTime("2026-06-14T12:00:00Z", NOW)).toBe("2일 전");
  });

  it("파싱 불가 문자열은 '방금'", () => {
    expect(relativeTime("not-a-date", NOW)).toBe("방금");
  });

  it("epoch ms(number) 도 직접 받는다(ISO 왕복 불필요)", () => {
    expect(relativeTime(Date.parse("2026-06-16T11:58:00Z"), NOW)).toBe("2분 전");
    expect(relativeTime(NOW, NOW)).toBe("방금");
  });

  it("누락(undefined)·NaN 은 '방금'으로 흡수(createdAt 비어도 크래시 없음)", () => {
    expect(relativeTime(undefined as unknown as number, NOW)).toBe("방금");
    expect(relativeTime(NaN, NOW)).toBe("방금");
  });
});

describe("absoluteKST", () => {
  it("UTC → KST(+9h) 벽시계로 변환", () => {
    expect(absoluteKST("2026-06-16T00:30:00Z")).toBe("6.16 09:30");
  });

  it("자정 경계 — UTC 전날 23시는 KST 다음날 08시", () => {
    expect(absoluteKST("2026-06-15T23:00:00Z")).toBe("6.16 08:00");
  });

  it("분·시 0 패딩", () => {
    expect(absoluteKST("2026-01-02T00:05:00Z")).toBe("1.2 09:05");
  });

  it("파싱 불가면 빈 문자열", () => {
    expect(absoluteKST("nope")).toBe("");
  });
});
