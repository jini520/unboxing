/**
 * unboxing Worker
 *  - fetch:     Expo 앱용 HTTP API (송장 등록/조회/삭제)
 *  - scheduled: 15분 cron — 활성 송장 배치 폴링 → 상태 정규화 → Expo Push
 * 설계 기준: ../../docs/ARCHITECTURE.md ("HTTP API 계약" · "디바이스 식별 & 인증/인가" · "보안")
 */

import { normalizeStatus } from "./lib/normalize";
import type { Stage } from "./lib/polling";
import {
  shouldRegisterWebhook,
  webhookExpiration,
  WEBHOOK_TTL_MS,
  verifyCallbackSecret,
  shouldRefetchOnCallback,
  parseCallback,
} from "./lib/webhook";
import { track, registerTrackWebhook, d1TokenStore, type TrackResult, type TrackerDeps } from "./tracker";
import { runPollingBatch, processShipmentUpdate } from "./cron";
// 개인정보처리방침 공개 페이지(GET /privacy)는 인앱 화면과 동일한 구조화 데이터를 재사용한다(사본 증가 방지).
import { PRIVACY_POLICY } from "../../app/src/content/privacyPolicy";

export interface Env {
  DB: D1Database;
  /** tracker.delivery 자격증명 (wrangler secret) */
  DELIVERY_TRACKER_CLIENT_ID: string;
  DELIVERY_TRACKER_CLIENT_SECRET: string;
  /** Expo Push 서버 발송 인증 (ADR-010, 선택·권장) */
  EXPO_ACCESS_TOKEN?: string;
  /** 심사용 데모 분기 — 실폴링 우회 (ADR-019, 선택) */
  DEMO_TRACKING_NUMBER?: string;
  /** webhook 콜백 경로 시크릿 — /webhooks/track/<secret> 게이트 (ADR-029, 필수·로그 금지) */
  WEBHOOK_CALLBACK_SECRET: string;
  /** webhook 콜백 서명(HMAC) 검증 키 — tracker.delivery 제공 시 (ADR-029, 선택) */
  WEBHOOK_SIGNING_SECRET?: string;
  /**
   * cron webhook (재)등록 sweep 의 콜백 베이스 URL (공개 workers.dev/커스텀 도메인, var·비밀 아님).
   * scheduled 핸들러엔 request origin 이 없어 callbackUrl=`${base}/webhooks/track/<secret>` 를 이 값으로 만든다(ADR-028 cron 등록).
   * 미설정이면 cron 등록 sweep 보류(폴백 폴링이 흡수). POST /shipments 즉시 등록은 request origin 을 쓰므로 무관.
   */
  WEBHOOK_CALLBACK_BASE_URL?: string;
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
/** GET /notifications limit — 기본 100, 상한 200(과도한 응답·메모리 방지, ADR-023). */
const NOTIFICATIONS_LIMIT_DEFAULT = 100;
const NOTIFICATIONS_LIMIT_MAX = 200;

interface ShipmentRow {
  id: string;
  carrier: string;
  tracking_no: string;
  last_normalized_status: string | null;
  last_polled_at: number | null;
  active: number;
  created_at: number;
  status_changed_at: number | null;
}

/** notifications 행 (v1.1, ADR-023) — 발송한 알림 기록. carrier 는 carrierId 원문(한글 변환은 앱). */
interface NotificationRow {
  id: string;
  device_id: string;
  shipment_id: string | null;
  carrier: string;
  last4: string;
  body: string;
  stage: string;
  sent_at: number;
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
  "status_changed_at",
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
    // 현재 단계가 시작된 시각(전환 시에만 갱신). 컬럼이 비면(backfill 전) 등록 시각으로 폴백.
    status_changed_at: row.status_changed_at ?? row.created_at,
  };
}

/**
 * notifications 행 → 응답(snake→camel, ADR-023). shipment_id 가 NULL(송장 정리됨)이면 shipmentId=null
 * → 앱 딥링크 비활성("정리된 택배"). carrier·last4·body·stage 는 denormalize 라 표시는 그대로 유지된다.
 */
function serializeNotification(row: NotificationRow) {
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    carrier: row.carrier,
    last4: row.last4,
    body: row.body,
    stage: row.stage,
    sentAt: row.sent_at,
  };
}

