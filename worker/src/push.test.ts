import { describe, it, expect } from "vitest";
import {
  buildMessage,
  sendPush,
  getReceipts,
  classifyPushError,
  type PushMessage,
  type PushDeps,
} from "./push";

interface Call {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** 호출 URL·헤더·파싱된 바디를 기록하고, responder 가 만든 응답을 돌려주는 mock fetch. */
function recorder(responder: (url: string, body: any) => unknown): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, headers, body });
    return new Response(JSON.stringify(responder(url, body)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

function msg(i: number): PushMessage {
  return {
    to: `ExponentPushToken[${i}]`,
    title: "t",
    body: "b",
    data: { shipment_id: `s${i}` },
  };
}

const baseCtx = { token: "ExponentPushToken[x]", shipmentId: "abc", carrier: "CJ대한통운", last4: "1234" };

describe("buildMessage", () => {
  it("비알림 단계(이동중·기타·미등록)는 null", () => {
    expect(buildMessage("이동중", baseCtx)).toBeNull();
    expect(buildMessage("기타", baseCtx)).toBeNull();
    expect(buildMessage("미등록", baseCtx)).toBeNull();
  });

  it("알림 단계는 메시지 생성 + data.shipment_id 포함", () => {
    const m = buildMessage("배송완료", baseCtx);
    expect(m).not.toBeNull();
    expect(m!.data.shipment_id).toBe("abc");
    expect(m!.to).toBe("ExponentPushToken[x]");
    // title 에 택배사·끝4자리(어떤 택배인지)가 들어간다
    expect(m!.title).toContain("CJ대한통운");
    expect(m!.title).toContain("1234");
  });

  it("모든 알림 단계가 shipment_id 를 포함하고 body 가 비지 않는다", () => {
    for (const stage of ["등록", "집화", "배송출발", "배송완료", "예외"] as const) {
      const m = buildMessage(stage, baseCtx);
      expect(m, stage).not.toBeNull();
      expect(m!.data.shipment_id).toBe("abc");
      expect(m!.body.length).toBeGreaterThan(0);
      // payload body 는 4096B 한도 안
      expect(new TextEncoder().encode(m!.body).length).toBeLessThanOrEqual(4096);
    }
  });
});

describe("classifyPushError (전수)", () => {
  it("에러 코드 → 액션 매핑", () => {
    expect(classifyPushError("DeviceNotRegistered")).toBe("DELETE_TOKEN");
    expect(classifyPushError("MessageRateExceeded")).toBe("RETRY");
    expect(classifyPushError("MessageTooBig")).toBe("SHRINK");
    expect(classifyPushError("MismatchSenderId")).toBe("ALERT");
    expect(classifyPushError("InvalidCredentials")).toBe("ALERT");
    expect(classifyPushError("SomethingElse")).toBe("IGNORE");
    expect(classifyPushError(undefined)).toBe("IGNORE");
  });
});

describe("sendPush (배치 ≤100 분할 + 순서 보존)", () => {
  it("101개 → 2배치(100+1)로 분할, ticket 순서 = 입력 순서", async () => {
    // responder: 배치 순서대로 shipment_id 를 ticket id 로 echo
    const rec = recorder((_url, body: PushMessage[]) => ({
      data: body.map((m) => ({ status: "ok", id: m.data.shipment_id })),
    }));
    const messages = Array.from({ length: 101 }, (_, i) => msg(i));

    const tickets = await sendPush(messages, { fetch: rec.fetch });

    expect(rec.calls).toHaveLength(2);
    expect((rec.calls[0].body as unknown[]).length).toBe(100);
    expect((rec.calls[1].body as unknown[]).length).toBe(1);
    // 입력 순서 그대로
    expect(tickets).toHaveLength(101);
    expect(tickets.map((t) => t.id)).toEqual(messages.map((m) => m.data.shipment_id));
    // 모두 send 엔드포인트
    expect(rec.calls.every((c) => c.url.includes("/push/send"))).toBe(true);
  });

  it("EXPO_ACCESS_TOKEN 주입 시 Authorization 헤더 존재", async () => {
    const rec = recorder(() => ({ data: [{ status: "ok", id: "t" }] }));
    const deps: PushDeps = { fetch: rec.fetch, expoAccessToken: "secret-xyz" };

    await sendPush([msg(0)], deps);

    expect(rec.calls[0].headers.Authorization).toBe("Bearer secret-xyz");
  });

  it("EXPO_ACCESS_TOKEN 미주입 시 Authorization 헤더 부재", async () => {
    const rec = recorder(() => ({ data: [{ status: "ok", id: "t" }] }));

    await sendPush([msg(0)], { fetch: rec.fetch });

    expect(rec.calls[0].headers.Authorization).toBeUndefined();
  });
});

describe("getReceipts (배치 ≤1000 분할)", () => {
  it("1001개 → 2배치(1000+1)로 분할, 결과 병합", async () => {
    const rec = recorder((_url, body: { ids: string[] }) => ({
      data: Object.fromEntries(body.ids.map((id) => [id, { status: "ok" }])),
    }));
    const ids = Array.from({ length: 1001 }, (_, i) => `t${i}`);

    const receipts = await getReceipts(ids, { fetch: rec.fetch });

    expect(rec.calls).toHaveLength(2);
    expect((rec.calls[0].body as { ids: string[] }).ids.length).toBe(1000);
    expect((rec.calls[1].body as { ids: string[] }).ids.length).toBe(1);
    expect(Object.keys(receipts)).toHaveLength(1001);
    expect(receipts["t0"].status).toBe("ok");
    expect(rec.calls.every((c) => c.url.includes("/push/getReceipts"))).toBe(true);
  });
});
