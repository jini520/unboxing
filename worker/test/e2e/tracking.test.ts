import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { applySchema } from "../helpers";
import { call } from "./scenario";
import { runPollingBatch } from "../../src/cron";

/**
 * 추적·알림 cron 여정 E2E — 폴링→정규화→멱등 알림→완료 처리를 결정적으로 검증한다.
 *
 * 앱이 실제로 하는 등록 순서(POST /devices → POST /shipments)를 scenario.call 로 그대로 구동해
 * **등록 seam(미등록 → cron 첫 폴링이 단계를 처음 잡아 최초 알림)** 부터 끝까지 통합한다(DB 시드 지름길 없음).
 * cron 은 HTTP 엔드포인트가 아니므로 runPollingBatch(env, {now, fetch}) 로 구동하되 **now·fetch 를 주입**해
 * 결정적으로 만든다(실 tracker/Expo 호출 없음). now 는 등록 직후 Date.now() 를 base 로 잡아 created_at 과
 * 정합시킨다(lifecycle keep 보장). 단위·통합은 worker/test/cron.test.ts 가 DB 시드로 따로 커버한다.
 *
 * 발견한 갭은 verify 를 빨갛게 만들지 않는다: 사양 미충족은 it.todo("QA-NNN: …") + docs/QA.md.
 */

const TOKEN_A = "ExponentPushToken[AAAAAAAAAAAAAAAAAAAAAA]";
const HOUR = 3_600_000;
const MINUTE = 60_000;
const DAY = 24 * HOUR;

/**
 * base 를 KST 정오(주간)로 스냅 — 조용시간(step3, KST 22–08) 회피. 즉시 발송 단언의 결정성 확보
 * (실 벽시계 now 는 CI 가 야간에 돌면 비긴급 알림이 보류돼 flaky). age 는 base 와 같은 날이라 keep 범위.
 */
function daytime(base: number): number {
  const kst = new Date(base + 9 * HOUR);
  kst.setUTCHours(12, 0, 0, 0);
  return kst.getTime() - 9 * HOUR;
}
/** base 를 KST 02:00(야간/조용시간)로 스냅 — 보류 검증용. */
function nighttime(base: number): number {
  const kst = new Date(base + 9 * HOUR);
  kst.setUTCHours(2, 0, 0, 0);
  return kst.getTime() - 9 * HOUR;
}

/** 주입용 fake fetch — tracker(token·graphql)·Expo(send·getReceipts)를 URL 로 분기. 상태는 cron 실행 사이에 바꿀 수 있다. */
interface Fake {
  fetch: typeof fetch;
  // 가변 제어 — cron 실행 사이에 단계를 진행시킨다.
  status: string | null; // track lastEvent.status.code (null = 데이터 없음 = 미등록)
  eventTimeMs?: number; // lastEvent 시각(미지정 시 호출 시점). KST '오늘 도착' 분기 검증용.
  authError: boolean; // track 이 UNAUTHENTICATED 반환(자격증명 의심 → [ALERT] 백오프)
  receiptError?: string; // getReceipts 가 모든 ticket 에 대해 이 에러 반환(예: DeviceNotRegistered)
  // 계측
  graphqlCalls: number;
  sendCalls: number;
  receiptsCalls: number;
  sentMessages: { to: string; title: string; body: string; data: { shipment_id: string } }[];
}

function makeFetch(): Fake {
  const f: Fake = {
    fetch: undefined as unknown as typeof fetch,
    status: null,
    authError: false,
    graphqlCalls: 0,
    sendCalls: 0,
    receiptsCalls: 0,
    sentMessages: [],
  };
  f.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("oauth2/token")) {
      return Response.json({ access_token: "tok", expires_in: 3600 });
    }
    if (url.includes("graphql")) {
      f.graphqlCalls++;
      if (f.authError) {
        return Response.json({ errors: [{ message: "auth", extensions: { code: "UNAUTHENTICATED" } }] });
      }
      if (f.status == null) {
        return Response.json({ data: { track: { lastEvent: null, events: { edges: [] } } } });
      }
      const node = {
        time: new Date(f.eventTimeMs ?? Date.now()).toISOString(),
        status: { code: f.status },
        description: "d",
      };
      return Response.json({ data: { track: { lastEvent: node, events: { edges: [{ node }] } } } });
    }
    if (url.includes("push/getReceipts")) {
      f.receiptsCalls++;
      const { ids } = JSON.parse(String(init?.body)) as { ids: string[] };
      const data: Record<string, { status: string; details?: { error?: string } }> = {};
      if (f.receiptError) {
        for (const id of ids) data[id] = { status: "error", details: { error: f.receiptError } };
      }
      return Response.json({ data });
    }
    if (url.includes("push/send")) {
      f.sendCalls++;
      const batch = JSON.parse(String(init?.body)) as Fake["sentMessages"];
      f.sentMessages.push(...batch);
      return Response.json({ data: batch.map((_, i) => ({ status: "ok", id: `tk-${f.sendCalls}-${i}` })) });
    }
    throw new Error(`unexpected url: ${url}`);
  }) as typeof fetch;
  return f;
}

