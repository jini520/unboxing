import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { applySchema, bearer } from "./helpers";
import { runPollingBatch } from "../src/cron";

// HTTP API — GET /notifications · DELETE /me notifications 정리 · 삭제 시 보류 큐 정리 · 송장 삭제 SET NULL.
// 설계: docs/ARCHITECTURE.md "HTTP API 계약"/"엣지 케이스 알림", ADR-017/022/023, QA E-2·E10.

const BASE = "https://example.com";
const TOKEN_A = "ExponentPushToken[AAAAAAAAAAAAAAAAAAAAAA]";
const TOKEN_B = "ExponentPushToken[BBBBBBBBBBBBBBBBBBBBBB]";
const NOW = 1_700_017_200_000; // KST 2023-11-15 12:00
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface NotifResp {
  id: string;
  shipmentId: string | null;
  carrier: string;
  last4: string;
  body: string;
  stage: string;
  sentAt: number;
}

async function registerDevice(deviceId: string, token: string): Promise<void> {
  const res = await SELF.fetch(`${BASE}/devices`, {
    method: "POST",
    headers: { ...bearer(deviceId), "Content-Type": "application/json" },
    body: JSON.stringify({ push_token: token, platform: "ios" }),
  });
  expect(res.status).toBe(200);
}

async function createShipment(deviceId: string, trackingNo: string): Promise<string> {
  const res = await SELF.fetch(`${BASE}/shipments`, {
    method: "POST",
    headers: { ...bearer(deviceId), "Content-Type": "application/json" },
    body: JSON.stringify({ carrier: "kr.cjlogistics", tracking_no: trackingNo }),
  });
  expect([200, 201]).toContain(res.status);
  const { shipment } = (await res.json()) as { shipment: { id: string } };
  return shipment.id;
}

async function count(sql: string): Promise<number> {
  const r = await env.DB.prepare(sql).first<{ c: number }>();
  return r?.c ?? 0;
}

/** notifications 행 직접 적재(GET/DELETE/SET NULL 검증용 — cron 경유 없이). */
async function seedNotif(
  id: string,
  deviceId: string,
  o: { shipmentId?: string | null; sentAt: number; last4?: string; stage?: string; body?: string } ,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO notifications (id, device_id, shipment_id, carrier, last4, body, stage, sent_at) " +
      "VALUES (?, ?, ?, 'kr.cjlogistics', ?, ?, ?, ?)",
  )
    .bind(id, deviceId, o.shipmentId ?? null, o.last4 ?? "1234", o.body ?? "b", o.stage ?? "배송출발", o.sentAt)
    .run();
}

async function getNotifs(deviceId: string, query = ""): Promise<{ status: number; notifications: NotifResp[] }> {
  const res = await SELF.fetch(`${BASE}/notifications${query}`, { headers: bearer(deviceId) });
  if (res.status !== 200) return { status: res.status, notifications: [] };
  const body = (await res.json()) as { notifications: NotifResp[] };
  return { status: res.status, notifications: body.notifications };
}

/** cron 발송 검증용 최소 fake fetch(track 단계 주입·send 카운트). trackCode=null 이면 미등록. */
function makeSendFetch(trackCode: string | null = null) {
  const state = { sendCalls: 0, sentTo: [] as string[], fetch: undefined as unknown as typeof fetch };
  state.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("oauth2/token")) return Response.json({ access_token: "tok", expires_in: 3600 });
    if (url.includes("graphql")) {
      const ev =
        trackCode == null
          ? null
          : { time: new Date(NOW).toISOString(), status: { code: trackCode }, description: "d" };
      return Response.json({ data: { track: { lastEvent: ev, events: { edges: ev ? [{ node: ev }] : [] } } } });
    }
    if (url.includes("push/getReceipts")) return Response.json({ data: {} });
    if (url.includes("push/send")) {
      state.sendCalls++;
      const batch = JSON.parse(String(init?.body)) as { to: string }[];
      state.sentTo.push(...batch.map((m) => m.to));
      return Response.json({ data: batch.map((_, i) => ({ status: "ok", id: `tk-${state.sendCalls}-${i}` })) });
    }
    throw new Error(`unexpected url: ${url}`);
  }) as typeof fetch;
  return state;
}

