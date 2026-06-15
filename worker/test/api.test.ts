import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("HTTP API", () => {
  it("GET /health → 200 { ok: true }", async () => {
    const res = await SELF.fetch("https://example.com/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("알 수 없는 경로 → 404", async () => {
    const res = await SELF.fetch("https://example.com/nope");
    expect(res.status).toBe(404);
  });
});

describe("D1 바인딩", () => {
  it("테이블 생성·삽입·조회가 동작한다", async () => {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, name TEXT)",
    );
    await env.DB.prepare("INSERT INTO t (name) VALUES (?)").bind("unboxing").run();
    const row = await env.DB.prepare("SELECT name FROM t WHERE id = 1").first<{
      name: string;
    }>();
    expect(row?.name).toBe("unboxing");
  });
});
