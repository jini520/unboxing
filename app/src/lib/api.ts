/**
 * Worker HTTP API 타입드 클라이언트.
 * 모든 요청에 Authorization: Bearer <device_id> (ADR-007 인가). 서버가 SOT, 앱은 호출만(ADR-014).
 * 계약: docs/ARCHITECTURE.md "HTTP API 계약". 서버는 snake_case 응답 → 여기서 camelCase로 매핑.
 * device_id 는 Authorization 헤더로만 — 로그·쿼리스트링 금지(ADR-007).
 * 외부 호출은 주입 fetch 로 mock(테스트). 변경(등록/삭제)은 온라인에서만, 오프라인 큐잉 없음(ADR-014).
 */
import { API_URL } from "../config";

/** 표준 7단계 + 폴백 '기타'(ARCHITECTURE 상태 정규화). */
export type Stage =
  | "미등록"
  | "등록"
  | "집화"
  | "이동중"
  | "배송출발"
  | "배송완료"
  | "예외"
  | "기타";

export interface Shipment {
  id: string;
  carrier: string;
  trackingNo: string;
  status: Stage;
  active: boolean;
  createdAt: number;
  /** 현재 단계가 시작된 시각(전환 시에만 갱신, v1_0_0 step 28~30). 구버전 서버면 createdAt 폴백. */
  statusChangedAt: number;
  /** 이 기기 구독의 알림 음소거 여부(per-구독, ADR-020). 구버전 서버면 false. */
  muted: boolean;
}

export interface TimelineEvent {
  time: string;
  description?: string;
  location?: string;
}

/**
 * 상세 화면 전용 수취인 패스스루(미저장, ADR-005) — 이름·지역명만(phoneNumber 없음).
 * track 실패/자격증명 없음 시 서버가 recipient:null 반환 → 앱이 섹션 숨김.
 */
export interface Contact {
  name?: string;
  regionName?: string;
}

/**
 * 받은 알림 기록 1건(GET /notifications, ADR-023). 서버가 이미 camelCase 로 응답 → 매핑 없이 그대로.
 * shipmentId 가 null 이면 가리키던 송장이 정리됨(딥링크 비활성·"정리된 택배"). carrier·last4·body·stage 는
 * denormalize 라 송장이 사라져도 표시는 유지된다. stage 는 표준 단계(표시용), sentAt 은 발송 시각(epoch ms).
 */
export interface NotificationRecord {
  id: string;
  shipmentId: string | null;
  carrier: string;
  last4: string;
  body: string;
  stage: Stage;
  sentAt: number;
}

/**
 * API 에러. code 는 서버 머신 코드(또는 클라이언트 'NETWORK') — 화면 step이 친근한 카피로 매핑한다.
 * 원시 code·message 를 사용자에게 그대로 노출하지 말 것(PRD 톤 규칙).
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiDeps {
  fetch: typeof fetch;
  getDeviceId: () => Promise<string>;
  baseUrl?: string;
}

/** 서버 응답(snake_case) → Shipment(camelCase). */
interface RawShipment {
  id: string;
  carrier: string;
  tracking_no: string;
  status: Stage;
  active: boolean;
  created_at: number;
  status_changed_at?: number | null;
  muted?: boolean;
}

function toShipment(raw: RawShipment): Shipment {
  return {
    id: raw.id,
    carrier: raw.carrier,
    trackingNo: raw.tracking_no,
    status: raw.status,
    active: raw.active,
    createdAt: raw.created_at,
    // 구버전 서버(필드 누락) graceful: 단계 시작 시각은 등록 시각으로, 음소거는 꺼짐으로 폴백.
    statusChangedAt: raw.status_changed_at ?? raw.created_at,
    muted: raw.muted ?? false,
  };
}

/**
 * 공통 요청: Bearer 헤더 부착 → 비-2xx 의 {error,code} 를 ApiError 로, 네트워크 오류는 ApiError(NETWORK) 로.
 * 성공 Response 를 그대로 반환(204 는 본문을 읽지 않는다).
 */
