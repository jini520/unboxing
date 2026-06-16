import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { applySchema } from "../helpers";
import { call } from "./scenario";

// 외부(tracker.delivery) 실호출은 vitest.config.mts 의 outboundService 차단으로 막힌다.
// 즉시 1회 track 은 best-effort 라 차단돼도 등록은 진행된다(미등록 상태로 생성).

const DEVICE = "e2e-smoke-device";
const TOKEN = "ExponentPushToken[SMOKESMOKESMOKESMOKE00]";

describe("E2E 스모크 — 헬퍼·해피패스 토대 검증", () => {
  beforeEach(async () => {
    await applySchema(env.DB);
  });

  it("GET /health → 200 (헬퍼 동작 확인)", async () => {
    const res = await call("GET", "/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("해피패스: device 등록 → 송장 등록 → 목록 조회", async () => {
    // 앱이 실제로 하는 순서 그대로 — device 를 먼저 등록한다(지름길 INSERT 없음).
    const dev = await call("POST", "/devices", {
      deviceId: DEVICE,
      json: { push_token: TOKEN, platform: "ios" },
    });
    expect(dev.status).toBe(200);

    const created = await call("POST", "/shipments", {
      deviceId: DEVICE,
      json: { carrier: "kr.cjlogistics", tracking_no: "123456789012" },
    });
    expect(created.status).toBe(201);

    const list = await call("GET", "/shipments", { deviceId: DEVICE });
    expect(list.status).toBe(200);
    expect((list.body as { shipments: unknown[] }).shipments).toHaveLength(1);
  });
});