/**
 * tracker deps 구성(자격증명 가드 — 없으면 null). 즉시 1회 track 과 registerTrackWebhook 가
 * **같은 단일 경로**로 deps 를 만든다 → fetch 바인딩 누락을 한 곳에서 차단한다.
 * CRITICAL(P-1·T1): fetch 는 반드시 fetch.bind(globalThis) — 맨 fetch 를 deps 로 넘기면 호출 시 this 유실로
 * "Illegal invocation" throw(mock 테스트는 못 잡음). track·webhook 등록이 이 구성을 공유한다.
 */
function makeTrackerDeps(env: Env): (TrackerDeps & { demoTrackingNumber?: string }) | null {
  if (!env.DELIVERY_TRACKER_CLIENT_ID || !env.DELIVERY_TRACKER_CLIENT_SECRET) return null;
  return {
    fetch: fetch.bind(globalThis),
    now: Date.now(),
    store: d1TokenStore(env.DB),
    clientId: env.DELIVERY_TRACKER_CLIENT_ID,
    clientSecret: env.DELIVERY_TRACKER_CLIENT_SECRET,
    demoTrackingNumber: env.DEMO_TRACKING_NUMBER,
  };
}

/**
 * 즉시 1회 track / 상세 타임라인용 best-effort 조회.
 * 자격증명이 없거나 외부 호출이 실패하면 throw 하지 않고 null 을 반환한다(등록을 막지 않는다).
 */
async function tryTrack(env: Env, carrier: string, trackingNo: string): Promise<TrackResult | null> {
  const deps = makeTrackerDeps(env);
  if (!deps) return null;
  try {
    return await track(carrier, trackingNo, deps);
  } catch {
    return null;
  }
}

/**
 * webhook 등록(ADR-028) — **비차단(ctx.waitUntil)·실패허용**. 사용자 등록 응답을 절대 막지 않는다.
 * 현재 행 상태(단계·active·기존 만료)를 권위 있게 읽어 멱등 판정한다: 등록 가능 단계(비종료·미등록 아님)·active 이고
 * 미등록(NULL)/만료임박일 때만 송장당 1개 등록(dedupe-hit·이미 등록·여유면 skip → 중복 없음).
 * 성공 → webhook_expires_at set. 실패(네트워크·쿼터·1000 동시 초과·GraphQL)는 삼켜 NULL 유지 → 폴백 폴링이
 * 적응형 간격으로 흡수(W3·W4). 콜백 시크릿 경로(ADR-029 ①): callbackUrl=/webhooks/track/<secret>. 시크릿·번호는 로그 금지.
 */
function scheduleWebhookRegistration(
  env: Env,
  ctx: ExecutionContext,
  origin: string,
  shipmentId: string,
): void {
  if (!env.WEBHOOK_CALLBACK_SECRET) return; // 콜백 게이트 시크릿 없으면 등록 보류(폴백 폴링)
  const deps = makeTrackerDeps(env);
  if (!deps) return; // 자격증명 없음 → 등록 불가(폴백 폴링)
  ctx.waitUntil(
    (async () => {
      const row = await env.DB.prepare(
        "SELECT carrier, tracking_no, last_normalized_status, active, webhook_expires_at FROM shipments WHERE id = ?",
      )
        .bind(shipmentId)
        .first<{
          carrier: string;
          tracking_no: string;
          last_normalized_status: string | null;
          active: number;
          webhook_expires_at: number | null;
        }>();
      if (!row) return;
      const stage = (row.last_normalized_status ?? "미등록") as Stage;
      if (!shouldRegisterWebhook(stage, row.active === 1, row.webhook_expires_at, deps.now)) return;
      const callbackUrl = `${origin}/webhooks/track/${env.WEBHOOK_CALLBACK_SECRET}`;
      try {
        const res = await registerTrackWebhook(
          row.carrier,
          row.tracking_no,
          callbackUrl,
          webhookExpiration(deps.now),
          deps,
        );
        if (res.ok) {
          await env.DB.prepare("UPDATE shipments SET webhook_expires_at = ? WHERE id = ?")
            .bind(deps.now + WEBHOOK_TTL_MS, shipmentId)
            .run();
        }
      } catch {
        // 실패 삼킴 — webhook_expires_at NULL 유지 → 폴백 폴링이 흡수(W3·W4). 콜백 시크릿·운송장번호는 로그 금지.
      }
    })(),
  );
}

