/**
 * tracker.delivery Tracking API (GraphQL) 클라이언트.
 * 설계 기준: docs/ARCHITECTURE.md "tracker.delivery 연동" · "에러 분류 → 처리" · "데모/리뷰 경로",
 *           ADR-013(토큰 캐싱·21일 자격증명), ADR-019(데모 경로).
 *
 * 핵심:
 *  - 외부 호출은 **주입된 fetch**로만 한다(테스트는 mock, 실제 네트워크 호출 없음).
 *  - GraphQL 에러는 응답 본문 `errors[]`에 있으며 **HTTP status는 무의미**하다 → 본문으로 분류.
 *  - access token은 store(D1)에 캐시하고 만료 임박 시에만 재발급.
 *  - clientId/clientSecret/token 은 로그/에러 메시지에 남기지 않는다.
 */

const GRAPHQL_ENDPOINT = "https://apis.tracker.delivery/graphql";
/** OAuth2 client_credentials 토큰 발급(정확 URL은 콘솔/스키마로 확인 — 주입 fetch라 테스트는 mock). */
const TOKEN_ENDPOINT = "https://auth.tracker.delivery/oauth2/token";
const DEFAULT_TIMEOUT_MS = 15_000; // ARCHITECTURE 권장 timeout
/** 만료 이 시간 이내면 미리 재발급(경계에서의 401 회피). */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export interface TrackEvent {
  time: string; // ISO 시각
  statusCode: string | null; // 원문 status.code (step1 normalizeStatus 입력)
  description?: string;
  location?: string; // 허브명(비개인정보)
}

export interface TrackResult {
  lastEvent: TrackEvent | null;
  /** upstream가 반환한 순서를 그대로 유지(시간 정렬 보장 안 함). lastEvent = 가장 최근 이벤트. */
  events: TrackEvent[];
}

export interface CarrierInfo {
  id: string;
  name: string;
}

/** 토큰 저장 추상화 — D1 결합을 분리해 단위 테스트(인메모리)를 가능하게 한다. */
export interface TokenStore {
  get(): Promise<{ token: string; expiresAt: number } | null>;
  set(token: string, expiresAt: number): Promise<void>;
}

/** D1 tracker_token 테이블 기반 구현(운영용). 단위 테스트는 인메모리 TokenStore를 주입한다. */
export function d1TokenStore(db: D1Database): TokenStore {
  return {
    async get() {
      const row = await db
        .prepare("SELECT access_token, expires_at FROM tracker_token WHERE id = 1")
        .first<{ access_token: string; expires_at: number }>();
      return row ? { token: row.access_token, expiresAt: row.expires_at } : null;
    },
    async set(token, expiresAt) {
      await db
        .prepare(
          "INSERT INTO tracker_token (id, access_token, expires_at) VALUES (1, ?, ?) " +
            "ON CONFLICT(id) DO UPDATE SET access_token = excluded.access_token, expires_at = excluded.expires_at",
        )
        .bind(token, expiresAt)
        .run();
    },
  };
}

export interface TrackerDeps {
  fetch: typeof fetch;
  now: number;
  store: TokenStore;
  clientId: string;
  clientSecret: string;
  /** 요청 timeout(ms). 미지정 시 15s. */
  timeoutMs?: number;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
}

interface RawEvent {
  time?: string | null;
  status?: { code?: string | null } | null;
  description?: string | null;
  location?: string | null; // 스키마 확정 시 매핑 보강(ADR Open Questions)
}

interface TrackQueryData {
  track: {
    lastEvent: RawEvent | null;
    events: { edges: { node: RawEvent }[] } | null;
  } | null;
}

interface CarriersQueryData {
  carriers: { edges: { node: { id: string; name: string } }[] } | null;
}

const TRACK_QUERY = `query Track($carrierId: ID!, $trackingNumber: String!) {
  track(carrierId: $carrierId, trackingNumber: $trackingNumber) {
    lastEvent { time status { code name } description }
    events(last: 50) { edges { node { time status { code name } description } } }
  }
}`;

const CARRIERS_QUERY = `query Carriers {
  carriers(first: 100) { edges { node { id name } } }
}`;

/** 주입 fetch로 timeout(AbortController)을 적용해 호출. */
function fetchWithTimeout(deps: TrackerDeps, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return deps.fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** client_credentials로 새 토큰을 발급하고 store에 저장 후 반환(캐시 무시 — 항상 재발급). */
async function issueToken(deps: TrackerDeps): Promise<string> {
  const res = await fetchWithTimeout(deps, TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: deps.clientId,
      client_secret: deps.clientSecret,
    }).toString(),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    // 본문/시크릿은 메시지에 넣지 않는다.
    throw new Error("tracker.delivery 토큰 발급 실패");
  }
  const expiresAt = deps.now + (json.expires_in ?? 3600) * 1000;
  await deps.store.set(json.access_token, expiresAt);
  return json.access_token;
}

