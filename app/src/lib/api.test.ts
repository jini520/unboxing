import { describe, it, expect } from "@jest/globals";
import {
  ensureDevice,
  registerDevice,
  createShipment,
  listShipments,
  listNotifications,
  getShipment,
  deleteShipment,
  deleteMe,
  muteShipment,
  ApiError,
  type ApiDeps,
} from "./api";

const DEVICE_ID = "test-device-id";
const BASE = "https://api.test";

interface Call {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string };
}

/** Response 유사 객체(전역 Response 비의존). 204 등 본문 없음은 json 호출 안 함. */
function res(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** 주입 fetch — 호출 인자를 기록하고 지정 응답을 반환. */
function mockFetch(response: Response) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: Call["init"]) => {
    calls.push({ url, init });
    return response;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function deps(response: Response): ApiDeps & { calls: Call[] } {
  const { fetch, calls } = mockFetch(response);
  return { fetch, getDeviceId: async () => DEVICE_ID, baseUrl: BASE, calls };
}

const rawShipment = {
  id: "ship-1",
  carrier: "kr.cjlogistics",
  tracking_no: "123456789012",
  status: "배송출발",
  active: true,
  created_at: 1700000000000,
};

describe("Bearer 인증 (모든 요청)", () => {
  it("Authorization: Bearer <device_id> 헤더를 붙인다", async () => {
    const d = deps(res(200, { shipments: [] }));
    await listShipments(d);
    expect(d.calls[0].init.headers?.Authorization).toBe(`Bearer ${DEVICE_ID}`);
    expect(d.calls[0].init.headers?.["Content-Type"]).toBe("application/json");
  });

  it("device_id 를 URL/쿼리스트링에 넣지 않는다", async () => {
    const d = deps(res(200, { shipments: [] }));
    await listShipments(d);
    expect(d.calls[0].url).not.toContain(DEVICE_ID);
  });
});

describe("getShipment — 방어", () => {
  it("timeline 누락(upstream 실패 시 서버가 생략) → 빈 타임라인으로 안전 처리", async () => {
    const d = deps(res(200, { shipment: rawShipment })); // timeline 필드 없음
    const { timeline } = await getShipment("ship-1", d);
    expect(timeline).toEqual([]);
  });
});

describe("ensureDevice", () => {
  it("POST /devices · body{platform} 만(push_token 없음) · Bearer 부착", async () => {
    const d = deps(res(200, { device_id: DEVICE_ID }));
    await ensureDevice("ios", d);
    expect(d.calls[0].url).toBe(`${BASE}/devices`);
    expect(d.calls[0].init.method).toBe("POST");
    // 토큰 없이 platform 만 — 푸시 거부/미허용도 기기 등록(QA-001).
    expect(JSON.parse(d.calls[0].init.body as string)).toEqual({ platform: "ios" });
    expect(d.calls[0].init.headers?.Authorization).toBe(`Bearer ${DEVICE_ID}`);
  });
});

describe("registerDevice", () => {
  it("POST /devices · body{push_token,platform} · {deviceId} 반환", async () => {
    const d = deps(res(200, { device_id: DEVICE_ID }));
    const out = await registerDevice("ExponentPushToken[abc]", "ios", d);
    expect(d.calls[0].url).toBe(`${BASE}/devices`);
    expect(d.calls[0].init.method).toBe("POST");
    expect(JSON.parse(d.calls[0].init.body as string)).toEqual({
      push_token: "ExponentPushToken[abc]",
      platform: "ios",
    });
    expect(out).toEqual({ deviceId: DEVICE_ID });
  });
});

describe("createShipment", () => {
  it("POST /shipments · body{carrier,tracking_no} · snake→camel 매핑", async () => {
    const d = deps(res(201, { shipment: rawShipment }));
    const out = await createShipment("kr.cjlogistics", "123456789012", d);
    expect(d.calls[0].url).toBe(`${BASE}/shipments`);
    expect(d.calls[0].init.method).toBe("POST");
    expect(JSON.parse(d.calls[0].init.body as string)).toEqual({
      carrier: "kr.cjlogistics",
      tracking_no: "123456789012",
    });
    expect(out.shipment).toEqual({
      id: "ship-1",
      carrier: "kr.cjlogistics",
      trackingNo: "123456789012",
      status: "배송출발",
      active: true,
      createdAt: 1700000000000,
      // 필드 누락 폴백: statusChangedAt=createdAt, muted=false.
      statusChangedAt: 1700000000000,
      muted: false,
    });
  });

  it("201 → created:true (신규)", async () => {
    const d = deps(res(201, { shipment: rawShipment }));
    const out = await createShipment("kr.cjlogistics", "123456789012", d);
    expect(out.created).toBe(true);
  });

  it("200 → created:false (멱등 — 이미 구독)", async () => {
    const d = deps(res(200, { shipment: rawShipment }));
    const out = await createShipment("kr.cjlogistics", "123456789012", d);
    expect(out.created).toBe(false);
  });
});

describe("listShipments", () => {
  it("GET /shipments · 배열 매핑", async () => {
    const d = deps(res(200, { shipments: [rawShipment] }));
    const out = await listShipments(d);
    expect(d.calls[0].url).toBe(`${BASE}/shipments`);
    expect(d.calls[0].init.method).toBe("GET");
    expect(out).toHaveLength(1);
    expect(out[0].trackingNo).toBe("123456789012");
  });
});

describe("listNotifications", () => {
  const notif = {
    id: "n1",
    shipmentId: "ship-1",
    carrier: "kr.cjlogistics",
    last4: "9012",
    body: "배송 완료 ✓",
    stage: "배송완료",
    sentAt: 1700000000000,
  };

  it("GET /notifications · 서버 camelCase 응답 그대로 반환", async () => {
    const d = deps(res(200, { notifications: [notif] }));
    const out = await listNotifications(d);
    expect(d.calls[0].url).toBe(`${BASE}/notifications`);
    expect(d.calls[0].init.method).toBe("GET");
    expect(out).toEqual([notif]);
  });

  it("limit 지정 시 ?limit= 쿼리스트링 부착", async () => {
    const d = deps(res(200, { notifications: [] }));
    await listNotifications(d, 50);
    expect(d.calls[0].url).toBe(`${BASE}/notifications?limit=50`);
  });
});

describe("getShipment", () => {
  it("GET /shipments/:id · shipment + timeline(time/description/location)", async () => {
    const d = deps(
      res(200, {
        shipment: rawShipment,
        timeline: [
          { time: "2026-06-16T10:00:00+09:00", status: "배송출발", description: "출발", location: "서울" },
        ],
      }),
    );
    const out = await getShipment("ship-1", d);
    expect(d.calls[0].url).toBe(`${BASE}/shipments/ship-1`);
    expect(d.calls[0].init.method).toBe("GET");
    expect(out.shipment.id).toBe("ship-1");
    expect(out.timeline).toEqual([
      { time: "2026-06-16T10:00:00+09:00", description: "출발", location: "서울" },
    ]);
  });
});

describe("phase 05 필드 매핑 (status_changed_at·muted·recipient)", () => {
  it("status_changed_at·muted 가 있으면 그대로 매핑한다", async () => {
    const d = deps(
      res(200, {
        shipments: [{ ...rawShipment, status_changed_at: 1700000111111, muted: true }],
      }),
    );
    const out = await listShipments(d);
    expect(out[0].statusChangedAt).toBe(1700000111111);
    expect(out[0].muted).toBe(true);
  });

  it("status_changed_at 누락 → createdAt 폴백, muted 누락 → false (구버전 서버)", async () => {
    const d = deps(res(200, { shipments: [rawShipment] }));
    const out = await listShipments(d);
    expect(out[0].statusChangedAt).toBe(rawShipment.created_at);
    expect(out[0].muted).toBe(false);
  });

  it("getShipment: recipient{name,regionName} 패스스루", async () => {
    const d = deps(
      res(200, { shipment: rawShipment, recipient: { name: "홍**", regionName: "서울 강남" } }),
    );
    const out = await getShipment("ship-1", d);
    expect(out.recipient).toEqual({ name: "홍**", regionName: "서울 강남" });
  });

  it("getShipment: recipient 누락/null → null(앱이 섹션 숨김)", async () => {
    const d = deps(res(200, { shipment: rawShipment }));
    const out = await getShipment("ship-1", d);
    expect(out.recipient).toBeNull();
  });
});

describe("muteShipment", () => {
  it("PATCH /shipments/:id · body{muted} · 204", async () => {
    const d = deps(res(204));
    await expect(muteShipment("ship-1", true, d)).resolves.toBeUndefined();
    expect(d.calls[0].url).toBe(`${BASE}/shipments/ship-1`);
    expect(d.calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(d.calls[0].init.body as string)).toEqual({ muted: true });
  });
});

describe("deleteShipment / deleteMe", () => {
  it("DELETE /shipments/:id (204)", async () => {
    const d = deps(res(204));
    await expect(deleteShipment("ship-1", d)).resolves.toBeUndefined();
    expect(d.calls[0].url).toBe(`${BASE}/shipments/ship-1`);
    expect(d.calls[0].init.method).toBe("DELETE");
  });

  it("DELETE /me (204)", async () => {
    const d = deps(res(204));
    await expect(deleteMe(d)).resolves.toBeUndefined();
    expect(d.calls[0].url).toBe(`${BASE}/me`);
    expect(d.calls[0].init.method).toBe("DELETE");
  });
});

describe("에러 정규화", () => {
  it("비-2xx {error,code} → ApiError (code·status 보존)", async () => {
    const d = deps(res(422, { error: "운송장 번호 형식이 올바르지 않아요", code: "INVALID_TRACKING" }));
    await expect(createShipment("kr.cjlogistics", "123", d)).rejects.toMatchObject({
      code: "INVALID_TRACKING",
      status: 422,
    });
  });

  it("본문 없는 비-2xx → ApiError(status 보존, 폴백 code)", async () => {
    const d = deps(res(500));
    const err = await listShipments(d).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
  });

  it("네트워크 throw → ApiError(code:'NETWORK')", async () => {
    const fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof globalThis.fetch;
    const d: ApiDeps = { fetch, getDeviceId: async () => DEVICE_ID, baseUrl: BASE };
    await expect(listShipments(d)).rejects.toMatchObject({ code: "NETWORK" });
  });
});
