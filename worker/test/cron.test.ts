import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { applySchema } from "./helpers";
import { runPollingBatch } from "../src/cron";

// cron 배치 폴링 통합 테스트 — now·fetch 주입으로 결정적.
// fakeFetch 가 tracker.delivery(token·graphql)와 Expo Push(send)를 URL로 분기해 응답한다.
// (실네트워크 호출 없음. outboundService 차단과 무관 — 주입 fetch를 직접 쓴다.)

// 고정 시계(epoch ms). 조용시간(step3, KST 22–08) 도입 후 발송 시각이 의미를 가지므로
// 즉시 발송 기준 NOW 는 **주간(KST 12:00)** 으로 둔다. 야간 보류 검증은 NIGHT(KST 07:13)을 쓴다.
const NOW = 1_700_017_200_000; // KST 2023-11-15 12:00 (주간 — 조용시간 아님)
const NIGHT = 1_700_000_000_000; // KST 2023-11-15 07:13 (야간/조용시간 — 보류 검증)
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface FakeOpts {
  /** track 의 lastEvent.status.code (null 이면 데이터 없음=미등록). */
  trackStatus?: string | null;
  /** track 의 lastEvent 를 null 로 두되 events 에는 이 코드를 채운다(lastEvent 누락 시 폴백 검증용). */
  eventsOnlyStatus?: string;
  /** track GraphQL 이 errors[] 를 반환(외부 오류 → 백오프 검증용). */
  trackError?: boolean;
  /** getReceipts 가 모든 ticket 에 대해 이 에러를 반환(예: DeviceNotRegistered). */
  receiptError?: string;
}

interface FakeFetch {
  fetch: typeof fetch;
  graphqlCalls: number; // track(GraphQL) 호출 수 = 외부 subrequest(폴링)
  sendCalls: number; // Expo push/send 호출 수
  receiptsCalls: number; // Expo push/getReceipts 호출 수
  sentMessages: { to: string; body: string; data: { shipment_id: string } }[];
}

function makeFetch(opts: FakeOpts = {}): FakeFetch {
  const state: FakeFetch = {
    graphqlCalls: 0,
    sendCalls: 0,
    receiptsCalls: 0,
    sentMessages: [],
    fetch: undefined as unknown as typeof fetch,
  };
  state.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("oauth2/token")) {
      return Response.json({ access_token: "tok", expires_in: 3600 });
    }
    if (url.includes("graphql")) {
      state.graphqlCalls++;
      if (opts.trackError) {
        return Response.json({ errors: [{ message: "boom", extensions: { code: "INTERNAL" } }] });
      }
      const mk = (code: string) => ({ time: new Date(NOW).toISOString(), status: { code }, description: "d" });
      if (opts.eventsOnlyStatus) {
        // lastEvent 는 null 이지만 events 에는 데이터가 있는 응답(폴백 경로 검증).
        return Response.json({
          data: { track: { lastEvent: null, events: { edges: [{ node: mk(opts.eventsOnlyStatus) }] } } },
        });
      }
      const code = opts.trackStatus;
      const event = code == null ? null : mk(code);
      return Response.json({
        data: { track: { lastEvent: event, events: { edges: event ? [{ node: event }] : [] } } },
      });
    }
    if (url.includes("push/getReceipts")) {
      state.receiptsCalls++;
      const { ids } = JSON.parse(String(init?.body)) as { ids: string[] };
      const data: Record<string, { status: string; details?: { error?: string } }> = {};
      if (opts.receiptError) {
        for (const id of ids) data[id] = { status: "error", details: { error: opts.receiptError } };
      }
      return Response.json({ data });
    }
    if (url.includes("push/send")) {
      state.sendCalls++;
      const batch = JSON.parse(String(init?.body)) as { to: string; body: string; data: { shipment_id: string } }[];
      state.sentMessages.push(...batch);
      return Response.json({ data: batch.map((_, i) => ({ status: "ok", id: `tk-${state.sendCalls}-${i}` })) });
    }
    throw new Error(`unexpected url: ${url}`);
  }) as typeof fetch;
  return state;
}

async function seedShipment(
  id: string,
  o: {
    trackingNo: string;
    status?: string | null;
    lastPolledAt?: number | null;
    createdAt?: number;
    active?: number;
  },
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO shipments (id, carrier, tracking_no, last_normalized_status, last_polled_at, active, created_at) " +
      "VALUES (?, 'kr.cjlogistics', ?, ?, ?, ?, ?)",
  )
    .bind(id, o.trackingNo, o.status ?? null, o.lastPolledAt ?? null, o.active ?? 1, o.createdAt ?? NOW)
    .run();
}

async function seedSubscriber(deviceId: string, token: string, shipmentId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO devices (id, push_token, platform, created_at) VALUES (?, ?, 'ios', ?)",
  )
    .bind(deviceId, token, NOW)
    .run();
  await env.DB.prepare(
    "INSERT INTO subscriptions (device_id, shipment_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(deviceId, shipmentId, NOW)
    .run();
}

