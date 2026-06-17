/**
 * unboxing Worker
 *  - fetch:     Expo 앱용 HTTP API (송장 등록/조회/삭제)
 *  - scheduled: 15분 cron — 활성 송장 배치 폴링 → 상태 정규화 → Expo Push
 * 설계 기준: ../../docs/ARCHITECTURE.md ("HTTP API 계약" · "디바이스 식별 & 인증/인가" · "보안")
 */

import { normalizeStatus } from "./lib/normalize";
import { track, d1TokenStore, type TrackResult } from "./tracker";
import { runPollingBatch } from "./cron";

export interface Env {
  DB: D1Database;
  /** tracker.delivery 자격증명 (wrangler secret) */
  DELIVERY_TRACKER_CLIENT_ID: string;
  DELIVERY_TRACKER_CLIENT_SECRET: string;
  /** Expo Push 서버 발송 인증 (ADR-010, 선택·권장) */
  EXPO_ACCESS_TOKEN?: string;
  /** 심사용 데모 분기 — 실폴링 우회 (ADR-019, 선택) */
  DEMO_TRACKING_NUMBER?: string;
}

/** 디바이스당 활성 구독 상한 (ADR-008 남용 방어). 초과 시 429. */
const MAX_ACTIVE_PER_DEVICE = 100;
/** IP별 등록 레이트 throttle 윈도/상한 (ADR-008 silent throttle). device_id 순환 우회 방어. */
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX_PER_WINDOW = 60;
/**
 * 자동 추적 지원 택배사(tracker.delivery carrierId). 미지원이면 409 CARRIER_UNSUPPORTED → 앱 딥링크 폴백(QA-002).
 * 단일 출처는 앱 드롭다운 `app/src/lib/carrier.ts`의 CARRIERS — 두 곳을 같은 8종으로 동기화한다(드리프트 시 함께 갱신).
 * 앱은 이 8종만 제시하므로 정상 경로에선 409 가 안 뜬다; 409 는 직접 API 호출·오추정 carrier 방어용(ADR-009).
 * 등록 핫패스에서 외부 carriers() 동기 호출(subrequest/지연)을 피하려 코드 상수로 둔다(ARCHITECTURE).
 */
const SUPPORTED_CARRIERS = new Set([
  "kr.cjlogistics",
  "kr.epost",
  "kr.hanjin",
  "kr.lotte",
  "kr.logen",
  "kr.kdexp",
  "kr.cupost",
  "kr.coupangls",
]);
/** 국내 운송장: 공백·하이픈 제거 후 9~14자리 숫자 (app tracking.ts와 동일 규칙, 서버 재검증). */
const TRACKING_RE = /^\d{9,14}$/;
/** Expo 푸시 토큰 형식. */
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/;

interface ShipmentRow {
  id: string;
  carrier: string;
  tracking_no: string;
  last_normalized_status: string | null;
  last_polled_at: number | null;
  active: number;
  created_at: number;
}

/** API 에러 → { error, code } + HTTP status (ARCHITECTURE 에러 매트릭스). */
class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  toResponse(): Response {
    return Response.json({ error: this.message, code: this.code }, { status: this.status });
  }
}

/** Authorization: Bearer <device_id>. 없으면 401. device_id는 로그하지 않는다(ADR-007). */
function requireDeviceId(request: Request): string {
  const m = /^Bearer\s+(.+)$/.exec(request.headers.get("Authorization") ?? "");
  const id = m?.[1]?.trim();
  if (!id) throw new ApiError(401, "UNAUTHORIZED", "인증이 필요해요");
  return id;
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("not an object");
    }
    return body as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "INVALID_BODY", "요청 본문을 읽을 수 없어요");
  }
}

/** shipments 컬럼 단일 출처(반복 SELECT 리스트 제거). alias 지정 시 prefix 부착. */
const SHIPMENT_FIELDS = [
  "id",
  "carrier",
  "tracking_no",
  "last_normalized_status",
  "last_polled_at",
  "active",
  "created_at",
] as const;
function shipmentCols(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return SHIPMENT_FIELDS.map((f) => p + f).join(", ");
}

