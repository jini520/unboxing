import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { applySchema, bearer } from "./helpers";
import { runPollingBatch, NOTIFICATION_DEVICE_CAP } from "../src/cron";

const BASE = "https://example.com";

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
  /** lastEvent.time 오버라이드(키 존재 시 사용; 미지정이면 NOW). null/빈문자열로 파싱불가 폴백 검증. */
  eventTime?: string | null;
}

interface FakeFetch {
  fetch: typeof fetch;
  graphqlCalls: number; // track(GraphQL) 호출 수 = 외부 subrequest(폴링)
  sendCalls: number; // Expo push/send 호출 수
  receiptsCalls: number; // Expo push/getReceipts 호출 수
  sentMessages: { to: string; body: string; data: { shipment_id: string } }[];
}

/** notifications 행(알림 기록, step1) — 컬럼 값 검증용. */
interface NotifRow {
  id: string;
  device_id: string;
  shipment_id: string | null;
  carrier: string;
  last4: string;
  body: string;
  stage: string;
  sent_at: number;
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
      const evTime = "eventTime" in opts ? opts.eventTime : new Date(NOW).toISOString();
      const mk = (code: string) => ({ time: evTime, status: { code }, description: "d" });
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
    statusChangedAt?: number | null;
  },
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO shipments (id, carrier, tracking_no, last_normalized_status, last_polled_at, active, created_at, status_changed_at) " +
      "VALUES (?, 'kr.cjlogistics', ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      o.trackingNo,
      o.status ?? null,
      o.lastPolledAt ?? null,
      o.active ?? 1,
      o.createdAt ?? NOW,
      o.statusChangedAt ?? null,
    )
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