async function statusOf(id: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT last_normalized_status AS s FROM shipments WHERE id = ?")
    .bind(id)
    .first<{ s: string | null }>();
  return r?.s ?? null;
}

async function count(sql: string): Promise<number> {
  const r = await env.DB.prepare(sql).first<{ c: number }>();
  return r?.c ?? 0;
}

describe("cron — 배치 폴링", () => {
  beforeEach(async () => {
    await applySchema(env.DB);
  });

  it("due 선택이 isDue 를 따른다(간격 미달은 폴링 안 함)", async () => {
    // '이동중' 간격 240분. 방금 폴링한 A 는 미due, 4h+ 지난 B 는 due.
    await seedShipment("A", { trackingNo: "111111111111", status: "이동중", lastPolledAt: NOW - 1000 });
    await seedShipment("B", { trackingNo: "222222222222", status: "이동중", lastPolledAt: NOW - 5 * 60 * MINUTE });
    const f = makeFetch({ trackStatus: "IN_TRANSIT" });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    expect(f.graphqlCalls).toBe(1); // B 만 폴링
    // B 는 선점 갱신, A 는 그대로.
    expect(await count("SELECT COUNT(*) AS c FROM shipments WHERE last_polled_at = " + NOW)).toBe(1);
    const a = await env.DB.prepare("SELECT last_polled_at AS p FROM shipments WHERE id='A'").first<{ p: number }>();
    expect(a?.p).toBe(NOW - 1000);
  });

  it("등록→배송출발 전환 시 발송, 재실행해도 재발송 없음(멱등)", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: "등록", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ trackStatus: "OUT_FOR_DELIVERY" });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });
    expect(f.sendCalls).toBe(1);
    expect(await statusOf("S")).toBe("배송출발");
    expect(await count("SELECT COUNT(*) AS c FROM push_tickets")).toBe(1);

    // 간격(60분) 지나 다시 due → 동일 상태면 CAS 0행 → 재발송 없음.
    await runPollingBatch(env, { now: NOW + 61 * MINUTE, fetch: f.fetch });
    expect(f.graphqlCalls).toBe(2); // 다시 폴링은 했지만
    expect(f.sendCalls).toBe(1); // 발송은 1회뿐
  });

  it("이동중 전환은 푸시 없음(타임라인만)", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: "등록", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ trackStatus: "IN_TRANSIT" });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    expect(f.sendCalls).toBe(0);
    expect(await statusOf("S")).toBe("이동중");
  });

  it("배송완료 전환 → 푸시 후 shipment 삭제(CASCADE)", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: "배송출발", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ trackStatus: "DELIVERED" });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    expect(f.sendCalls).toBe(1);
    expect(await count("SELECT COUNT(*) AS c FROM shipments WHERE id='S'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS c FROM subscriptions")).toBe(0); // CASCADE
  });

  it("등록 후 30일 경과(미완료) → active=0", async () => {
    await seedShipment("S", {
      trackingNo: "123456789012",
      status: "이동중",
      lastPolledAt: null,
      createdAt: NOW - 31 * DAY,
    });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ trackStatus: "IN_TRANSIT" }); // 단계 불변(이동중)

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    const r = await env.DB.prepare("SELECT active AS a FROM shipments WHERE id='S'").first<{ a: number }>();
    expect(r?.a).toBe(0);
  });

  it("due 50건 초과 시 한 번에 ≤50건만 외부 호출(이월)", async () => {
    for (let i = 0; i < 55; i++) {
      await seedShipment(`S${i}`, { trackingNo: String(100000000000 + i), status: null, lastPolledAt: null });
    }
    const f = makeFetch({ trackStatus: null }); // 데이터 없음(미등록 유지)

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    expect(f.graphqlCalls).toBe(50);
    // 미처리 5건은 선점 갱신 안 됨(last_polled_at 여전히 null).
    expect(await count("SELECT COUNT(*) AS c FROM shipments WHERE last_polled_at IS NULL")).toBe(5);
  });

  it("폴링 실패 → last_polled_at 원복 + 백오프(다음 fire 재시도)", async () => {
    // 선점 갱신 후 외부 오류면 last_polled_at 을 원래대로 되돌려 전체 간격 지연을 막고 next_retry_at 으로 백오프.
    const prevPoll = NOW - 2 * 60 * MINUTE;
    await seedShipment("S", { trackingNo: "123456789012", status: "배송출발", lastPolledAt: prevPoll });
    const f = makeFetch({ trackError: true });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    const r = await env.DB.prepare(
      "SELECT last_polled_at AS p, fail_count AS fc, next_retry_at AS nr FROM shipments WHERE id='S'",
    ).first<{ p: number; fc: number; nr: number }>();
    expect(r?.p).toBe(prevPoll); // 선점 갱신 원복
    expect(r?.fc).toBe(1); // 실패 카운트 증가
    expect(r?.nr).toBeGreaterThan(NOW); // 백오프 설정
  });

  it("lastEvent 누락 시 events 최신값으로 폴백(미등록 회귀 방지)", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: null, lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ eventsOnlyStatus: "INFORMATION_RECEIVED" });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    expect(await statusOf("S")).toBe("등록"); // 미등록으로 회귀하지 않음
    expect(f.sendCalls).toBe(1);
  });

  it("receipt sweep: DeviceNotRegistered → 토큰·ticket 정리", async () => {
    // 15분 지난 ticket + 해당 device 시드(폴링할 송장은 없음 → sweep만 동작).
    await env.DB.prepare(
      "INSERT INTO devices (id, push_token, platform, created_at) VALUES ('d1','ExponentPushToken[BBB]','ios',?)",
    )
      .bind(NOW)
      .run();
    await env.DB.prepare(
      "INSERT INTO push_tickets (ticket_id, push_token, created_at) VALUES ('tk1','ExponentPushToken[BBB]',?)",
    )
      .bind(NOW - 20 * MINUTE)
      .run();
    const f = makeFetch({ receiptError: "DeviceNotRegistered" });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    expect(f.receiptsCalls).toBe(1);
    expect(await count("SELECT COUNT(*) AS c FROM devices WHERE push_token='ExponentPushToken[BBB]'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS c FROM push_tickets")).toBe(0);
  });

  // ── 조용시간(step3, #7/QA-004): 야간 비긴급 보류 → 아침 묶음 발송 ──

  it("야간 비긴급 전환은 보류(즉시 발송 0·큐 1), 주간 재실행이 플러시", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: "등록", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ trackStatus: "OUT_FOR_DELIVERY" });

    // 야간(NIGHT) — 등록→배송출발(비긴급) → 보류. CAS 는 즉시 적용(보류는 발송 시점만 미룸).
    await runPollingBatch(env, { now: NIGHT, fetch: f.fetch });
    expect(f.sendCalls).toBe(0);
    expect(await statusOf("S")).toBe("배송출발");
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(1);

    // 주간(NOW) — 재폴(동일 단계, 무전환) + 보류 큐 플러시로 발송 후 큐 비움.
    await runPollingBatch(env, { now: NOW, fetch: f.fetch });
    expect(f.sendCalls).toBe(1);
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(0);
  });

  it("야간 긴급(배송완료) 전환은 보류 없이 즉시 발송", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: "배송출발", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ trackStatus: "DELIVERED" });

    await runPollingBatch(env, { now: NIGHT, fetch: f.fetch });

    expect(f.sendCalls).toBe(1); // 긴급 → 야간에도 즉시
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(0);
    expect(await count("SELECT COUNT(*) AS c FROM shipments WHERE id='S'")).toBe(0); // 완료 삭제
  });

  it("collapse: 한 송장 다중 보류 → 아침 플러시 시 최신 1건만 발송", async () => {
    // 송장은 not-due(방금 폴링) → 재폴 없음. 야간 보류 3건을 직접 적재해 collapse 만 검증.
    await seedShipment("S", { trackingNo: "123456789012", status: "배송출발", lastPolledAt: NOW });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const bodies = ["등록 접수", "집화 수거", "배송출발 시작"];
    for (let i = 0; i < bodies.length; i++) {
      await env.DB.prepare(
        "INSERT INTO notification_queue (id, shipment_id, push_token, title, body, created_at) " +
          "VALUES (?, 'S', 'ExponentPushToken[AAA]', 't', ?, ?)",
      )
        .bind(`q${i}`, bodies[i], NOW - (bodies.length - i) * MINUTE)
        .run();
    }
    const f = makeFetch({ trackStatus: "OUT_FOR_DELIVERY" });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch }); // 주간 → 플러시

    expect(f.graphqlCalls).toBe(0); // not-due → 재폴 없음
    expect(f.sendCalls).toBe(1); // collapse → 1건만(과알림 방지)
    expect(f.sentMessages).toHaveLength(1);
    expect(f.sentMessages[0].body).toBe("배송출발 시작"); // 최신(created_at 최대)
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(0); // 버린 보류분 포함 전체 삭제
  });

  it("보류분의 송장 삭제 시 FK CASCADE 로 큐 행도 정리(죽은 토큰 발송 방지)", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: "등록", lastPolledAt: NOW });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    await env.DB.prepare(
      "INSERT INTO notification_queue (id, shipment_id, push_token, title, body, created_at) " +
        "VALUES ('q0', 'S', 'ExponentPushToken[AAA]', 't', 'b', ?)",
    )
      .bind(NOW)
      .run();
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(1);

    await env.DB.prepare("DELETE FROM shipments WHERE id = 'S'").run();
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(0); // CASCADE
  });
});