/** 캐시된 토큰을 반환. 없거나 만료 임박이면 client_credentials로 재발급 후 store.set. */
export async function getAccessToken(deps: TrackerDeps): Promise<string> {
  const cached = await deps.store.get();
  if (cached && deps.now < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return cached.token;
  }
  return issueToken(deps);
}

function hasAuthError(body: GraphQLResponse<unknown>): boolean {
  return (body.errors ?? []).some((e) => e.extensions?.code === "UNAUTHENTICATED");
}

async function postGraphql<T>(
  deps: TrackerDeps,
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<GraphQLResponse<T>> {
  const res = await fetchWithTimeout(deps, GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  // HTTP status는 무의미 — 본문의 errors[]로 판단(ARCHITECTURE).
  return (await res.json()) as GraphQLResponse<T>;
}

/**
 * GraphQL 호출 + 에러 분류.
 * UNAUTHENTICATED(토큰 만료)면 토큰 재발급 후 **정확히 1회만** 재시도(무한 루프 금지, ADR-013).
 */
async function graphqlRequest<T>(
  deps: TrackerDeps,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  let body = await postGraphql<T>(deps, await getAccessToken(deps), query, variables);
  if (hasAuthError(body)) {
    // 토큰 만료 → 재발급 1회 후 재시도. 재시도도 실패하면 아래에서 throw.
    body = await postGraphql<T>(deps, await issueToken(deps), query, variables);
  }
  if (body.errors && body.errors.length > 0) {
    const codes = body.errors.map((e) => e.extensions?.code ?? e.message).join(", ");
    throw new Error(`tracker.delivery GraphQL 오류: ${codes}`);
  }
  if (body.data === undefined || body.data === null) {
    throw new Error("tracker.delivery 응답에 data 없음");
  }
  return body.data;
}

function toEvent(raw: RawEvent | null | undefined): TrackEvent | null {
  if (!raw || !raw.time) return null;
  return {
    time: raw.time,
    statusCode: raw.status?.code ?? null,
    description: raw.description ?? undefined,
    location: raw.location ?? undefined,
  };
}

/**
 * 심사용 캔드 결과 — 외부 호출 없이 단계 진행(등록→이동중→배송출발)을 보여준다(ADR-019).
 * 잔존(M3, bounded 수용): 캔드가 '배송출발'에서 멈춰 60분마다 재폴링(외부 호출은 계속 우회)·30일 후 active=0.
 * dedupe 로 데모 번호는 항상 1행이고 비활성 시 '분실 의심' 안내는 cron 데모 가드로 제외되므로 누적·비용은 한정적.
 */
function demoResult(now: number): TrackResult {
  const events: TrackEvent[] = [
    {
      time: new Date(now - 2 * 3_600_000).toISOString(),
      statusCode: "INFORMATION_RECEIVED",
      description: "접수되었습니다",
      location: "서울 강남",
    },
    {
      time: new Date(now - 1 * 3_600_000).toISOString(),
      statusCode: "IN_TRANSIT",
      description: "이동 중입니다",
      location: "옥천HUB",
    },
    {
      time: new Date(now).toISOString(),
      statusCode: "OUT_FOR_DELIVERY",
      description: "배송 출발했습니다",
      location: "강남 배송점",
    },
  ];
  return { lastEvent: events[events.length - 1], events };
}

/** track(carrierId, trackingNumber). 데모 번호면 캔드 결과 반환(외부 호출 우회). carrierId 예: kr.cjlogistics. */
export async function track(
  carrierId: string,
  trackingNumber: string,
  deps: TrackerDeps & { demoTrackingNumber?: string },
): Promise<TrackResult> {
  if (deps.demoTrackingNumber && trackingNumber === deps.demoTrackingNumber) {
    return demoResult(deps.now);
  }
  const data = await graphqlRequest<TrackQueryData>(deps, TRACK_QUERY, { carrierId, trackingNumber });
  const events = (data.track?.events?.edges ?? [])
    .map((edge) => toEvent(edge.node))
    .filter((e): e is TrackEvent => e !== null);
  return { lastEvent: toEvent(data.track?.lastEvent) ?? null, events };
}

/** 지원 택배사 목록(자동인식 검증·미지원 판별용). */
export async function carriers(deps: TrackerDeps): Promise<CarrierInfo[]> {
  const data = await graphqlRequest<CarriersQueryData>(deps, CARRIERS_QUERY, {});
  return (data.carriers?.edges ?? []).map((edge) => ({ id: edge.node.id, name: edge.node.name }));
}