/**
 * IP별 등록 레이트 제한(POST /devices·/shipments). cf-connecting-ip 없으면(로컬/테스트) 통과.
 * device_id 순환으로 활성 상한(MAX_ACTIVE_PER_DEVICE)을 우회하는 대량 등록을 silent throttle 한다.
 * 슬라이딩 윈도: IP당 단일 행. 분산 공격은 Cloudflare WAF로 Phase-2 에스컬레이션(ADR-008).
 */
async function enforceIpRateLimit(env: Env, request: Request): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return; // Cloudflare 뒤에선 항상 존재. 없으면(직접 호출 불가 환경) throttle 생략.
  const now = Date.now();
  const row = await env.DB.prepare("SELECT window_start AS ws, count AS c FROM rate_limits WHERE ip = ?")
    .bind(ip)
    .first<{ ws: number; c: number }>();
  if (row && now - row.ws < RATE_WINDOW_MS) {
    if (row.c >= RATE_MAX_PER_WINDOW) {
      throw new ApiError(429, "RATE_LIMITED", "잠시 후 다시 시도해 주세요");
    }
    await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE ip = ?").bind(ip).run();
  } else {
    // 새 윈도 시작(없거나 만료).
    await env.DB.prepare(
      "INSERT INTO rate_limits (ip, window_start, count) VALUES (?, ?, 1) " +
        "ON CONFLICT(ip) DO UPDATE SET window_start = excluded.window_start, count = 1",
    )
      .bind(ip, now)
      .run();
  }
}

/** 구독이 0이 된 shipment(orphan)면 삭제. DELETE /shipments/:id·/me 공용. */
async function deleteIfOrphan(env: Env, shipmentId: string): Promise<void> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS c FROM subscriptions WHERE shipment_id = ?")
    .bind(shipmentId)
    .first<{ c: number }>();
  if ((r?.c ?? 0) === 0) {
    await env.DB.prepare("DELETE FROM shipments WHERE id = ?").bind(shipmentId).run();
  }
}

function serializeShipment(row: ShipmentRow) {
  return {
    id: row.id,
    carrier: row.carrier,
    tracking_no: row.tracking_no,
    status: row.last_normalized_status ?? "미등록",
    active: row.active === 1,
    created_at: row.created_at,
  };
}

/**
 * 즉시 1회 track / 상세 타임라인용 best-effort 조회.
 * 자격증명이 없거나 외부 호출이 실패하면 throw 하지 않고 null 을 반환한다(등록을 막지 않는다).
 */
async function tryTrack(env: Env, carrier: string, trackingNo: string): Promise<TrackResult | null> {
  if (!env.DELIVERY_TRACKER_CLIENT_ID || !env.DELIVERY_TRACKER_CLIENT_SECRET) return null;
  try {
    return await track(carrier, trackingNo, {
      // globalThis 바인딩 필수 — 전역 fetch 를 deps 로 넘기면 this 를 잃어 호출 시 "Illegal invocation" 으로 throw.
      fetch: fetch.bind(globalThis),
      now: Date.now(),
      store: d1TokenStore(env.DB),
      clientId: env.DELIVERY_TRACKER_CLIENT_ID,
      clientSecret: env.DELIVERY_TRACKER_CLIENT_SECRET,
      demoTrackingNumber: env.DEMO_TRACKING_NUMBER,
    });
  } catch {
    return null;
  }
}

/**
 * POST /devices — 기기 등록/갱신(upsert). id = Bearer device_id (ADR-007).
 * push_token 은 **선택** — 푸시를 거부/미허용한 기기(시뮬레이터 포함)도 등록되게 한다(QA-001 데드락 해소).
 * 토큰이 없으면 NULL 로 행만 만들고(기존 토큰은 덮어쓰지 않음), 있으면 검증 후 저장한다.
 */
