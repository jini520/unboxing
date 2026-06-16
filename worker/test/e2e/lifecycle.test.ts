import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { applySchema } from "../helpers";
import { call } from "./scenario";
import { runPollingBatch } from "../../src/cron";

/**
 * 수명주기·삭제·개인정보 비영속 E2E — 앱이 하는 HTTP 순서(scenario.call)로 등록하고,
 * cron(runPollingBatch)은 now·fetch 주입으로 결정적으로 구동한다(DB 시드 지름길 없음).
 *
 * 다루는 사양:
 *  - 만료/좀비(ARCHITECTURE "데이터 수명주기 & 만료"): 미등록7일·예외7일 비활성, 30일 미완료 분실 알림(데모 제외).
 *  - 삭제 경로(ARCHITECTURE "HTTP API 계약" · ADR-017): DELETE /shipments/:id orphan 정리, DELETE /me 완전 폐기.
 *  - 개인정보 비영속(ADR-005/011 · CLAUDE.md CRITICAL): track 의 수령인/description/location 미저장, 타임라인 미저장.
 *
 * SQLi·로그 금지 정적 감사는 grep 으로 수행했고 결과는 docs/QA_FINDINGS.md "정적 감사 결과" 표에 기록한다
 * (워커 런타임에서 소스 파일을 읽을 수 없어 런타임 단언이 아니라 grep 감사 + 본 describe 말미 주석으로 남긴다).
 *
 * 발견한 갭은 verify 를 빨갛게 만들지 않는다: 사양 미충족은 현재 동작을 단언(재현)하고 it.todo("QA-NNN: …") + FINDINGS.
 */

const TOKEN_A = "ExponentPushToken[AAAAAAAAAAAAAAAAAAAAAA]";
const TOKEN_B = "ExponentPushToken[BBBBBBBBBBBBBBBBBBBBBB]";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * base(ms) 의 days 일 뒤를 **KST 정오(주간)** 로 스냅해 반환.
 * 단순히 base + days*DAY 를 쓰면 현재 시각의 시간대가 그대로 보존돼 CI 가 KST 야간에 돌면 now 도 야간이 된다 →
 * step3(조용시간)이 deliver 에 야간 보류를 붙이면 '안내 즉시 발송' 단언이 깨진다. now 를 항상 주간으로 고정한다.
 * 정오 스냅이 시각을 최대 12h 당길 수 있으므로(age 하한 = days−0.5일) days≥8 로 호출해 age ≥ 7일을 보장한다.
 */
function daytimeKstDaysLater(base: number, days: number): number {
  const kst = new Date(base + days * DAY + 9 * HOUR); // UTC 필드가 KST 벽시계
  kst.setUTCHours(12, 0, 0, 0); // KST 정오로 스냅
  return kst.getTime() - 9 * HOUR; // UTC epoch 로 환원
}

interface Fake {
  fetch: typeof fetch;
  status: string | null; // track lastEvent.status.code (null = 데이터 없음 = 미등록)
  description?: string; // 이벤트 설명(수령인 등 개인정보가 섞일 수 있는 필드)
  location?: string; // 허브명/위치
  graphqlCalls: number;
  sendCalls: number;
  receiptsCalls: number;
  sentMessages: { to: string; title: string; body: string; data: { shipment_id: string } }[];
}