/** 앱이 하듯 device 를 HTTP(POST /devices)로 선등록 — DB 직접 INSERT(지름길) 금지. */
async function registerDevice(deviceId: string, token: string): Promise<void> {
  const res = await call("POST", "/devices", { deviceId, json: { push_token: token, platform: "ios" } });
  expect(res.status).toBe(200);
}

/** 앱이 하듯 송장을 HTTP(POST /shipments)로 등록 → id 반환. 즉시 1회 track 은 outbound 차단으로 미등록 생성. */
async function registerShipment(
  deviceId: string,
  trackingNo: string,
  carrier = "kr.cjlogistics",
): Promise<string> {
  const res = await call("POST", "/shipments", { deviceId, json: { carrier, tracking_no: trackingNo } });
  expect(res.status).toBe(201);
  return (res.body as { shipment: { id: string } }).shipment.id;
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

describe("E2E 추적·알림 cron 여정 — 등록은 HTTP, 폴링은 주입 fetch/now", () => {
  beforeEach(async () => {
    await applySchema(env.DB);
  });

  // ── 1. 단계 진행 + 멱등 알림 + 무알림 + 완료 삭제(좀비 없음) ──
  it("미등록→등록→집화→이동중→배송출발→배송완료: 알림 단계만 1회 발송·재폴링 무발송·완료 후 보관(active=0)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const id = await registerShipment("dev-A", "123456789012");
    const f = makeFetch();
    // base 는 주간(KST 정오) 고정 — 조용시간 보류로 단계별 발송 단언이 깨지지 않게(결정성). created_at 과 정합(lifecycle keep).
    // 단계 진행은 +1 DAY 로(모든 due 간격 충족 + KST 시각이 정오로 유지돼 항상 주간). 6일 진행이라 7일 만료엔 안 걸린다.
    let clock = daytime(Date.now());
    const run = () => runPollingBatch(env, { now: clock, fetch: f.fetch });

    // 데이터 없음(미등록) — 무알림, 단계 변화 없음(저장 NULL 유지).
    f.status = null;
    await run();
    expect(f.sendCalls).toBe(0);
    expect(await statusOf(id)).toBe(null);

    // 등록 — 폴링이 데이터를 '처음 잡은' 시점에 최초 알림.
    clock += DAY;
    f.status = "INFORMATION_RECEIVED";
    await run();
    expect(await statusOf(id)).toBe("등록");
    expect(f.sendCalls).toBe(1);

    // 집화 — 알림.
    clock += DAY;
    f.status = "AT_PICKUP";
    await run();
    expect(await statusOf(id)).toBe("집화");
    expect(f.sendCalls).toBe(2);

    // 이동중 — 첫 진입 알림(ADR-030). 터미널 입·출고 재관측은 같은 단계라 무발송(아래 배송출발 전 멱등).
    clock += DAY;
    f.status = "IN_TRANSIT";
    await run();
    expect(await statusOf(id)).toBe("이동중");
    expect(f.sendCalls).toBe(3);

    // 배송출발 — 알림.
    clock += DAY;
    f.status = "OUT_FOR_DELIVERY";
    await run();
    expect(await statusOf(id)).toBe("배송출발");
    expect(f.sendCalls).toBe(4);

    // 동일 단계 재폴링 — CAS 0행 → 멱등 무발송(알림 신뢰성 핵심).
    clock += DAY;
    await run();
    expect(await statusOf(id)).toBe("배송출발");
    expect(f.sendCalls).toBe(4);

    // 배송완료 — 알림 1회 후 보관(기본 사양: 자동 삭제 아님). active=0 으로 재폴링 중단, 사용자가 수동 삭제.
    clock += DAY;
    f.status = "DELIVERED";
    await run();
    expect(f.sendCalls).toBe(5);
    expect(await statusOf(id)).toBe("배송완료"); // 보관됨(삭제 아님)
    expect(await count("SELECT COUNT(*) AS c FROM shipments")).toBe(1);
    expect(await count("SELECT COUNT(*) AS c FROM shipments WHERE active = 0")).toBe(1); // 재폴링 중단
    expect(await count("SELECT COUNT(*) AS c FROM subscriptions")).toBe(1); // 구독 유지(좀비 아님)

    // 재실행 — active=0 이라 due 아님 → 재폴링·재발송 없음(멱등, 좀비 알림 없음).
    clock += DAY;
    await run();
    expect(f.sendCalls).toBe(5);
    expect(await statusOf(id)).toBe("배송완료");
  });

  it("기타(미매핑 status) 전환은 무알림(타임라인만)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const id = await registerShipment("dev-A", "123456789012");
    const f = makeFetch();
    f.status = "SOME_UNMAPPED_CODE";

    await runPollingBatch(env, { now: Date.now(), fetch: f.fetch });

    expect(await statusOf(id)).toBe("기타");
    expect(f.sendCalls).toBe(0);
  });

  // ── status_changed_at(step0): 전환 시 이벤트 시각으로 갱신(API 호출 시각 아님) ──
  it("status_changed_at 은 단계 전환 시 이벤트 시각으로 갱신된다", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const id = await registerShipment("dev-A", "123456789012");
    const f = makeFetch();
    const now = daytime(Date.now()); // 주간 고정(등록 즉시 발송)
    const eventTime = now - 30 * MINUTE; // 이벤트 시각 ≠ now
    f.status = "OUT_FOR_DELIVERY";
    f.eventTimeMs = eventTime;

    await runPollingBatch(env, { now, fetch: f.fetch });

    const r = await env.DB.prepare("SELECT status_changed_at AS s FROM shipments WHERE id = ?")
      .bind(id)
      .first<{ s: number }>();
    expect(r?.s).toBe(eventTime); // 호출 시각(now)이 아니라 이벤트 시각
  });

  // ── 2. 배송출발 KST '오늘 도착' 분기 ──
  it("배송출발 — 출발 이벤트가 KST 당일이면 '오늘 도착' 단정", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerShipment("dev-A", "123456789012");
    const now = daytime(Date.now()); // 주간 고정 — 배송출발(비긴급)이 야간 보류로 가려지지 않게
    const f = makeFetch();
    f.status = "OUT_FOR_DELIVERY";
    f.eventTimeMs = now; // 동일 시각 → 같은 KST 일자

    await runPollingBatch(env, { now, fetch: f.fetch });

    expect(f.sendCalls).toBe(1);
    expect(f.sentMessages[0].body).toContain("오늘 도착");
  });

  it("배송출발 — 출발 이벤트가 다른 날이면 '오늘 도착' 단정 안 함", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerShipment("dev-A", "123456789012");
    const now = daytime(Date.now()); // 주간 고정 — 배송출발(비긴급)이 야간 보류로 가려지지 않게
    const f = makeFetch();
    f.status = "OUT_FOR_DELIVERY";
    f.eventTimeMs = now - 2 * DAY; // 이틀 전 → 다른 KST 일자

    await runPollingBatch(env, { now, fetch: f.fetch });

    expect(f.sendCalls).toBe(1);
    expect(f.sentMessages[0].body).not.toContain("오늘 도착");
    expect(f.sentMessages[0].body).toContain("배송이 시작됐어요");
  });

  // ── 4. 외부 오류 → 선점 갱신 원복 + 백오프 + 자격증명 의심 [ALERT] 로깅 ──
  it("UNAUTHENTICATED 폴링 실패 → last_polled_at 원복·백오프·무발송 + [ALERT] 로깅", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const id = await registerShipment("dev-A", "123456789012"); // 등록 직후 last_polled_at = NULL
    const now = Date.now();
    const f = makeFetch();
    f.authError = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runPollingBatch(env, { now, fetch: f.fetch });

    // 자격증명 의심은 [ALERT] 태그로 로깅(ADR-013 21일 만료 감지). device_id/token 은 로그 금지.
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[ALERT]"), expect.anything());
    spy.mockRestore();

    const r = await env.DB.prepare(
      "SELECT last_polled_at AS p, fail_count AS fc, next_retry_at AS nr FROM shipments WHERE id = ?",
    )
      .bind(id)
      .first<{ p: number | null; fc: number; nr: number | null }>();
    expect(r?.p).toBe(null); // 선점 갱신 원복(원래 NULL) — 전체 간격 지연 방지
    expect(r?.fc).toBe(1); // 실패 카운트 증가
    expect(r?.nr).toBeGreaterThan(now); // 백오프 설정
    expect(f.sendCalls).toBe(0);
  });

  // ── 5. receipt sweep(ADR-010 2단계) ──
  it("발송 → ~15분 후 getReceipts 의 DeviceNotRegistered → 토큰·ticket 정리", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerShipment("dev-A", "123456789012");
    const f = makeFetch();
    const now = daytime(Date.now()); // 주간 고정 — 등록(비긴급) 즉시 발송이 야간 보류로 막히지 않게

    // 1) 단계 전환 발송으로 push_tickets 생성.
    f.status = "INFORMATION_RECEIVED";
    await runPollingBatch(env, { now, fetch: f.fetch });
    expect(f.sendCalls).toBe(1);
    expect(await count("SELECT COUNT(*) AS c FROM push_tickets")).toBe(1);

    // 2) 16분 후 — 송장은 아직 not-due(재폴링 없음), sweep 만 동작. 무효 토큰·ticket 정리.
    f.receiptError = "DeviceNotRegistered";
    await runPollingBatch(env, { now: now + 16 * MINUTE, fetch: f.fetch });
    expect(f.receiptsCalls).toBe(1);
    expect(f.sendCalls).toBe(1); // 재폴링 없음 → 재발송 없음
    expect(await count("SELECT COUNT(*) AS c FROM push_tickets")).toBe(0);
    expect(await count("SELECT COUNT(*) AS c FROM devices")).toBe(0); // DeviceNotRegistered 토큰 정리
  });

  // ── 6. due/청크 ──
  it("due 미달 — 방금 폴링한 송장은 같은 시각 재실행에서 재폴링 안 함", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerShipment("dev-A", "123456789012");
    const f = makeFetch();
    f.status = "IN_TRANSIT";
    const now = Date.now();

    await runPollingBatch(env, { now, fetch: f.fetch });
    expect(f.graphqlCalls).toBe(1);

    // 시간 안 지남 → isDue 거짓 → 재폴링 없음.
    await runPollingBatch(env, { now, fetch: f.fetch });
    expect(f.graphqlCalls).toBe(1);
  });

  it("청크 — due 51건이어도 1회 ≤50건만 외부 호출(나머지 1건 이월)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    for (let i = 0; i < 51; i++) {
      await registerShipment("dev-A", String(100000000000 + i));
    }
    const f = makeFetch();
    f.status = null; // 데이터 없음 → 미등록 유지(발송 없음)

    await runPollingBatch(env, { now: Date.now(), fetch: f.fetch });

    expect(f.graphqlCalls).toBe(50); // MAX_BATCH
    // 미처리 1건은 선점 갱신 안 됨(last_polled_at 여전히 NULL) → 다음 fire 이월.
    expect(await count("SELECT COUNT(*) AS c FROM shipments WHERE last_polled_at IS NULL")).toBe(1);
  });

  // ── QA-006/#9 수정: 푸시 title 이 친근한 한글 택배사명(carrierId 비노출) ──
  it("[#9] 푸시 title 에 한글 택배사명(CJ대한통운) — carrierId 비노출", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerShipment("dev-A", "123456789012");
    const f = makeFetch();
    f.status = "INFORMATION_RECEIVED";

    await runPollingBatch(env, { now: daytime(Date.now()), fetch: f.fetch }); // 주간 고정(등록 즉시 발송)

    expect(f.sentMessages).toHaveLength(1);
    // QA-006 수정: carrierId(kr.cjlogistics) 대신 한글명(CJ대한통운)을 노출한다.
    expect(f.sentMessages[0].title).toContain("CJ대한통운");
    expect(f.sentMessages[0].title).not.toContain("kr.cjlogistics");
  });

  // ── 조용시간 폐지(ADR-030): 야간에도 시각 무관 즉시 발송 ──
  it("야간 비긴급 전환도 즉시 발송(조용시간 폐지·큐 미적재)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const id = await registerShipment("dev-A", "123456789012");
    const f = makeFetch();

    // 야간(KST 02:00) 등록 전환 — 과거엔 보류였으나 이제 시각 무관 즉시 발송(ADR-030).
    f.status = "INFORMATION_RECEIVED";
    await runPollingBatch(env, { now: nighttime(Date.now()), fetch: f.fetch });
    expect(await statusOf(id)).toBe("등록");
    expect(f.sendCalls).toBe(1);
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(0); // 보류 큐 미사용
  });

  it("야간 긴급(예외) 전환도 즉시 발송", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const id = await registerShipment("dev-A", "123456789012");
    const f = makeFetch();
    f.status = "EXCEPTION";

    await runPollingBatch(env, { now: nighttime(Date.now()), fetch: f.fetch });

    expect(await statusOf(id)).toBe("예외");
    expect(f.sendCalls).toBe(1); // 야간에도 즉시
    expect(await count("SELECT COUNT(*) AS c FROM notification_queue")).toBe(0);
  });

  // ── 나머지 PRD 알림 정책 갭(미구현) — 발견·기록만(QA) ──
  // 사양(PRD UX·UI_GUIDE): 여러 송장 알림은 묶음/요약 — 미구현(개별 N건 발송).
  it.todo("QA-005: 알림 그룹화/요약이 없어 동시 전환 시 개별 푸시 N건 발송(과알림)");
  // 사양(PRD 마이크로카피): 사용자 노출 문구는 친근한 한글 택배사명(기술 id 비노출).
  it.todo("QA-006: 푸시 title 에 택배사 id 대신 친근한 한글 택배사명 표시");
});