async function handleRegisterDevice(request: Request, env: Env, deviceId: string): Promise<Response> {
  await enforceIpRateLimit(env, request);
  const body = await parseBody(request);
  const platform = typeof body.platform === "string" ? body.platform : "";
  if (platform !== "ios" && platform !== "android") {
    throw new ApiError(400, "INVALID_BODY", "platform이 필요해요");
  }
  // push_token 선택: 없으면(undefined/null) 토큰 없이 부트스트랩, 있으면 형식 검증.
  const rawToken = body.push_token;
  let pushToken: string | null = null;
  if (rawToken !== undefined && rawToken !== null) {
    if (typeof rawToken !== "string" || !EXPO_TOKEN_RE.test(rawToken)) {
      throw new ApiError(422, "INVALID_TOKEN", "푸시 토큰 형식이 올바르지 않아요");
    }
    pushToken = rawToken;
  }

  const now = Date.now();
  if (pushToken === null) {
    // 토큰 없는 부트스트랩 — 기존 push_token 을 NULL 로 덮어쓰지 않는다(platform 만 갱신).
    await env.DB.prepare(
      "INSERT INTO devices (id, push_token, platform, created_at) VALUES (?, NULL, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET platform = excluded.platform",
    )
      .bind(deviceId, platform, now)
      .run();
  } else {
    // 토큰 등록/갱신 — 같은 토큰을 보유한 다른 기기(재설치/복원)의 토큰을 먼저 NULL 로 정리해
    // UNIQUE(push_token) 충돌을 흡수한다(E1). 토큰은 전역 유일을 유지한다.
    const steal = await env.DB.prepare(
      "UPDATE devices SET push_token = NULL WHERE push_token = ? AND id != ?",
    )
      .bind(pushToken, deviceId)
      .run();
    const stmts: D1PreparedStatement[] = [
      env.DB.prepare(
        "INSERT INTO devices (id, push_token, platform, created_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET push_token = excluded.push_token, platform = excluded.platform",
      ).bind(deviceId, pushToken, platform, now),
    ];
    // 토큰이 실제로 다른 기기에서 이동했다면(steal>0), 옛 기기의 보류 ticket/queue 도 정리한다 —
    // 그 행들이 옛 토큰을 가리켜 새 기기로 잘못 발송되는 교차기기 누설 방지(F3). 자기 토큰 재갱신(steal=0)은
    // 자기 보류분을 지우면 안 되므로 제외한다(조건부).
    if ((steal.meta.changes ?? 0) > 0) {
      stmts.unshift(
        env.DB.prepare("DELETE FROM push_tickets WHERE push_token = ?").bind(pushToken),
        env.DB.prepare("DELETE FROM notification_queue WHERE push_token = ?").bind(pushToken),
      );
    }
    await env.DB.batch(stmts);
  }
  return Response.json({ device_id: deviceId });
}