async function request(
  path: string,
  init: { method: string; body?: unknown },
  deps: ApiDeps,
): Promise<Response> {
  const deviceId = await deps.getDeviceId();
  let res: Response;
  try {
    res = await deps.fetch((deps.baseUrl ?? API_URL) + path, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${deviceId}`,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError("NETWORK", 0, "네트워크에 연결할 수 없어요");
  }
  if (!res.ok) {
    let code = "UNKNOWN";
    let message = "요청을 처리하지 못했어요";
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body.code) code = body.code;
      if (body.error) message = body.error;
    } catch {
      // 본문 없음/비JSON — 폴백 코드 유지.
    }
    throw new ApiError(code, res.status, message);
  }
  return res;
}

/**
 * POST /devices — 토큰 없이 기기만 등록(부트스트랩). 푸시 거부/미허용도 기기 등록이 되게 한다(QA-001, ADR-007).
 * 송장 등록 전 device 가 서버에 존재함을 보장하는 용도. 멱등 upsert.
 */
export async function ensureDevice(platform: "ios" | "android", deps: ApiDeps): Promise<void> {
  await request("/devices", { method: "POST", body: { platform } }, deps);
}

/** POST /devices — 푸시 토큰 등록/갱신(upsert). */
export async function registerDevice(
  pushToken: string,
  platform: "ios" | "android",
  deps: ApiDeps,
): Promise<{ deviceId: string }> {
  const res = await request(
    "/devices",
    { method: "POST", body: { push_token: pushToken, platform } },
    deps,
  );
  const body = (await res.json()) as { device_id: string };
  return { deviceId: body.device_id };
}

/** POST /shipments — 등록(dedupe + 구독). created: 201(신규) vs 200(이미 구독, 멱등). */
export async function createShipment(
  carrier: string,
  trackingNo: string,
  deps: ApiDeps,
): Promise<{ shipment: Shipment; created: boolean }> {
  const res = await request(
    "/shipments",
    { method: "POST", body: { carrier, tracking_no: trackingNo } },
    deps,
  );
  const body = (await res.json()) as { shipment: RawShipment };
  return { shipment: toShipment(body.shipment), created: res.status === 201 };
}

/** GET /shipments — 내 송장 목록. */
export async function listShipments(deps: ApiDeps): Promise<Shipment[]> {
  const res = await request("/shipments", { method: "GET" }, deps);
  const body = (await res.json()) as { shipments: RawShipment[] };
  return body.shipments.map(toShipment);
}

/**
 * GET /notifications — 이 기기가 받은 알림 기록(시간 역순, ADR-023). 서버 SOT·로컬 캐시(ADR-014).
 * 서버 응답이 이미 camelCase 라 그대로 반환. limit 미지정 시 서버 기본(100·상한 200).
 */
export async function listNotifications(
  deps: ApiDeps,
  limit?: number,
): Promise<NotificationRecord[]> {
  const q = limit !== undefined ? `?limit=${limit}` : "";
  const res = await request(`/notifications${q}`, { method: "GET" }, deps);
  const body = (await res.json()) as { notifications: NotificationRecord[] };
  return body.notifications;
}

/** GET /shipments/:id — 상세 = 실시간 타임라인(ADR-011) + 수취인 패스스루(ADR-005). */
export async function getShipment(
  id: string,
  deps: ApiDeps,
): Promise<{ shipment: Shipment; timeline: TimelineEvent[]; recipient: Contact | null }> {
  const res = await request(`/shipments/${encodeURIComponent(id)}`, { method: "GET" }, deps);
  const body = (await res.json()) as {
    shipment: RawShipment;
    timeline?: TimelineEvent[];
    recipient?: Contact | null;
  };
  return {
    shipment: toShipment(body.shipment),
    // timeline 누락(upstream 실패 시 서버가 생략할 수 있음) → 빈 타임라인으로 안전 처리.
    timeline: (body.timeline ?? []).map((e) => ({
      time: e.time,
      description: e.description,
      location: e.location,
    })),
    // 수취인은 미저장 패스스루 — track 실패/구버전 서버면 null(앱이 섹션 숨김).
    recipient: body.recipient ?? null,
  };
}

/** PATCH /shipments/:id — 이 기기 구독의 알림 음소거 토글(per-구독, ADR-020). 204. */
export async function muteShipment(
  id: string,
  muted: boolean,
  deps: ApiDeps,
): Promise<void> {
  await request(`/shipments/${encodeURIComponent(id)}`, { method: "PATCH", body: { muted } }, deps);
}

/** DELETE /shipments/:id — 구독 해제(204). */
export async function deleteShipment(id: string, deps: ApiDeps): Promise<void> {
  await request(`/shipments/${encodeURIComponent(id)}`, { method: "DELETE" }, deps);
}

/**
 * 구매 캡처 분류 결과(POST /classify-purchase, v1.1.2 · ADR-036~039). 서버가 이미 이 형태로 응답.
 * 앱은 purchase.ts mapClassificationToInfo 로 ShipmentInfo(memo←productName·amount←price·category)에 매핑한다.
 * price 는 0 이상 정수 또는 null, category 는 CATEGORIES 9종 또는 null(미분류).
 */
export interface PurchaseClassification {
  productName: string;
  price: number | null;
  category: string | null;
}

/**
 * POST /classify-purchase — **마스킹된 텍스트만** 전송(이미지·원문 PII 미전송 — ADR-036·038). 서버는 요청 시 실행($0).
 * 실패(503 한도초과·타임아웃·네트워크)는 ApiError 로 던져 호출부가 "직접 입력" 폴백(ADR-037). 결과는 D1 미저장(ADR-005).
 */
export async function classifyPurchase(
  text: string,
  deps: ApiDeps,
): Promise<PurchaseClassification> {
  const res = await request("/classify-purchase", { method: "POST", body: { text } }, deps);
  const body = (await res.json()) as Partial<PurchaseClassification>;
  return {
    productName: typeof body.productName === "string" ? body.productName : "",
    price: typeof body.price === "number" ? body.price : null,
    category: typeof body.category === "string" ? body.category : null,
  };
}

/** DELETE /me — 모든 데이터 삭제(204, ADR-017). */
export async function deleteMe(deps: ApiDeps): Promise<void> {
  await request("/me", { method: "DELETE" }, deps);
}
