/**
 * unboxing Worker
 *  - fetch:     Expo 앱용 HTTP API (송장 등록/조회/삭제)
 *  - scheduled: 15분 cron — 활성 송장 배치 폴링 → 상태 정규화 → Expo Push
 * 설계 기준: ../../docs/ARCHITECTURE.md ("HTTP API 계약" · "디바이스 식별 & 인증/인가" · "보안")
 */

import { normalizeStatus } from "./lib/normalize";
import { track, d1TokenStore, type TrackResult } from "./tracker";

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
/** 택배사 id 형식(예: kr.cjlogistics). 명백히 잘못된 값만 거른다(실제 지원목록 대조는 후속). */
const CARRIER_RE = /^[a-z]{2,}\.[a-z0-9_.-]+$/i;
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
      fetch,
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

/** POST /devices — 푸시 토큰 등록/갱신(upsert). id = Bearer device_id. */
async function handleRegisterDevice(request: Request, env: Env, deviceId: string): Promise<Response> {
  const body = await parseBody(request);
  const pushToken = typeof body.push_token === "string" ? body.push_token : "";
  const platform = typeof body.platform === "string" ? body.platform : "";
  if (!pushToken || (platform !== "ios" && platform !== "android")) {
    throw new ApiError(400, "INVALID_BODY", "push_token·platform이 필요해요");
  }
  if (!EXPO_TOKEN_RE.test(pushToken)) {
    throw new ApiError(422, "INVALID_TOKEN", "푸시 토큰 형식이 올바르지 않아요");
  }
  await env.DB.prepare(
    "INSERT INTO devices (id, push_token, platform, created_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET push_token = excluded.push_token, platform = excluded.platform",
  )
    .bind(deviceId, pushToken, platform, Date.now())
    .run();
  return Response.json({ device_id: deviceId });
}