/** POST /shipments — dedupe + 구독 + 즉시 1회 track(best-effort). 신규 201 / 기존 구독 200(멱등). */
async function handleCreateShipment(request: Request, env: Env, deviceId: string): Promise<Response> {
  await enforceIpRateLimit(env, request);
  // 구독은 등록된 device 만(subscriptions FK). 미등록 device_id 는 인증 실패로 본다.
  const dev = await env.DB.prepare("SELECT 1 FROM devices WHERE id = ?").bind(deviceId).first();
  if (!dev) throw new ApiError(401, "UNAUTHORIZED", "기기를 먼저 등록해 주세요");

  const body = await parseBody(request);
  const carrier = typeof body.carrier === "string" ? body.carrier.trim() : "";
  const rawTracking = typeof body.tracking_no === "string" ? body.tracking_no : "";
  if (!carrier || !rawTracking) {
    throw new ApiError(400, "INVALID_BODY", "carrier·tracking_no가 필요해요");
  }
  const trackingNo = rawTracking.replace(/[\s-]/g, "");
  if (!TRACKING_RE.test(trackingNo)) {
    throw new ApiError(422, "INVALID_TRACKING", "운송장 번호 형식이 올바르지 않아요");
  }
  // 미지원 택배사 — 형식 검증(422) 뒤에 본다(무효 번호는 '번호 확인'이 우선, 에러매트릭스 순서, F5).
  if (!SUPPORTED_CARRIERS.has(carrier)) {
    throw new ApiError(409, "CARRIER_UNSUPPORTED", "자동 추적을 지원하지 않는 택배사예요");
  }

  // 이미 이 기기가 같은 송장을 구독 중이면 새 행 없이 멱등 200.
  const existing = await env.DB.prepare(
    `SELECT ${shipmentCols("s")} FROM shipments s JOIN subscriptions sub ON sub.shipment_id = s.id ` +
      "WHERE s.carrier = ? AND s.tracking_no = ? AND sub.device_id = ?",
  )
    .bind(carrier, trackingNo, deviceId)
    .first<ShipmentRow>();
  if (existing) {
    return Response.json({ shipment: serializeShipment(existing) }, { status: 200 });
  }

  // 새 구독 → 활성 상한 검사(ADR-008).
  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM subscriptions sub JOIN shipments s ON s.id = sub.shipment_id " +
      "WHERE sub.device_id = ? AND s.active = 1",
  )
    .bind(deviceId)
    .first<{ c: number }>();
  if ((countRow?.c ?? 0) >= MAX_ACTIVE_PER_DEVICE) {
    throw new ApiError(429, "RATE_LIMITED", "등록 가능한 송장 수를 초과했어요");
  }

  // dedupe: 기존 (carrier, tracking_no) 가 있으면 그 행을 쓰고, 없으면 새로 만든다.
  const id = crypto.randomUUID();
  const now = Date.now();
  const ins = await env.DB.prepare(
    "INSERT INTO shipments (id, carrier, tracking_no, active, created_at) VALUES (?, ?, ?, 1, ?) " +
      "ON CONFLICT(carrier, tracking_no) DO NOTHING",
  )
    .bind(id, carrier, trackingNo, now)
    .run();
  const isNewShipment = (ins.meta.changes ?? 0) === 1;

  let shipment: ShipmentRow;
  if (isNewShipment) {
    // 새 행 — 값이 전부 메모리에 있으므로 재SELECT 불필요(등록 핫패스 round-trip 절약).
    shipment = {
      id,
      carrier,
      tracking_no: trackingNo,
      last_normalized_status: null,
      last_polled_at: null,
      active: 1,
      created_at: now,
    };
    // 즉시 1회 조회(best-effort): 응답 표시용으로만 단계를 채우고 **DB에는 저장하지 않는다**.
    // last_normalized_status/last_polled_at 을 NULL로 둬야 cron 첫 폴링이 단계를 '처음 잡아' 최초 알림을
    // 보낸다(ARCHITECTURE: 등록 알림은 폴링이 데이터를 처음 잡은 시점에 발송). 저장하면 그 알림이 유실된다.
    const result = await tryTrack(env, carrier, trackingNo);
    if (result) {
      const ev = result.lastEvent ?? result.events[result.events.length - 1];
      shipment.last_normalized_status = normalizeStatus(ev?.statusCode); // 응답 전용(미저장)
    }
  } else {
    // dedupe 적중 — 기존 행을 읽는다.
    shipment = (await env.DB.prepare(
      `SELECT ${shipmentCols()} FROM shipments WHERE carrier = ? AND tracking_no = ?`,
    )
      .bind(carrier, trackingNo)
      .first<ShipmentRow>())!;
  }

  await env.DB.prepare(
    "INSERT OR IGNORE INTO subscriptions (device_id, shipment_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(deviceId, shipment.id, now)
    .run();

  return Response.json({ shipment: serializeShipment(shipment) }, { status: 201 });
}

/** GET /shipments — 내 송장 목록 + 정규화 상태. */
async function handleListShipments(env: Env, deviceId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT ${shipmentCols("s")} FROM shipments s JOIN subscriptions sub ON sub.shipment_id = s.id ` +
      "WHERE sub.device_id = ? ORDER BY s.created_at DESC",
  )
    .bind(deviceId)
    .all<ShipmentRow>();
  return Response.json({ shipments: results.map(serializeShipment) });
}

/** GET /shipments/:id — 인가 확인 후 실시간 track 타임라인(best-effort, 미저장 ADR-011). */
async function handleGetShipment(env: Env, deviceId: string, id: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT ${shipmentCols("s")} FROM shipments s JOIN subscriptions sub ON sub.shipment_id = s.id ` +
      "WHERE s.id = ? AND sub.device_id = ?",
  )
    .bind(id, deviceId)
    .first<ShipmentRow>();
  // 미소유/없음 모두 404 로 통일(존재 누설 최소화).
  if (!row) throw new ApiError(404, "NOT_FOUND", "송장을 찾을 수 없어요");

  const result = await tryTrack(env, row.carrier, row.tracking_no);
  const timeline = result
    ? result.events.map((e) => ({
        time: e.time,
        status: normalizeStatus(e.statusCode),
        description: e.description,
        location: e.location,
      }))
    : [];
  return Response.json({ shipment: serializeShipment(row), timeline });
}

