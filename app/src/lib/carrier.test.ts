import { describe, it, expect } from "@jest/globals";
import { estimateCarriers, autoPickCarrier, CARRIERS } from "./carrier";
import { isValidTrackingNumber } from "./tracking";

describe("estimateCarriers", () => {
  it("자릿수별로 후보를 가능성 순으로 제시한다", () => {
    expect(estimateCarriers("1234567890123").map((c) => c.id)).toEqual([
      "kr.epost",
      "kr.cjlogistics",
      "kr.hanjin",
    ]);
    expect(estimateCarriers("123456789012").map((c) => c.id)).toEqual([
      "kr.cjlogistics",
      "kr.lotte",
      "kr.hanjin",
    ]);
    expect(estimateCarriers("12345678901").map((c) => c.id)).toEqual([
      "kr.logen",
      "kr.cjlogistics",
    ]);
    expect(estimateCarriers("1234567890").map((c) => c.id)).toEqual([
      "kr.cjlogistics",
      "kr.hanjin",
    ]);
  });

  it("매칭되는 길이가 없으면 흔한 기본 후보로 폴백한다", () => {
    expect(estimateCarriers("123456789").map((c) => c.id)).toEqual([
      "kr.cjlogistics",
      "kr.epost",
      "kr.hanjin",
    ]);
  });

  it("정규화(공백·하이픈 제거) 후 자릿수로 추정한다 — tracking.ts 재사용", () => {
    expect(estimateCarriers(" 1234-5678-9012 ").map((c) => c.id)).toEqual(
      estimateCarriers("123456789012").map((c) => c.id),
    );
  });

  it("형식이 무효면 빈 배열(추정 불가) — tracking.ts 검증 재사용", () => {
    expect(isValidTrackingNumber("123")).toBe(false);
    expect(estimateCarriers("123")).toEqual([]);
    expect(estimateCarriers("abc123456")).toEqual([]);
    expect(estimateCarriers("")).toEqual([]);
  });

  it("후보 id는 모두 지원 택배사 목록(CARRIERS)에 존재한다", () => {
    const ids = new Set(CARRIERS.map((c) => c.id));
    for (const n of ["1234567890123", "123456789012", "12345678901", "1234567890", "123456789"]) {
      for (const c of estimateCarriers(n)) expect(ids.has(c.id)).toBe(true);
    }
  });
});

describe("autoPickCarrier", () => {
  it("후보 0개(빈 배열)면 자동선택하지 않는다(null)", () => {
    expect(autoPickCarrier([])).toBeNull();
  });

  it("후보가 정확히 1개면 그 id를 자동선택한다", () => {
    expect(autoPickCarrier([{ id: "kr.cjlogistics", name: "CJ대한통운" }])).toBe("kr.cjlogistics");
  });

  it("후보 2개 이상이면 1순위를 자동선택하지 않는다(null) — 오선택 방지(ADR-026)", () => {
    expect(
      autoPickCarrier([
        { id: "kr.logen", name: "로젠택배" },
        { id: "kr.cjlogistics", name: "CJ대한통운" },
      ]),
    ).toBeNull();
    expect(
      autoPickCarrier([
        { id: "kr.epost", name: "우체국택배" },
        { id: "kr.cjlogistics", name: "CJ대한통운" },
        { id: "kr.hanjin", name: "한진택배" },
      ]),
    ).toBeNull();
  });

  it("estimateCarriers 연동: 모호한 번호(11자리=후보 2개)는 자동선택되지 않는다", () => {
    expect(estimateCarriers("12345678901")).toHaveLength(2);
    expect(autoPickCarrier(estimateCarriers("12345678901"))).toBeNull();
  });

  it("estimateCarriers 연동: 무효 번호(후보 0개)도 자동선택되지 않는다", () => {
    expect(autoPickCarrier(estimateCarriers("123"))).toBeNull();
  });
});
