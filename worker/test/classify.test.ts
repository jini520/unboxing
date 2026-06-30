import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { bearer } from "./helpers";

/**
 * POST /classify-purchase 통합 — **인증·입력 검증 경로만**(env.AI.run 미도달).
 * 실제 AI 호출(성공 응답·503 폴백)은 외부 경계라 step 4 실호출 스모크로 검증(mock verify 가 못 잡음, ADR-037·ENGINEERING).
 */
describe("POST /classify-purchase — 인증·검증", () => {
  const url = "https://example.com/classify-purchase";

  it("Bearer 없으면 401", async () => {
    const res = await SELF.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "결제금액 1000원" }),
    });
    expect(res.status).toBe(401);
  });

  it("text 누락 → 400 INVALID_BODY", async () => {
    const res = await SELF.fetch(url, {
      method: "POST",
      headers: { ...bearer("dev-classify-1"), "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("INVALID_BODY");
  });

  it("빈/공백 text → 400", async () => {
    const res = await SELF.fetch(url, {
      method: "POST",
      headers: { ...bearer("dev-classify-2"), "content-type": "application/json" },
      body: JSON.stringify({ text: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("과대 text(상한 초과) → 400", async () => {
    const res = await SELF.fetch(url, {
      method: "POST",
      headers: { ...bearer("dev-classify-3"), "content-type": "application/json" },
      body: JSON.stringify({ text: "가".repeat(5000) }),
    });
    expect(res.status).toBe(400);
  });

  it("GET 은 라우팅되지 않음(404)", async () => {
    const res = await SELF.fetch(url, { method: "GET", headers: bearer("dev-classify-4") });
    expect(res.status).toBe(404);
  });
});