/**
 * POST /webhooks/track/<secret> — tracker.delivery 콜백 수신(1차 신선도, ADR-028·029).
 * **Bearer 인증 없음** — 콜백엔 device 토큰이 없다. 게이트는 추측 불가 **시크릿 경로**다.
 * 동기 게이트(빠른 D1 읽기)로 **1초 내 202** 를 보장하고, 실제 track 재조회·CAS·푸시는 ctx.waitUntil 비동기로
 * **폴링과 동일한 다운스트림(processShipmentUpdate) 을 재사용**한다(복제 금지 → 멱등·중복 푸시 0 보장).
 *
 * 3중 방어(ADR-029): ① 시크릿 경로(불일치 조용히 401·시크릿/URL 로그 금지 T6) ② 페이로드 불신(D1 active 송장으로
 * 존재할 때만 재조회 — 위조 콜백의 quota 남용 차단 W1·W12) ③ 송장별 신선도 throttle(직전 폴링 <60s skip +
 * last_polled_at 선점으로 동시·연속 콜백 dedupe W6). **IP rate limit 은 쓰지 않는다**(콜백은 tracker 고정 IP →
 * 거짓양성, T2). 응답: 시크릿 불일치 401 / 미존재·비active·본문오류·신선 skip 202(무시) / 수락 202 + waitUntil track.
 */
async function handleWebhookCallback(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  secret: string,
): Promise<Response> {
  // ① 시크릿 경로 게이트(상수시간 비교). 불일치/미설정 → 401(본문 없음·조용히). 시크릿·URL 은 로그 금지(T6).
  if (!env.WEBHOOK_CALLBACK_SECRET || !verifyCallbackSecret(secret, env.WEBHOOK_CALLBACK_SECRET)) {
    return new Response(null, { status: 401 });
  }

  // ② 본문 파싱 → carrierId·trackingNumber 만(여분 무시). 손상/누락/형식오류 → 202(무시, 처리 안 함).
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 202 });
  }
  const parsed = parseCallback(body);
  if (!parsed) return new Response(null, { status: 202 });

  // ③ 페이로드 불신 — D1 에 active 송장으로 존재할 때만 처리. 없거나 비active(배송완료·만료) → 202·track 미호출
  //    (위조·임의 번호 콜백이 quota 를 태우는 것을 차단, W1·W12). (carrier, tracking_no) 는 UNIQUE 라 단일 행.
  const row = await env.DB.prepare(
    "SELECT id, carrier, tracking_no, last_normalized_status, last_polled_at FROM shipments " +
      "WHERE carrier = ? AND tracking_no = ? AND active = 1",
  )
    .bind(parsed.carrierId, parsed.trackingNumber)
    .first<{
      id: string;
      carrier: string;
      tracking_no: string;
      last_normalized_status: string | null;
      last_polled_at: number | null;
    }>();
  if (!row) return new Response(null, { status: 202 });

  // ④ 신선도 throttle — 직전 폴링이 60s 이내면 연속·중복 콜백으로 보고 재조회 skip(202, W6).
  const now = Date.now();
  if (!shouldRefetchOnCallback(row.last_polled_at, now)) {
    return new Response(null, { status: 202 });
  }

  // ⑤ last_polled_at 선점 갱신(ADR-012 — 동시 콜백 dedupe) 후 비동기 재조회 → 1초 내 202.
  //    track 실패는 202 이후라 tracker 재시도에 의존하지 않고 다음 폴백 due 가 흡수한다(W5).
  //    fetch.bind(globalThis): 전역 fetch this 유실("Illegal invocation") 방지(P-1·T1, 폴링과 동일).
  await env.DB.prepare("UPDATE shipments SET last_polled_at = ? WHERE id = ?").bind(now, row.id).run();
  ctx.waitUntil(
    processShipmentUpdate(env, { now, fetch: fetch.bind(globalThis) }, row).catch(() => {
      // track 실패·다운스트림 오류는 삼킨다 — 폴백 폴링이 다음 due 에 흡수(W5). 시크릿·운송장번호는 로그 금지.
    }),
  );
  return new Response(null, { status: 202 });
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