/** DELETE /shipments/:id — 구독 해제, 마지막 구독이면 orphan shipment 정리. */
async function handleDeleteShipment(env: Env, deviceId: string, id: string): Promise<Response> {
  const owns = await env.DB.prepare(
    "SELECT 1 FROM subscriptions WHERE shipment_id = ? AND device_id = ?",
  )
    .bind(id, deviceId)
    .first();
  if (!owns) throw new ApiError(404, "NOT_FOUND", "송장을 찾을 수 없어요");

  await env.DB.prepare("DELETE FROM subscriptions WHERE shipment_id = ? AND device_id = ?")
    .bind(id, deviceId)
    .run();
  await deleteIfOrphan(env, id);
  return new Response(null, { status: 204 });
}

/** DELETE /me — device + 구독(CASCADE) + orphan 송장 + 푸시 토큰 폐기 (ADR-017). */
async function handleDeleteMe(env: Env, deviceId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT shipment_id FROM subscriptions WHERE device_id = ?",
  )
    .bind(deviceId)
    .all<{ shipment_id: string }>();

  // 이 기기의 push_token 을 먼저 읽어 둔다 — receipt 대기/보류 버퍼의 토큰 사본까지 즉시 폐기하기 위함(ADR-017).
  const dev = await env.DB.prepare("SELECT push_token FROM devices WHERE id = ?")
    .bind(deviceId)
    .first<{ push_token: string | null }>();

  // device 삭제(→subscriptions CASCADE) + push_token 사본(비-FK: receipt 대기 push_tickets·야간 보류
  // notification_queue)을 **한 batch 로 원자 폐기** — devices 만 지우면 ~15분 sweep 까지 토큰 잔존.
  // ADR-017 "푸시 토큰 폐기"는 즉시·완전, 크래시 창 최소화(QA-008/#11, CL4).
  const wipeStmts: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM devices WHERE id = ?").bind(deviceId),
  ];
  if (dev?.push_token) {
    wipeStmts.push(
      env.DB.prepare("DELETE FROM push_tickets WHERE push_token = ?").bind(dev.push_token),
      env.DB.prepare("DELETE FROM notification_queue WHERE push_token = ?").bind(dev.push_token),
    );
  }
  await env.DB.batch(wipeStmts);

  // 이 기기가 보던 송장 중 구독이 0이 된 orphan을 한 문장으로 정리(순차 루프 제거).
  const ids = results.map((r) => r.shipment_id);
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(", ");
    await env.DB.prepare(
      `DELETE FROM shipments WHERE id IN (${placeholders}) ` +
        "AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE shipment_id = shipments.id)",
    )
      .bind(...ids)
      .run();
  }
  return new Response(null, { status: 204 });
}

export default {
  // 앱 → Worker HTTP API
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      if (pathname === "/health" && method === "GET") {
        return Response.json({ ok: true });
      }

      if (pathname === "/devices" && method === "POST") {
        return await handleRegisterDevice(request, env, requireDeviceId(request));
      }
      if (pathname === "/shipments" && method === "POST") {
        return await handleCreateShipment(request, env, requireDeviceId(request));
      }
      if (pathname === "/shipments" && method === "GET") {
        return await handleListShipments(env, requireDeviceId(request));
      }

      const segments = pathname.split("/").filter(Boolean);
      if (segments.length === 2 && segments[0] === "shipments") {
        const id = segments[1];
        if (method === "GET") return await handleGetShipment(env, requireDeviceId(request), id);
        if (method === "DELETE") return await handleDeleteShipment(env, requireDeviceId(request), id);
      }

      if (pathname === "/me" && method === "DELETE") {
        return await handleDeleteMe(env, requireDeviceId(request));
      }

      return new Response("Not Found", { status: 404 });
    } catch (e) {
      if (e instanceof ApiError) return e.toResponse();
      // 예기치 못한 오류 — 내부 메시지/스택을 노출하지 않는다(개인정보·보안).
      return Response.json({ error: "잠시 후 다시 시도해 주세요", code: "INTERNAL" }, { status: 500 });
    }
  },

  // cron 트리거 (*/15 * * * *) — due 기반 단일 배치 폴링(배선은 ./cron). now·fetch 주입.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // fetch.bind(globalThis): 전역 fetch 를 deps 로 넘길 때 this 유실("Illegal invocation") 방지.
    ctx.waitUntil(runPollingBatch(env, { now: controller.scheduledTime, fetch: fetch.bind(globalThis) }));
  },
} satisfies ExportedHandler<Env>;
