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
}

export interface TimelineEvent {
  time: string;
  description?: string;
  location?: string;
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
}

function toShipment(raw: RawShipment): Shipment {
  return {
    id: raw.id,
    carrier: raw.carrier,
    trackingNo: raw.tracking_no,
    status: raw.status,
    active: raw.active,
    createdAt: raw.created_at,
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

/** GET /shipments/:id — 상세 = 실시간 타임라인(ADR-011). */
export async function getShipment(
  id: string,
  deps: ApiDeps,
): Promise<{ shipment: Shipment; timeline: TimelineEvent[] }> {
  const res = await request(`/shipments/${encodeURIComponent(id)}`, { method: "GET" }, deps);
  const body = (await res.json()) as { shipment: RawShipment; timeline: TimelineEvent[] };
  return {
    shipment: toShipment(body.shipment),
    timeline: body.timeline.map((e) => ({
      time: e.time,
      description: e.description,
      location: e.location,
    })),
  };
}

/** DELETE /shipments/:id — 구독 해제(204). */
export async function deleteShipment(id: string, deps: ApiDeps): Promise<void> {
  await request(`/shipments/${encodeURIComponent(id)}`, { method: "DELETE" }, deps);
}

/** DELETE /me — 모든 데이터 삭제(204, ADR-017). */
export async function deleteMe(deps: ApiDeps): Promise<void> {
  await request("/me", { method: "DELETE" }, deps);
}