/** POST /shipments — dedupe + 구독 + 즉시 1회 track(best-effort) + webhook 등록(비차단). 신규 201 / 기존 구독 200(멱등). */
async function handleCreateShipment(
  request: Request,
  env: Env,
  deviceId: string,
  ctx: ExecutionContext,
): Promise<Response> {
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
    "INSERT INTO shipments (id, carrier, tracking_no, active, created_at, status_changed_at) VALUES (?, ?, ?, 1, ?, ?) " +
      "ON CONFLICT(carrier, tracking_no) DO NOTHING",
  )
    .bind(id, carrier, trackingNo, now, now)
    .run();
  const isNewShipment = (ins.meta.changes ?? 0) === 1;

  let shipment: ShipmentRow;
  if (isNewShipment) {
    // 새 행 — 값이 전부 메모리에 있으므로 재SELECT 불필요(등록 핫패스 round-trip 절약).
    // status_changed_at 은 등록 시각으로 초기화(아직 단계 변동 없음 = 현재 단계 시작 시각).
    shipment = {
      id,
      carrier,
      tracking_no: trackingNo,
      last_normalized_status: null,
      last_polled_at: null,
      active: 1,
      created_at: now,
      status_changed_at: now,
    };
    // 즉시 1회 조회(best-effort). 비종료 단계는 **DB에도 저장**해 목록이 등록 직후 실제 상태를 보인다.
    const result = await tryTrack(env, carrier, trackingNo);
    if (result) {
      const ev = result.lastEvent ?? result.events[result.events.length - 1];
      const immediate = normalizeStatus(ev?.statusCode);
      shipment.last_normalized_status = immediate; // 응답 표시용
      // 조회된 단계를 **DB에도 저장**해 목록이 등록 직후 실제 상태를 보인다(미등록만 제외).
      // 등록 시점 단계는 prev==stored 라 무알림 — 이후 변화만 cron 이 알림으로 잡는다.
      // **배송완료(종료)도 저장**한다: 이미 배송완료된 송장을 등록하면 미등록이 아니라 배송완료로 보여야 함.
      //   이 경우 active=0 으로 두어 재폴링을 멈춘다(등록 자체는 전환 알림 대상 아님 — 방금 사용자가 추가).
      //   (cron 미실행 환경[로컬 dev]에서 미등록으로 고착되던 버그 수정.)
      if (immediate !== "미등록") {
        // status_changed_at 도 그 이벤트 시각으로 갱신(없으면 now). 단계를 처음 저장하는 시점.
        const parsed = ev?.time ? Date.parse(ev.time) : NaN;
        const changedAt = Number.isNaN(parsed) ? now : parsed;
        const active = immediate === "배송완료" ? 0 : 1;
        shipment.status_changed_at = changedAt; // 응답·DB 일치
        shipment.active = active;
        await env.DB.prepare(
          "UPDATE shipments SET last_normalized_status = ?, status_changed_at = ?, active = ? WHERE id = ?",
        )
          .bind(immediate, changedAt, active, id)
          .run();
      }
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

  // webhook 등록(ADR-028) — 비차단·실패허용·송장당 1개(멱등). 등록 가능 단계가 아니면 no-op, 실패해도 폴백 폴링.
  scheduleWebhookRegistration(env, ctx, new URL(request.url).origin, shipment.id);

  return Response.json({ shipment: serializeShipment(shipment) }, { status: 201 });
}

/** GET /shipments — 내 송장 목록 + 정규화 상태 + 이 기기의 음소거 여부(per-구독, ADR-020). */
async function handleListShipments(env: Env, deviceId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT ${shipmentCols("s")}, sub.muted FROM shipments s JOIN subscriptions sub ON sub.shipment_id = s.id ` +
      "WHERE sub.device_id = ? ORDER BY s.created_at DESC",
  )
    .bind(deviceId)
    .all<ShipmentRow & { muted: number }>();
  // muted 는 subscriptions 조인 컬럼이라 serializeShipment(shipments 전용) 밖에서 합친다.
  return Response.json({
    shipments: results.map((row) => ({ ...serializeShipment(row), muted: row.muted === 1 })),
  });
}

/**
 * GET /notifications — 이 기기가 받은 알림 기록(시간 역순, ADR-023). 서버 SOT·로컬 캐시.
 * device_id 로만 필터(인가 경계 — 타 기기 행 비노출, 교차 누설 없음 E10). 읽음 여부는 비저장(로컬 lastSeen).
 */
async function handleListNotifications(env: Env, deviceId: string, url: URL): Promise<Response> {
  const raw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit =
    Number.isFinite(raw) && raw > 0 ? Math.min(raw, NOTIFICATIONS_LIMIT_MAX) : NOTIFICATIONS_LIMIT_DEFAULT;
  const { results } = await env.DB.prepare(
    "SELECT id, shipment_id, carrier, last4, body, stage, sent_at FROM notifications " +
      "WHERE device_id = ? ORDER BY sent_at DESC LIMIT ?",
  )
    .bind(deviceId, limit)
    .all<NotificationRow>();
  return Response.json({ notifications: results.map(serializeNotification) });
}

/** GET /shipments/:id — 인가 확인 후 실시간 track 타임라인(best-effort, 미저장 ADR-011). */
async function handleGetShipment(env: Env, deviceId: string, id: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT ${shipmentCols("s")}, sub.muted FROM shipments s JOIN subscriptions sub ON sub.shipment_id = s.id ` +
      "WHERE s.id = ? AND sub.device_id = ?",
  )
    .bind(id, deviceId)
    .first<ShipmentRow & { muted: number }>();
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
  // 수취인(이름·지역명)은 track 응답을 **화면 전용으로 패스스루만** 한다 — D1 미저장(ADR-005).
  // tryTrack 이 null(자격증명 없음·외부 실패)이면 recipient 도 null(앱이 섹션 숨김).
  const recipient = result?.recipient ?? null;
  return Response.json({
    shipment: { ...serializeShipment(row), muted: row.muted === 1 },
    timeline,
    recipient,
  });
}