/** 주입용 fake fetch — tracker(token·graphql)·Expo(send·getReceipts)를 URL 로 분기. */
function makeFetch(): Fake {
  const f: Fake = {
    fetch: undefined as unknown as typeof fetch,
    status: null,
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
      if (f.status == null) {
        return Response.json({ data: { track: { lastEvent: null, events: { edges: [] } } } });
      }
      const node = {
        time: new Date().toISOString(),
        status: { code: f.status },
        description: f.description,
        location: f.location,
      };
      return Response.json({ data: { track: { lastEvent: node, events: { edges: [{ node }] } } } });
    }
    if (url.includes("push/getReceipts")) {
      f.receiptsCalls++;
      return Response.json({ data: {} });
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
async function registerShipment(deviceId: string, trackingNo: string, carrier = "kr.cjlogistics"): Promise<string> {
  const res = await call("POST", "/shipments", { deviceId, json: { carrier, tracking_no: trackingNo } });
  expect(res.status).toBe(201);
  return (res.body as { shipment: { id: string } }).shipment.id;
}

async function rowOf(id: string): Promise<{ status: string | null; active: number } | null> {
  const r = await env.DB.prepare("SELECT last_normalized_status AS s, active AS a FROM shipments WHERE id = ?")
    .bind(id)
    .first<{ s: string | null; a: number }>();
  return r ? { status: r.s, active: r.a } : null;
}

async function count(sql: string): Promise<number> {
  const r = await env.DB.prepare(sql).first<{ c: number }>();
  return r?.c ?? 0;
}

/** D1 전 테이블을 덤프해 한 문자열로 — 개인정보 비영속 감사용(민감 문자열이 어디에도 없는지). */
async function dumpAllRows(): Promise<string> {
  const tables = ["shipments", "devices", "subscriptions", "push_tickets", "tracker_token"];
  const parts: string[] = [];
  for (const t of tables) {
    const { results } = await env.DB.prepare(`SELECT * FROM ${t}`).all(); // t 는 상수 화이트리스트(user-input 아님)
    parts.push(JSON.stringify(results));
  }
  return parts.join("\n");
}

describe("E2E 수명주기·삭제·개인정보 — 등록은 HTTP, 폴링은 주입 fetch/now", () => {
  beforeEach(async () => {
    await applySchema(env.DB);
  });

  // ── 1. 만료/좀비 (ARCHITECTURE "데이터 수명주기 & 만료") ──

  it("미등록 7일 → active=0 + '번호 확인' 안내 1회 (QA-007 — 재폴링 무재발송)", async () => {
    const base = Date.now();
    await registerDevice("dev-A", TOKEN_A);
    const id = await registerShipment("dev-A", "123456789012");
    const f = makeFetch();
    f.status = null; // 7일간 데이터 없음(미등록 유지)

    // now 는 주간(KST) 고정(daytimeKstDaysLater) — step3 조용시간이 deliver 에 붙어도 즉시 발송 단언 유지.
    // created_at(=base+ε) 기준 age ≥ 7일이라 lifecycle 이 미등록7일 비활성(+안내).
    await runPollingBatch(env, { now: daytimeKstDaysLater(base, 8), fetch: f.fetch });

    expect((await rowOf(id))?.active).toBe(0);
    // QA-007 수정: PRD 플로우6("7일 미수신 시 '번호 확인' 안내") — 비활성 시 안내 1회 발송.
    expect(f.sendCalls).toBe(1);
    expect(f.sentMessages).toHaveLength(1);
    expect(f.sentMessages[0].body).toContain("번호를 확인해 주세요");
    expect(f.sentMessages[0].data.shipment_id).toBe(id);

    // 비활성(active=0) 후엔 due 대상이 아님 → 재폴링해도 재발송 없음(멱등·과알림 방지).
    await runPollingBatch(env, { now: daytimeKstDaysLater(base, 9), fetch: f.fetch });
    expect(f.sendCalls).toBe(1);
  });

  it("예외 7일 → active=0 (전환 알림 1회 외 추가 안내 없음)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const id = await registerShipment("dev-A", "123456789012");
    const f = makeFetch();
    const base = Date.now();
    f.status = "EXCEPTION";

    // 1) 예외 전환 — 알림 1회.
    await runPollingBatch(env, { now: base, fetch: f.fetch });
    expect((await rowOf(id))?.status).toBe("예외");
    expect(f.sendCalls).toBe(1);

    // 2) 7일 경과 — 동일 단계(무전환) + lifecycle 예외7일 비활성. 추가 '안내'는 없다(QA-007 정책: 예외7일은
    //    이미 예외 푸시를 1회 받았으므로 재안내 생략 — 같은 예외 2회 알림 방지. 미등록7일만 '번호 확인' 안내).
    await runPollingBatch(env, { now: base + 7 * DAY, fetch: f.fetch });
    expect((await rowOf(id))?.active).toBe(0);
    expect(f.sendCalls).toBe(1);
  });

  it("등록 30일 경과(미완료·이동중) → active=0 + '분실 의심' 알림", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const id = await registerShipment("dev-A", "123456789012");
    const f = makeFetch();
    f.status = "IN_TRANSIT"; // 이동중(무알림 단계) — 30일 경과로 강제 비활성 + 분실 알림

    await runPollingBatch(env, { now: Date.now() + 30 * DAY, fetch: f.fetch });

    const r = await rowOf(id);
    expect(r?.active).toBe(0);
    // 이동중 전환은 무알림 → 발송된 1건은 '분실 의심' 알림뿐.
    expect(f.sendCalls).toBe(1);
    expect(f.sentMessages[0].body).toContain("오래 변동이 없어요");
    expect(f.sentMessages[0].data.shipment_id).toBe(id);
  });

  it("데모 운송장은 30일 경과해도 '분실 의심' 알림 제외(ADR-019)", async () => {
    const DEMO_NO = "999999999999";
    await registerDevice("dev-A", TOKEN_A);
    const id = await registerShipment("dev-A", DEMO_NO);
    const f = makeFetch();
    // 데모 번호면 cron track 이 캔드 결과(배송출발)를 반환 → 외부 호출 우회. DEMO_TRACKING_NUMBER 주입.
    const demoEnv = { ...env, DEMO_TRACKING_NUMBER: DEMO_NO } as typeof env;

    await runPollingBatch(demoEnv, { now: Date.now() + 30 * DAY, fetch: f.fetch });

    // 30일 경과로 비활성은 되지만, 데모 번호이므로 '분실 의심' 알림은 발송하지 않는다.
    expect((await rowOf(id))?.active).toBe(0);
    expect(f.sentMessages.every((m) => !m.body.includes("오래 변동이 없어요"))).toBe(true);
  });

  // ── 2. 삭제 경로 (ARCHITECTURE "HTTP API 계약" · ADR-017) ──

  it("DELETE /shipments/:id 마지막 구독 → orphan 송장 삭제, 재조회 빈 결과", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const id = await registerShipment("dev-A", "123456789012");

    const del = await call("DELETE", `/shipments/${id}`, { deviceId: "dev-A" });
    expect(del.status).toBe(204);
    expect(await count("SELECT COUNT(*) AS c FROM subscriptions")).toBe(0);
    expect(await count("SELECT COUNT(*) AS c FROM shipments")).toBe(0); // orphan 정리

    const list = await call("GET", "/shipments", { deviceId: "dev-A" });
    expect(list.status).toBe(200);
    expect((list.body as { shipments: unknown[] }).shipments).toHaveLength(0);
  });

  it("DELETE /shipments/:id — 다른 기기가 구독 중이면 송장 유지(orphan 아님)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerDevice("dev-B", TOKEN_B);
    const id = await registerShipment("dev-A", "111111111111"); // dedupe 공유 송장
    await registerShipment("dev-B", "111111111111");
    expect(await count("SELECT COUNT(*) AS c FROM shipments")).toBe(1);
    expect(await count("SELECT COUNT(*) AS c FROM subscriptions")).toBe(2);

    expect((await call("DELETE", `/shipments/${id}`, { deviceId: "dev-A" })).status).toBe(204);
    // dev-B 가 아직 구독 → 송장은 살아 있다(orphan 아님). dev-A 구독만 사라진다.
    expect(await count("SELECT COUNT(*) AS c FROM shipments")).toBe(1);
    expect(await count("SELECT COUNT(*) AS c FROM subscriptions")).toBe(1);
    expect(((await call("GET", "/shipments", { deviceId: "dev-A" })).body as { shipments: unknown[] }).shipments).toHaveLength(0);
    expect(((await call("GET", "/shipments", { deviceId: "dev-B" })).body as { shipments: unknown[] }).shipments).toHaveLength(1);
  });

  it("DELETE /me → device + 구독(CASCADE) + orphan 송장 + 푸시토큰 폐기, 이후 등록은 401", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerShipment("dev-A", "123456789012");
    await registerShipment("dev-A", "123456789013");

    const del = await call("DELETE", "/me", { deviceId: "dev-A" });
    expect(del.status).toBe(204);
    expect(await count("SELECT COUNT(*) AS c FROM devices")).toBe(0); // device + push_token 폐기
    expect(await count("SELECT COUNT(*) AS c FROM subscriptions")).toBe(0); // CASCADE
    expect(await count("SELECT COUNT(*) AS c FROM shipments")).toBe(0); // orphan 정리

    // 재조회 빈 결과(목록은 device 검사 안 함 → 200·빈 배열).
    const list = await call("GET", "/shipments", { deviceId: "dev-A" });
    expect((list.body as { shipments: unknown[] }).shipments).toHaveLength(0);
    // device 행이 사라졌으므로 같은 device_id 로 송장 등록은 401(기기 재등록 필요).
    const reAdd = await call("POST", "/shipments", {
      deviceId: "dev-A",
      json: { carrier: "kr.cjlogistics", tracking_no: "123456789012" },
    });
    expect(reAdd.status).toBe(401);
  });

  it("DELETE /me — 공유 송장은 타 기기를 위해 유지, 내 구독·전용 송장만 폐기", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerDevice("dev-B", TOKEN_B);
    await registerShipment("dev-A", "111111111111"); // 공유(dev-B 도 구독)
    await registerShipment("dev-B", "111111111111");
    const privA = await registerShipment("dev-A", "123456789012"); // dev-A 전용

    expect((await call("DELETE", "/me", { deviceId: "dev-A" })).status).toBe(204);
    expect(await count("SELECT COUNT(*) AS c FROM devices")).toBe(1); // dev-B 잔존
    // dev-A 전용 송장(privA)은 orphan → 삭제, 공유 송장은 dev-B 가 구독 → 유지.
    expect(await rowOf(privA)).toBe(null);
    expect(await count("SELECT COUNT(*) AS c FROM shipments")).toBe(1);
    expect(((await call("GET", "/shipments", { deviceId: "dev-B" })).body as { shipments: unknown[] }).shipments).toHaveLength(1);
  });

  // ── 3. 개인정보 비영속 (ADR-005/011 · CLAUDE.md CRITICAL) ──

  it("개인정보 비영속 — track 의 수령인/description/location 이 D1 어디에도 저장되지 않는다", async () => {
    await registerDevice("dev-A", TOKEN_A);
    const id = await registerShipment("dev-A", "123456789012");
    const f = makeFetch();
    f.status = "INFORMATION_RECEIVED";
    f.description = "홍길동 본인수령 서명완료"; // 수령인(개인정보)
    f.location = "서울 강남구 OO아파트 101동"; // 상세 위치(개인 식별 우려)

    await runPollingBatch(env, { now: Date.now(), fetch: f.fetch });
    expect((await rowOf(id))?.status).toBe("등록"); // 정규화 단계만 저장

    // 폴링은 status.code(정규화)만 쓰고 description/location/수령인은 읽지도 저장하지도 않는다(ADR-005).
    // 상세 타임라인은 GET /shipments/:id 가 실시간 조회로만 반환하고 미저장(ADR-011).
    const dump = await dumpAllRows();
    expect(dump).not.toContain("홍길동");
    expect(dump).not.toContain("본인수령");
    expect(dump).not.toContain("서울 강남");
    expect(dump).not.toContain("아파트");
  });

  // ── 4. 발견 갭 (todo + docs/QA_FINDINGS.md) ──

  it("[QA-008 재현] DELETE /me 후 push_tickets 에 push_token 잔존(즉시 완전 폐기 아님)", async () => {
    await registerDevice("dev-A", TOKEN_A);
    await registerShipment("dev-A", "123456789012");
    const f = makeFetch();
    f.status = "INFORMATION_RECEIVED";
    await runPollingBatch(env, { now: Date.now(), fetch: f.fetch }); // 등록 알림 → push_tickets 1행
    expect(await count("SELECT COUNT(*) AS c FROM push_tickets")).toBe(1);

    expect((await call("DELETE", "/me", { deviceId: "dev-A" })).status).toBe(204);
    expect(await count("SELECT COUNT(*) AS c FROM devices")).toBe(0); // 정규 토큰 저장소는 폐기
    // 기대(ADR-017): 푸시 토큰 완전 폐기. 현재: push_tickets 에 push_token 잔존(~15분 sweep 까지). QA-008.
    expect(await count("SELECT COUNT(*) AS c FROM push_tickets")).toBe(1);
  });

  // QA-007 수정 완료 → 위 "미등록 7일 → … '번호 확인' 안내 1회" 테스트가 긍정 단언으로 검증한다(예외7일은 정책상 안내 생략).
  // 사양(ADR-017 '푸시 토큰 폐기'): DELETE /me 시 push_tickets 의 잔존 push_token 도 즉시 폐기 — 현재 ~15분 sweep 까지 잔존.
  it.todo("QA-008: DELETE /me 시 push_tickets 의 잔존 push_token 도 즉시 폐기");

  // ── 정적 감사(grep) 결과 — docs/QA_FINDINGS.md "정적 감사 결과" 표 (워커 런타임에서 소스 미열람) ──
  //  · SQLi: worker/src 의 SQL ${} 보간은 상수 컬럼 헬퍼(shipmentCols)·'?' placeholder 뿐 — 값은 전부 .bind(). CLEAN.
  //  · 로그: worker console 은 cron.ts 1곳(carrier·failCount·error 만), app/src 0건 — device_id·push_token·tracking_no·수령인 미노출. CLEAN.
  //  · 비영속: shipments INSERT/UPDATE 는 정규화 단계·폴링 메타만 — description/location/수령인 컬럼 부재(위 E2E 가 런타임 재확인). CLEAN.
});