describe("HTTP API — notifications", () => {
  beforeEach(async () => {
    await applySchema(env.DB);
  });

  // ── GET /notifications ──

  it("Bearer 없음 → 401", async () => {
    const res = await SELF.fetch(`${BASE}/notifications`);
    expect(res.status).toBe(401);
  });

  it("이 device_id 행만 반환(타 device 행 비노출 — E10 인가 경계)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerDevice("dev-B", TOKEN_B);
    await seedNotif("a1", "dev-A", { sentAt: NOW });
    await seedNotif("b1", "dev-B", { sentAt: NOW });

    const { status, notifications } = await getNotifs("dev-A");
    expect(status).toBe(200);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].id).toBe("a1");
  });

  it("sent_at DESC 정렬(최신 먼저)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await seedNotif("old", "dev-A", { sentAt: NOW - 2 * DAY });
    await seedNotif("mid", "dev-A", { sentAt: NOW - 1 * DAY });
    await seedNotif("new", "dev-A", { sentAt: NOW });

    const { notifications } = await getNotifs("dev-A");
    expect(notifications.map((n) => n.id)).toEqual(["new", "mid", "old"]);
  });

  it("denormalize 필드 + shipment_id NULL 행도 표시(딥링크만 비활성)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await seedNotif("n1", "dev-A", {
      shipmentId: null, // 정리된 송장 — shipmentId=null, 표시는 denormalize 로 유지
      sentAt: NOW,
      last4: "9876",
      stage: "배송완료",
      body: "배송 완료 ✓",
    });

    const { notifications } = await getNotifs("dev-A");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      id: "n1",
      shipmentId: null,
      carrier: "kr.cjlogistics",
      last4: "9876",
      body: "배송 완료 ✓",
      stage: "배송완료",
      sentAt: NOW,
    });
  });

  it("limit 적용(기본 100·상한 200)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    // 3건 적재 → ?limit=2 면 2건만.
    await seedNotif("n0", "dev-A", { sentAt: NOW - 2 * MINUTE });
    await seedNotif("n1", "dev-A", { sentAt: NOW - 1 * MINUTE });
    await seedNotif("n2", "dev-A", { sentAt: NOW });
    expect((await getNotifs("dev-A", "?limit=2")).notifications).toHaveLength(2);
    // limit 미지정 → 기본 100(3건 전부).
    expect((await getNotifs("dev-A")).notifications).toHaveLength(3);
  });

  it("limit 상한(200) 초과 요청은 200으로 클램프", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 201; i++) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO notifications (id, device_id, shipment_id, carrier, last4, body, stage, sent_at) " +
            "VALUES (?, 'dev-A', NULL, 'kr.cjlogistics', '1234', 'b', '배송출발', ?)",
        ).bind(`n${i}`, NOW - i * MINUTE),
      );
    }
    await env.DB.batch(stmts);
    expect((await getNotifs("dev-A", "?limit=1000")).notifications).toHaveLength(200);
  });

  // ── DELETE /me — notifications 함께 폐기 ──

  it("DELETE /me 가 이 기기 notifications 를 함께 폐기(device·구독·토큰과 batch)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerDevice("dev-B", TOKEN_B);
    await seedNotif("a1", "dev-A", { sentAt: NOW });
    await seedNotif("b1", "dev-B", { sentAt: NOW });

    const res = await SELF.fetch(`${BASE}/me`, { method: "DELETE", headers: bearer("dev-A") });
    expect(res.status).toBe(204);
    expect(await count("SELECT COUNT(*) AS c FROM notifications WHERE device_id='dev-A'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS c FROM notifications WHERE device_id='dev-B'")).toBe(1); // B 무영향
    expect(await count("SELECT COUNT(*) AS c FROM devices WHERE id='dev-A'")).toBe(0);
  });

  // ── 송장 삭제 → notifications.shipment_id SET NULL(행 보존·이력 유지) ──

  it("송장 행 삭제 → notifications.shipment_id NULL(행 삭제 아님·다른 컬럼 보존)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const id = await createShipment("dev-A", "123456789012");
    // 그 송장을 가리키는 알림 기록을 적재(발송 후 상태 모사).
    await seedNotif("n1", "dev-A", { shipmentId: id, sentAt: NOW, last4: "9012", stage: "배송완료" });

    // 마지막 구독 삭제 → orphan 송장 행 삭제 → FK ON DELETE SET NULL 발화.
    const del = await SELF.fetch(`${BASE}/shipments/${id}`, { method: "DELETE", headers: bearer("dev-A") });
    expect(del.status).toBe(204);
    expect(await count(`SELECT COUNT(*) AS c FROM shipments WHERE id='${id}'`)).toBe(0);

    // 알림 기록은 보존(삭제 아님) — shipment_id 만 NULL, 표시 필드는 그대로.
    const row = await env.DB.prepare(
      "SELECT shipment_id AS sid, last4, stage FROM notifications WHERE id='n1'",
    ).first<{ sid: string | null; last4: string; stage: string }>();
    expect(row).not.toBeNull();
    expect(row?.sid).toBeNull(); // SET NULL(딥링크만 무효)
    expect(row?.last4).toBe("9012"); // denormalize 표시 유지
    expect(row?.stage).toBe("배송완료");
  });

  // ── 삭제(구독 해제) 후 전환 푸시는 그 기기 제외(per-device 즉시 발송, ADR-030) ──

  it("DELETE /shipments/:id 후 전환 푸시는 삭제한 기기 제외 → 타 구독자만 즉시 발송", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerDevice("dev-B", TOKEN_B);
    const id = await createShipment("dev-A", "123456789012");
    await createShipment("dev-B", "123456789012"); // dedupe 동일 송장(구독 2개)
    // due 가 되게 단계 고정 + 미폴링(NULL) — cron 이 폴링해 전환을 일으키도록.
    await env.DB.prepare(
      "UPDATE shipments SET last_normalized_status='등록', last_polled_at=NULL WHERE id=?",
    )
      .bind(id)
      .run();

    // dev-A 가 삭제(휴지통으로) → 구독만 해제. 송장은 dev-B 구독이라 생존.
    const del = await SELF.fetch(`${BASE}/shipments/${id}`, { method: "DELETE", headers: bearer("dev-A") });
    expect(del.status).toBe(204);
    expect(await count("SELECT COUNT(*) AS c FROM shipments")).toBe(1); // 송장 생존(B 구독)

    // cron 전환(등록→배송출발) → 시각 무관 즉시 발송. 단 dev-A 는 구독 해제라 dev-B 만 받는다.
    const f = makeSendFetch("OUT_FOR_DELIVERY");
    await runPollingBatch(env, { now: NOW, fetch: f.fetch });
    expect(f.sentTo).toEqual([TOKEN_B]);
  });

  // ── 토큰 양도(재설치) E10 — notifications 는 device_id 키라 교차 누설 없음 ──

  it("토큰 양도(steal) — notifications 는 device_id 키라 새 기기로 누설되지 않음", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await seedNotif("a1", "dev-A", { sentAt: NOW });

    // 다른 기기(dev-B)가 같은 토큰을 등록(재설치/복원 모사) → push_token 은 dev-B 로 이동(steal).
    await registerDevice("dev-B", TOKEN_A);

    // dev-B 는 자기 알림 기록이 없다(토큰을 가져갔어도 dev-A 의 device_id 기록은 안 보임).
    expect((await getNotifs("dev-B")).notifications).toHaveLength(0);
    // dev-A 의 기록은 그대로(device_id 키라 토큰 이동과 무관).
    const a = (await getNotifs("dev-A")).notifications;
    expect(a).toHaveLength(1);
    expect(a[0].id).toBe("a1");
  });
});