/**
 * PATCH /shipments/:id — 이 기기 구독의 알림 음소거 토글 (ADR-020). 바디 `{ muted: boolean }`.
 * per-구독(device_id+shipment_id) 단위라 같은 송장을 구독하는 다른 기기엔 영향 없다.
 * 레이트리밋 미적용(등록 남용 방어와 무관·저위험). 음소거는 모든 푸시(전환·운영성)를 끄되 추적은 계속.
 */
async function handleMuteShipment(
  env: Env,
  request: Request,
  deviceId: string,
  id: string,
): Promise<Response> {
  const body = await parseBody(request);
  if (typeof body.muted !== "boolean") {
    throw new ApiError(400, "INVALID_BODY", "muted(boolean)가 필요해요");
  }
  const muted = body.muted;

  // 인가/소유: 이 기기가 구독 중인 송장만(handleDeleteShipment 와 동일 패턴).
  const owns = await env.DB.prepare(
    "SELECT 1 FROM subscriptions WHERE shipment_id = ? AND device_id = ?",
  )
    .bind(id, deviceId)
    .first();
  if (!owns) throw new ApiError(404, "NOT_FOUND", "송장을 찾을 수 없어요");

  // device_id + shipment_id 둘 다로 WHERE — 타 구독자 보호.
  await env.DB.prepare("UPDATE subscriptions SET muted = ? WHERE device_id = ? AND shipment_id = ?")
    .bind(muted ? 1 : 0, deviceId, id)
    .run();

  // 음소거 시: 이 기기의 야간 보류분 정리. 아침 flushQueue 는 subscribers 를 거치지 않고 큐에서
  // 직접 발송하므로, 음소거 이전에 적재된 분이 음소거 후에도 발송되는 누락을 막는다. 토큰 NULL 이면 보류분 없음.
  if (muted) {
    const dev = await env.DB.prepare("SELECT push_token FROM devices WHERE id = ?")
      .bind(deviceId)
      .first<{ push_token: string | null }>();
    if (dev?.push_token) {
      await env.DB.prepare("DELETE FROM notification_queue WHERE shipment_id = ? AND push_token = ?")
        .bind(id, dev.push_token)
        .run();
    }
  }
  return new Response(null, { status: 204 });
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

  // 휴지통(로컬 소프트 삭제, ADR-022)으로 보낸 송장이 야간 보류분으로 **지연 푸시**되지 않도록 이 기기의
  // 보류 알림을 정리한다 — 구독 해제로 새 폴링·푸시는 멈추지만, 이미 적재된 notification_queue 보류분은
  // 아침 flushQueue 가 subscribers 를 거치지 않고 직접 발송하기 때문(음소거 정리와 동일 불변, ADR-020).
  // per-device: 이 기기 토큰의 (shipment) 보류분만 — 타 구독자 보류분 무영향. 토큰 NULL 이면 보류분 없음.
  // notifications(이력)는 건드리지 않는다 — 단건 삭제는 구독 해제일 뿐, 받은 알림 기록은 독립 보존(ADR-023).
  const dev = await env.DB.prepare("SELECT push_token FROM devices WHERE id = ?")
    .bind(deviceId)
    .first<{ push_token: string | null }>();
  if (dev?.push_token) {
    await env.DB.prepare("DELETE FROM notification_queue WHERE shipment_id = ? AND push_token = ?")
      .bind(id, dev.push_token)
      .run();
  }

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
    // 발송 알림 기록도 함께 즉시 폐기(ADR-017·023) — device_id 키라 이 기기 행만. 90일/상한 sweep 을 기다리지 않는다.
    env.DB.prepare("DELETE FROM notifications WHERE device_id = ?").bind(deviceId),
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

// ── 개인정보처리방침 공개 페이지 (Play/App Store 심사용 공개 URL) ──────────────
// 본문은 app/src/content/privacyPolicy.ts(인앱 화면과 동일 데이터)를 그대로 렌더한다.
// SoT: docs/PRIVACY_POLICY.md → privacyPolicy.ts → 여기. 사본을 늘리지 않는다.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderPrivacyHtml(): string {
  const p = PRIVACY_POLICY;
  // "· " 로 시작하는 연속 문단 → <ul>, 그 외 → <p> (인앱 렌더 규칙과 동일).
  const renderBody = (body: string[]): string => {
    const out: string[] = [];
    for (let i = 0; i < body.length; ) {
      if (body[i].startsWith("· ")) {
        const items: string[] = [];
        while (i < body.length && body[i].startsWith("· ")) {
          items.push(`<li>${escapeHtml(body[i].slice(2))}</li>`);
          i++;
        }
        out.push(`<ul>${items.join("")}</ul>`);
      } else {
        out.push(`<p>${escapeHtml(body[i])}</p>`);
        i++;
      }
    }
    return out.join("");
  };
  const sections = p.sections
    .map((s) => `<section><h2>${escapeHtml(s.heading)}</h2>${renderBody(s.body)}</section>`)
    .join("");
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(p.title)} · 언박싱</title>
<style>
:root { color-scheme: light dark; }
body { font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", Roboto, sans-serif; line-height: 1.7; max-width: 720px; margin: 0 auto; padding: 28px 20px 72px; color: #1a1a1a; }
@media (prefers-color-scheme: dark) { body { color: #e8e8e8; background: #111; } }
h1 { font-size: 1.55rem; margin: 0 0 4px; }
.meta { color: #888; font-size: 0.85rem; margin: 0 0 24px; }
h2 { font-size: 1.08rem; margin: 32px 0 8px; }
ul { margin: 8px 0; padding-left: 1.25em; }
li { margin: 4px 0; }
p { margin: 8px 0; }
</style>
</head>
<body>
<h1>${escapeHtml(p.title)}</h1>
<p class="meta">시행일 ${escapeHtml(p.effectiveDate)} · 최종 수정일 ${escapeHtml(p.lastUpdated)}</p>
<p>${escapeHtml(p.intro)}</p>
${sections}
</body>
</html>`;
}

export default {
  // 앱 → Worker HTTP API
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;
    const segments = pathname.split("/").filter(Boolean);

    try {
      if (pathname === "/health" && method === "GET") {
        return Response.json({ ok: true });
      }

      // 개인정보처리방침 공개 페이지 — 인증 없음, Play/App Store 심사 URL용.
      if (pathname === "/privacy" && method === "GET") {
        return new Response(renderPrivacyHtml(), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      }

      // tracker.delivery webhook 콜백(ADR-028·029) — **Bearer 인증 앞**·시크릿 경로로만 게이트(콜백엔 device 토큰 없음).
      if (method === "POST" && segments.length === 3 && segments[0] === "webhooks" && segments[1] === "track") {
        return await handleWebhookCallback(request, env, ctx, segments[2]);
      }

      if (pathname === "/devices" && method === "POST") {
        return await handleRegisterDevice(request, env, requireDeviceId(request));
      }
      if (pathname === "/shipments" && method === "POST") {
        return await handleCreateShipment(request, env, requireDeviceId(request), ctx);
      }
      if (pathname === "/shipments" && method === "GET") {
        return await handleListShipments(env, requireDeviceId(request));
      }
      if (pathname === "/notifications" && method === "GET") {
        return await handleListNotifications(env, requireDeviceId(request), url);
      }

      if (segments.length === 2 && segments[0] === "shipments") {
        const id = segments[1];
        if (method === "GET") return await handleGetShipment(env, requireDeviceId(request), id);
        if (method === "DELETE") return await handleDeleteShipment(env, requireDeviceId(request), id);
        if (method === "PATCH") return await handleMuteShipment(env, request, requireDeviceId(request), id);
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