async function statusChangedAtOf(id: string): Promise<number | null> {
  const r = await env.DB.prepare("SELECT status_changed_at AS s FROM shipments WHERE id = ?")
    .bind(id)
    .first<{ s: number | null }>();
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

  it("이동중 첫 진입 → 푸시 1회, 재관측(이동중→이동중)은 무발송(ADR-030)", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: "등록", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ trackStatus: "IN_TRANSIT" });

    // 등록 → 이동중: 첫 진입이라 1회 발송
    await runPollingBatch(env, { now: NOW, fetch: f.fetch });
    expect(f.sendCalls).toBe(1);
    expect(await statusOf("S")).toBe("이동중");

    // 이동중 → 이동중(터미널 입고→출고 재관측): 전환 아님 → 무발송(CAS 멱등).
    // 이동중 폴링 간격 240분 → 5h 뒤면 due 라 실제 재폴링하지만 단계 불변이라 발송 0.
    await runPollingBatch(env, { now: NOW + 5 * 60 * MINUTE, fetch: f.fetch });
    expect(f.sendCalls).toBe(1);
  });

  it("배송완료 전환 → 푸시 후 보관(active=0·재폴링 중단, 자동 삭제 아님)", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: "배송출발", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ trackStatus: "DELIVERED" });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    expect(f.sendCalls).toBe(1);
    expect(await statusOf("S")).toBe("배송완료"); // 보관됨(삭제 아님 — 사용자가 수동 삭제)
    expect(await count("SELECT COUNT(*) AS c FROM shipments WHERE id='S' AND active=0")).toBe(1); // 재폴링 중단
    expect(await count("SELECT COUNT(*) AS c FROM subscriptions")).toBe(1); // 구독 유지(좀비 아님)
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

  // ── status_changed_at(step0): 단계 전환 시각 기록(API 호출 시각 아님) ──

  it("단계 전환 시 status_changed_at 을 이벤트 시각으로 기록(now 아님)", async () => {
    const EVENT = NOW - 30 * MINUTE; // 이벤트 시각 ≠ now(NOW) — 구분 가능하게.
    await seedShipment("S", { trackingNo: "123456789012", status: "등록", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ trackStatus: "OUT_FOR_DELIVERY", eventTime: new Date(EVENT).toISOString() });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    expect(await statusOf("S")).toBe("배송출발");
    expect(await statusChangedAtOf("S")).toBe(EVENT); // 호출 시각(NOW)이 아니라 이벤트 시각
  });

  it("단계 변화 없는 반복 폴링은 status_changed_at 을 갱신하지 않음", async () => {
    const PRESET = NOW - 3 * 60 * MINUTE; // 기존 단계 시작 시각.
    await seedShipment("S", {
      trackingNo: "123456789012",
      status: "배송출발",
      lastPolledAt: NOW - 2 * 60 * MINUTE, // 간격(60분) 경과 → due
      statusChangedAt: PRESET,
    });
    const f = makeFetch({ trackStatus: "OUT_FOR_DELIVERY" }); // 동일 단계(배송출발) → CAS 0행

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    expect(f.graphqlCalls).toBe(1); // 폴링은 했지만
    expect(await statusChangedAtOf("S")).toBe(PRESET); // 단계 불변 → 그대로
  });

  it("이벤트 시각이 파싱불가면 status_changed_at 은 now 로 폴백", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: "등록", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    // 시각이 있긴 하나 파싱불가(Date.parse → NaN). (time 이 falsy 면 tracker 가 이벤트 자체를 버린다.)
    const f = makeFetch({ trackStatus: "OUT_FOR_DELIVERY", eventTime: "not-a-date" });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    expect(await statusOf("S")).toBe("배송출발");
    expect(await statusChangedAtOf("S")).toBe(NOW); // 폴백 = now
  });

  it("배송완료 전환에서도 status_changed_at 기록(이벤트 시각)", async () => {
    const EVENT = NOW - 10 * MINUTE;
    await seedShipment("S", { trackingNo: "123456789012", status: "배송출발", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ trackStatus: "DELIVERED", eventTime: new Date(EVENT).toISOString() });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    expect(await statusOf("S")).toBe("배송완료");
    expect(await count("SELECT COUNT(*) AS c FROM shipments WHERE id='S' AND active=0")).toBe(1);
    expect(await statusChangedAtOf("S")).toBe(EVENT); // 완료 전환도 이벤트 시각
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
    expect(await count("SELECT COUNT(*) AS c FROM shipments WHERE id='S' AND active=0")).toBe(1); // 완료 보관(재폴링 중단)
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

  // ── 음소거(step1, ADR-020): per-구독 알림 끄기 — 발송만 빠지고 추적은 계속 ──

  it("음소거된 구독은 전환 푸시 제외 — B만 발송, 단계 CAS는 1회", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: "등록", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    await seedSubscriber("dev-B", "ExponentPushToken[BBB]", "S");
    // A 만 음소거(구독 단위) — B 는 그대로.
    await env.DB.prepare(
      "UPDATE subscriptions SET muted = 1 WHERE device_id = 'dev-A' AND shipment_id = 'S'",
    ).run();
    const f = makeFetch({ trackStatus: "OUT_FOR_DELIVERY" });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    expect(await statusOf("S")).toBe("배송출발"); // 음소거여도 단계 추적은 계속(CAS 1회)
    expect(f.sendCalls).toBe(1);
    expect(f.sentMessages).toHaveLength(1); // B 에게만
    expect(f.sentMessages[0].to).toBe("ExponentPushToken[BBB]");
  });

  it("음소거 시 야간 보류분 정리 — 아침 플러시에서 음소거한 기기 제외", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: "등록", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    await seedSubscriber("dev-B", "ExponentPushToken[BBB]", "S");
    const f = makeFetch({ trackStatus: "OUT_FOR_DELIVERY" });

    // 야간 — 등록→배송출발(비긴급) → A·B 둘 다 보류 적재(음소거 전).
    await runPollingBatch(env, { now: NIGHT, fetch: f.fetch });
    expect(f.sendCalls).toBe(0);
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(2);

    // A 가 음소거(PATCH) → A 의 보류분이 함께 정리된다(아침 flushQueue 누락 방지).
    const patch = await SELF.fetch(`${BASE}/shipments/S`, {
      method: "PATCH",
      headers: { ...bearer("dev-A"), "Content-Type": "application/json" },
      body: JSON.stringify({ muted: true }),
    });
    expect(patch.status).toBe(204);
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(1); // A 보류분 제거, B 만 잔존

    // 아침(주간) 재실행 — 보류 큐 플러시. A 는 큐에서 빠졌고 재폴(동일 단계)도 무전환 → B 만 발송.
    await runPollingBatch(env, { now: NOW, fetch: f.fetch });
    expect(f.sendCalls).toBe(1);
    expect(f.sentMessages).toHaveLength(1);
    expect(f.sentMessages[0].to).toBe("ExponentPushToken[BBB]");
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(0);
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

  // ── 알림 기록(step1, ADR-023): 전환 푸시 fan-out 시점 1행 INSERT — 음소거 제외·멱등·best-effort ──

  async function notifs(deviceId?: string): Promise<NotifRow[]> {
    const sql = deviceId
      ? "SELECT * FROM notifications WHERE device_id = ? ORDER BY sent_at"
      : "SELECT * FROM notifications ORDER BY sent_at";
    const stmt = env.DB.prepare(sql);
    const { results } = await (deviceId ? stmt.bind(deviceId) : stmt).all<NotifRow>();
    return results;
  }

  it("전환 CAS 승리 → 구독 device 별 notifications 1행(컬럼 값)", async () => {
    await seedShipment("S", { trackingNo: "5220934513601234", status: "등록", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ trackStatus: "OUT_FOR_DELIVERY" });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    const rows = await notifs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      device_id: "dev-A",
      shipment_id: "S",
      carrier: "kr.cjlogistics", // carrierId 원문 저장(한글 변환은 앱, #9)
      last4: "1234",
      stage: "배송출발",
      sent_at: NOW,
    });
    expect(rows[0].body.length).toBeGreaterThan(0); // body = 발송 메시지 소스
    expect(rows[0].id.length).toBeGreaterThan(0); // UUID
  });

  it("음소거된 구독은 전환 푸시도·알림 기록도 없음(B 만 기록)", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: "등록", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    await seedSubscriber("dev-B", "ExponentPushToken[BBB]", "S");
    await env.DB.prepare(
      "UPDATE subscriptions SET muted = 1 WHERE device_id = 'dev-A' AND shipment_id = 'S'",
    ).run();
    const f = makeFetch({ trackStatus: "OUT_FOR_DELIVERY" });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    expect(await notifs("dev-A")).toHaveLength(0); // 음소거 → 기록 없음(ADR-020 일관)
    expect(await notifs("dev-B")).toHaveLength(1); // 발송된 구독만 기록
  });

  it("재독(전환 없음)은 기록 없음 — 등록→배송출발 1행, 동일 단계 재폴은 무중복(fan-out 1회)", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: "등록", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ trackStatus: "OUT_FOR_DELIVERY" });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });
    expect(await count("SELECT COUNT(*) AS c FROM notifications")).toBe(1);

    // 간격 지나 재폴 — 동일 단계(배송출발) → CAS 0행 → 발송도 기록도 없음(멱등).
    await runPollingBatch(env, { now: NOW + 61 * MINUTE, fetch: f.fetch });
    expect(f.sendCalls).toBe(1); // 발송 1회뿐
    expect(await count("SELECT COUNT(*) AS c FROM notifications")).toBe(1); // 기록도 1행뿐(중복 없음)
  });

  it("다중 구독 → device 별 1행씩", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: "등록", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    await seedSubscriber("dev-B", "ExponentPushToken[BBB]", "S");
    const f = makeFetch({ trackStatus: "OUT_FOR_DELIVERY" });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    expect(await count("SELECT COUNT(*) AS c FROM notifications")).toBe(2);
    expect(await notifs("dev-A")).toHaveLength(1);
    expect(await notifs("dev-B")).toHaveLength(1);
  });

  it("배송완료 전환도 기록(carrier=carrierId, stage=배송완료)", async () => {
    await seedShipment("S", { trackingNo: "5220934513601360", status: "배송출발", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ trackStatus: "DELIVERED" });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    const rows = await notifs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ device_id: "dev-A", shipment_id: "S", stage: "배송완료", last4: "1360" });
  });

  it("야간 비긴급 전환은 보류 → 즉시 미기록(기록은 flush 시점=step2)", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: "등록", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ trackStatus: "OUT_FOR_DELIVERY" });

    await runPollingBatch(env, { now: NIGHT, fetch: f.fetch });

    expect(f.sendCalls).toBe(0); // 보류
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(1);
    expect(await count("SELECT COUNT(*) AS c FROM notifications")).toBe(0); // 적재 시점엔 기록 안 함
  });

  it("best-effort(E12): notifications 기록 실패해도 발송·전환 CAS 는 진행", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: "등록", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    // 기록 INSERT 가 실패하도록 notifications 테이블 제거(주입 실패 시뮬).
    await env.DB.prepare("DROP TABLE notifications").run();
    const f = makeFetch({ trackStatus: "OUT_FOR_DELIVERY" });

    await runPollingBatch(env, { now: NOW, fetch: f.fetch }); // throw 없이 완료(best-effort)

    expect(f.sendCalls).toBe(1); // 발송은 그대로
    expect(await statusOf("S")).toBe("배송출발"); // 전환 CAS 도 그대로
  });

  // ── flush 시점 로깅(step2, ADR-023 보강②): 보류분은 받는 시점(flush)에 기록 ──

  it("조용시간 보류 → 적재 시 미기록, 주간 flush 시 1행(device_id=토큰 현재 소유자)", async () => {
    await seedShipment("S", { trackingNo: "5220934513601234", status: "등록", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ trackStatus: "OUT_FOR_DELIVERY" });

    // 야간 — 등록→배송출발(비긴급) 보류. 적재 시점엔 기록 안 함(수신 시점 기준).
    await runPollingBatch(env, { now: NIGHT, fetch: f.fetch });
    expect(f.sendCalls).toBe(0);
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(1);
    expect(await count("SELECT COUNT(*) AS c FROM notifications")).toBe(0);

    // 주간 — flush 발송 시점에 기록 1행. carrier=carrierId, last4, stage 스냅샷, sent_at=flush now.
    await runPollingBatch(env, { now: NOW, fetch: f.fetch });
    expect(f.sendCalls).toBe(1);
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(0);
    const rows = await notifs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      device_id: "dev-A",
      shipment_id: "S",
      carrier: "kr.cjlogistics",
      last4: "1234",
      stage: "배송출발",
      sent_at: NOW, // 적재(NIGHT) 가 아니라 flush(NOW) 시점
    });
    expect(rows[0].body.length).toBeGreaterThan(0);
  });

  it("token 양도분(steal 정리)은 flush·로깅 안 됨 — 큐·기록 모두 0", async () => {
    await seedShipment("S", { trackingNo: "123456789012", status: "등록", lastPolledAt: null });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ trackStatus: "OUT_FOR_DELIVERY" });

    // 야간 보류 적재(dev-A 토큰).
    await runPollingBatch(env, { now: NIGHT, fetch: f.fetch });
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(1);

    // 다른 기기(dev-B)가 같은 토큰을 등록 → steal → F3 가 옛 토큰의 보류분을 정리(교차 누설 방지).
    const reg = await SELF.fetch(`${BASE}/devices`, {
      method: "POST",
      headers: { ...bearer("dev-B"), "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "ios", push_token: "ExponentPushToken[AAA]" }),
    });
    expect(reg.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(0); // F3 정리

    // 주간 flush — 보류분이 없으니 발송·기록 모두 없음.
    await runPollingBatch(env, { now: NOW, fetch: f.fetch });
    expect(await count("SELECT COUNT(*) AS c FROM notifications")).toBe(0);
  });

  it("운영성 안내(분실 의심) 보류분은 flush 발송돼도 기록 안 함(전환 푸시만 기록·step1 일관)", async () => {
    // 30일 경과 미완료(이동중) → 야간 cron 에서 비활성(active=0) + '분실 의심'(비긴급) 보류.
    await seedShipment("S", {
      trackingNo: "123456789012",
      status: "이동중",
      lastPolledAt: null,
      createdAt: NIGHT - 31 * DAY,
    });
    await seedSubscriber("dev-A", "ExponentPushToken[AAA]", "S");
    const f = makeFetch({ trackStatus: "IN_TRANSIT" }); // 무전환 단계 → 전환 푸시 없음

    await runPollingBatch(env, { now: NIGHT, fetch: f.fetch });
    expect(await count("SELECT COUNT(*) AS c FROM shipments WHERE id='S' AND active=0")).toBe(1);
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(1); // 분실 의심 보류

    // 주간 flush — 안내는 발송되지만 active=0(운영성)이라 기록은 안 함.
    await runPollingBatch(env, { now: NOW, fetch: f.fetch });
    expect(f.sendCalls).toBe(1); // 분실 의심 발송됨
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(0);
    expect(await count("SELECT COUNT(*) AS c FROM notifications")).toBe(0); // 전환 푸시만 기록
  });

  // ── 보존 sweep(step2, ADR-023): 90일 경과 + 디바이스당 상한 ──

  /** notifications 행 직접 적재(sweep 검증용). */
  async function seedNotif(id: string, deviceId: string, sentAt: number): Promise<void> {
    await env.DB.prepare(
      "INSERT INTO notifications (id, device_id, shipment_id, carrier, last4, body, stage, sent_at) " +
        "VALUES (?, ?, NULL, 'kr.cjlogistics', '1234', 'b', '배송출발', ?)",
    )
      .bind(id, deviceId, sentAt)
      .run();
  }

  it("sweep: 90일 경과분 삭제, 90일 이내 보존(cron scheduled 경로에서 호출)", async () => {
    await seedNotif("old", "dev-A", NOW - 91 * DAY); // 90일 초과 → 삭제
    await seedNotif("recent", "dev-A", NOW - 89 * DAY); // 90일 이내 → 보존
    const f = makeFetch(); // due 송장 없음 → track 미호출

    await runPollingBatch(env, { now: NOW, fetch: f.fetch }); // 폴링 배치(=scheduled) 안에서 sweep 호출

    expect(await count("SELECT COUNT(*) AS c FROM notifications WHERE id='old'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS c FROM notifications WHERE id='recent'")).toBe(1);
  });

  it("sweep: 디바이스당 상한 초과 시 오래된 것부터 정리(다른 device 무영향)", async () => {
    const EXTRA = 3;
    const stmts = [];
    // dev-X: 상한+EXTRA 개(sent_at 으로 신·구 구분). 가장 오래된 EXTRA 개가 정리 대상.
    for (let i = 0; i < NOTIFICATION_DEVICE_CAP + EXTRA; i++) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO notifications (id, device_id, shipment_id, carrier, last4, body, stage, sent_at) " +
            "VALUES (?, 'dev-X', NULL, 'kr.cjlogistics', '1234', 'b', '배송출발', ?)",
        ).bind(`x${i}`, NOW - (NOTIFICATION_DEVICE_CAP + EXTRA - i) * MINUTE),
      );
    }
    // dev-Y: 상한 미만(2개) → 무영향.
    stmts.push(
      env.DB.prepare(
        "INSERT INTO notifications (id, device_id, shipment_id, carrier, last4, body, stage, sent_at) " +
          "VALUES ('y0', 'dev-Y', NULL, 'kr.cjlogistics', '1234', 'b', '배송출발', ?)",
      ).bind(NOW - 2 * MINUTE),
      env.DB.prepare(
        "INSERT INTO notifications (id, device_id, shipment_id, carrier, last4, body, stage, sent_at) " +
          "VALUES ('y1', 'dev-Y', NULL, 'kr.cjlogistics', '1234', 'b', '배송출발', ?)",
      ).bind(NOW - 1 * MINUTE),
    );
    await env.DB.batch(stmts);
    const f = makeFetch();

    await runPollingBatch(env, { now: NOW, fetch: f.fetch });

    // dev-X 는 최신 상한 개만 보존(가장 오래된 EXTRA 개 정리). 가장 오래된 'x0' 은 삭제, 'x{EXTRA}'~ 는 보존.
    expect(await count("SELECT COUNT(*) AS c FROM notifications WHERE device_id='dev-X'")).toBe(
      NOTIFICATION_DEVICE_CAP,
    );
    expect(await count("SELECT COUNT(*) AS c FROM notifications WHERE id='x0'")).toBe(0); // 최고령 정리
    expect(
      await count(`SELECT COUNT(*) AS c FROM notifications WHERE id='x${EXTRA}'`),
    ).toBe(1); // 경계(최신쪽) 보존
    expect(await count("SELECT COUNT(*) AS c FROM notifications WHERE device_id='dev-Y'")).toBe(2); // 무영향
  });
});