/** POST /shipments — dedupe + 구독 + 즉시 1회 track(best-effort). 신규 201 / 기존 구독 200(멱등). */
async function handleCreateShipment(request: Request, env: Env, deviceId: string): Promise<Response> {
  // 구독은 등록된 device 만(subscriptions FK). 미등록 device_id 는 인증 실패로 본다.
  const dev = await env.DB.prepare("SELECT 1 FROM devices WHERE id = ?").bind(deviceId).first();
  if (!dev) throw new ApiError(401, "UNAUTHORIZED", "기기를 먼저 등록해 주세요");

  const body = await parseBody(request);
  const carrier = typeof body.carrier === "string" ? body.carrier.trim() : "";
  const rawTracking = typeof body.tracking_no === "string" ? body.tracking_no : "";
  if (!carrier || !rawTracking) {
    throw new ApiError(400, "INVALID_BODY", "carrier·tracking_no가 필요해요");
  }
  if (!CARRIER_RE.test(carrier)) {
    throw new ApiError(409, "CARRIER_UNSUPPORTED", "자동 추적을 지원하지 않는 택배사예요");
  }
  const trackingNo = rawTracking.replace(/[\s-]/g, "");
  if (!TRACKING_RE.test(trackingNo)) {
    throw new ApiError(422, "INVALID_TRACKING", "운송장 번호 형식이 올바르지 않아요");
  }

  // 이미 이 기기가 같은 송장을 구독 중이면 새 행 없이 멱등 200.
  const existing = await env.DB.prepare(
    "SELECT s.id, s.carrier, s.tracking_no, s.last_normalized_status, s.last_polled_at, s.active, s.created_at " +
      "FROM shipments s JOIN subscriptions sub ON sub.shipment_id = s.id " +
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
  const now = Date.now();
  const ins = await env.DB.prepare(
    "INSERT INTO shipments (id, carrier, tracking_no, active, created_at) VALUES (?, ?, ?, 1, ?) " +
      "ON CONFLICT(carrier, tracking_no) DO NOTHING",
  )
    .bind(crypto.randomUUID(), carrier, trackingNo, now)
    .run();
  const isNewShipment = (ins.meta.changes ?? 0) === 1;

  const shipment = (await env.DB.prepare(
    "SELECT id, carrier, tracking_no, last_normalized_status, last_polled_at, active, created_at " +
      "FROM shipments WHERE carrier = ? AND tracking_no = ?",
  )
    .bind(carrier, trackingNo)
    .first<ShipmentRow>())!;

  // 즉시 1회 조회(best-effort) — 새로 만든 송장만. 외부 실패는 흡수(미등록 유지).
  if (isNewShipment) {
    const result = await tryTrack(env, carrier, trackingNo);
    if (result) {
      const stage = normalizeStatus(result.lastEvent?.statusCode);
      await env.DB.prepare(
        "UPDATE shipments SET last_normalized_status = ?, last_polled_at = ? WHERE id = ?",
      )
        .bind(stage, now, shipment.id)
        .run();
      shipment.last_normalized_status = stage;
    }
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
    "SELECT s.id, s.carrier, s.tracking_no, s.last_normalized_status, s.last_polled_at, s.active, s.created_at " +
      "FROM shipments s JOIN subscriptions sub ON sub.shipment_id = s.id " +
      "WHERE sub.device_id = ? ORDER BY s.created_at DESC",
  )
    .bind(deviceId)
    .all<ShipmentRow>();
  return Response.json({ shipments: results.map(serializeShipment) });
}

/** GET /shipments/:id — 인가 확인 후 실시간 track 타임라인(best-effort, 미저장 ADR-011). */
async function handleGetShipment(env: Env, deviceId: string, id: string): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT s.id, s.carrier, s.tracking_no, s.last_normalized_status, s.last_polled_at, s.active, s.created_at " +
      "FROM shipments s JOIN subscriptions sub ON sub.shipment_id = s.id " +
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
  const remaining = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM subscriptions WHERE shipment_id = ?",
  )
    .bind(id)
    .first<{ c: number }>();
  if ((remaining?.c ?? 0) === 0) {
    await env.DB.prepare("DELETE FROM shipments WHERE id = ?").bind(id).run();
  }
  return new Response(null, { status: 204 });
}

/** DELETE /me — device + 구독(CASCADE) + orphan 송장 + 푸시 토큰 폐기 (ADR-017). */
async function handleDeleteMe(env: Env, deviceId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT shipment_id FROM subscriptions WHERE device_id = ?",
  )
    .bind(deviceId)
    .all<{ shipment_id: string }>();

  // device 삭제 → subscriptions CASCADE, push_token 도 함께 폐기.
  await env.DB.prepare("DELETE FROM devices WHERE id = ?").bind(deviceId).run();

  // 구독이 0이 된 shipment(orphan) 정리.
  for (const { shipment_id } of results) {
    const r = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM subscriptions WHERE shipment_id = ?",
    )
      .bind(shipment_id)
      .first<{ c: number }>();
    if ((r?.c ?? 0) === 0) {
      await env.DB.prepare("DELETE FROM shipments WHERE id = ?").bind(shipment_id).run();
    }
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

  // cron 트리거 (*/15 * * * *) — due 기반 단일 배치 폴링
  async scheduled(controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // TODO 배치 폴링:
    //   1. due 조회: active AND now >= last_polled_at + interval(stage)   (적응형 폴링 표)
    //   2. 청크(외부호출 ≤50/실행) 단위로 tracker.delivery(GraphQL) 폴링
    //   3. 원문 상태 → 표준 단계 정규화(매핑 테이블)
    //   4. last_normalized_status 변경 시에만 Expo Push (멱등) — '이동중'은 무알림
    //   5. 배송완료 → 알림 후 삭제 / 미등록·예외 7일·전체 30일 만료
    console.log("scheduled tick:", controller.cron, new Date(controller.scheduledTime).toISOString());
  },
} satisfies ExportedHandler<Env>;
