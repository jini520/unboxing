import { describe, it, expect } from "@jest/globals";
import { resolveTokens, tokens } from "./tokens";

describe("resolveTokens", () => {
  it("고정 선호는 시스템과 무관하게 해당 토큰을 쓴다", () => {
    expect(resolveTokens("light", "dark")).toBe(tokens.light);
    expect(resolveTokens("dark", "light")).toBe(tokens.dark);
  });

  it("'system'이면 시스템 외형을 따른다", () => {
    expect(resolveTokens("system", "dark")).toBe(tokens.dark);
    expect(resolveTokens("system", "light")).toBe(tokens.light);
  });

  it("'system'이고 시스템 외형이 미확정이면 라이트 기준(ADR-016)", () => {
    expect(resolveTokens("system", null)).toBe(tokens.light);
    expect(resolveTokens("system", undefined)).toBe(tokens.light);
  });

  it("대표(브랜드) accent 토큰이 라이트/다크 모두 정의돼 있다", () => {
    expect(tokens.light.accent).toBe("#2563eb");
    expect(tokens.dark.accent).toBe("#3b82f6");
  });
});
