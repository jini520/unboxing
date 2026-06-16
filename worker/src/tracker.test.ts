import { describe, it, expect } from "vitest";
import {
  getAccessToken,
  track,
  carriers,
  type TokenStore,
  type TrackerDeps,
} from "./tracker";

const NOW = 1_700_000_000_000; // 고정 시계(epoch ms)

/** 인메모리 TokenStore — D1 없이 캐시 동작 검증. */
function memStore(initial: { token: string; expiresAt: number } | null = null): TokenStore {
  let cur = initial;
  return {
    get: async () => cur,
    set: async (token, expiresAt) => {
      cur = { token, expiresAt };
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchRecorder {
  fetch: typeof fetch;
  /** 호출된 URL 목록(호출 순서대로). */
  urls: string[];
}

/** 엔드포인트(graphql/token)별로 순서대로 응답을 돌려주는 mock fetch. */
function scriptedFetch(script: { token?: unknown[]; graphql?: unknown[] }): FetchRecorder {
  const urls: string[] = [];
  let ti = 0;
  let gi = 0;
  const fn = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    urls.push(url);
    if (url.includes("graphql")) {
      return jsonResponse((script.graphql ?? [])[gi++]);
    }
    return jsonResponse((script.token ?? [])[ti++]);
  }) as unknown as typeof fetch;
  return { fetch: fn, urls };
}

const baseDeps = (store: TokenStore, fetchFn: typeof fetch): TrackerDeps => ({
  fetch: fetchFn,
  now: NOW,
  store,
  clientId: "id",
  clientSecret: "secret",
});

const okTrackBody = {
  data: {
    track: {
      lastEvent: { time: "2026-06-16T10:00:00Z", status: { code: "OUT_FOR_DELIVERY" }, description: "배송출발" },
      events: {
        edges: [
          { node: { time: "2026-06-15T09:00:00Z", status: { code: "INFORMATION_RECEIVED" }, description: "접수" } },
          { node: { time: "2026-06-16T10:00:00Z", status: { code: "OUT_FOR_DELIVERY" }, description: "배송출발" } },
        ],
      },
    },
  },
};

describe("track (정상 응답 파싱)", () => {
  it("errors 없는 본문 → TrackResult로 파싱", async () => {
    const rec = scriptedFetch({ graphql: [okTrackBody] });
    const deps = baseDeps(memStore({ token: "cached", expiresAt: NOW + 3_600_000 }), rec.fetch);

    const result = await track("kr.cjlogistics", "123456789", deps);

    expect(result.lastEvent).toEqual({
      time: "2026-06-16T10:00:00Z",
      statusCode: "OUT_FOR_DELIVERY",
      description: "배송출발",
      location: undefined,
    });
    expect(result.events).toHaveLength(2);
    expect(result.events[0].statusCode).toBe("INFORMATION_RECEIVED");
    // 유효 캐시 토큰 → graphql 1회만, 토큰 발급 호출 없음
    expect(rec.urls.filter((u) => u.includes("graphql"))).toHaveLength(1);
    expect(rec.urls.filter((u) => u.includes("token"))).toHaveLength(0);
  });
});

describe("track (UNAUTHENTICATED 재인증)", () => {
  it("토큰 만료 본문 1회 → 재발급 후 1회 재시도 성공", async () => {
    const rec = scriptedFetch({
      graphql: [{ errors: [{ message: "expired", extensions: { code: "UNAUTHENTICATED" } }] }, okTrackBody],
      token: [{ access_token: "fresh", expires_in: 3600 }],
    });
    const deps = baseDeps(memStore({ token: "cached", expiresAt: NOW + 3_600_000 }), rec.fetch);

    const result = await track("kr.cjlogistics", "123456789", deps);

    expect(result.lastEvent?.statusCode).toBe("OUT_FOR_DELIVERY");
    // graphql 2회(실패→성공) + token 발급 1회
    expect(rec.urls.filter((u) => u.includes("graphql"))).toHaveLength(2);
    expect(rec.urls.filter((u) => u.includes("token"))).toHaveLength(1);
  });

  it("재시도도 UNAUTHENTICATED면 throw (무한 루프 금지)", async () => {
    const authErr = { errors: [{ message: "expired", extensions: { code: "UNAUTHENTICATED" } }] };
    const rec = scriptedFetch({
      graphql: [authErr, authErr],
      token: [{ access_token: "fresh", expires_in: 3600 }],
    });
    const deps = baseDeps(memStore({ token: "cached", expiresAt: NOW + 3_600_000 }), rec.fetch);

    await expect(track("kr.cjlogistics", "1", deps)).rejects.toThrow();
    // graphql 정확히 2회(최초+재시도 1회)에서 멈춘다
    expect(rec.urls.filter((u) => u.includes("graphql"))).toHaveLength(2);
  });
});

describe("getAccessToken (캐싱)", () => {
  it("유효 캐시 토큰 → 재발급 fetch 호출 안 함", async () => {
    const rec = scriptedFetch({});
    const deps = baseDeps(memStore({ token: "cached-valid", expiresAt: NOW + 3_600_000 }), rec.fetch);

    const token = await getAccessToken(deps);

    expect(token).toBe("cached-valid");
    expect(rec.urls).toHaveLength(0);
  });

  it("만료 임박 → 재발급 fetch 호출 + store.set 갱신", async () => {
    const rec = scriptedFetch({ token: [{ access_token: "fresh", expires_in: 3600 }] });
    const store = memStore({ token: "stale", expiresAt: NOW + 30_000 }); // margin(60s) 안 → 만료 취급
    const deps = baseDeps(store, rec.fetch);

    const token = await getAccessToken(deps);

    expect(token).toBe("fresh");
    expect(rec.urls.filter((u) => u.includes("token"))).toHaveLength(1);
    expect(await store.get()).toEqual({ token: "fresh", expiresAt: NOW + 3_600_000 });
  });
});

describe("track (데모 번호)", () => {
  it("데모 번호 → fetch 미호출, 캔드 결과 반환", async () => {
    const rec = scriptedFetch({});
    const deps = { ...baseDeps(memStore(), rec.fetch), demoTrackingNumber: "DEMO-1234" };

    const result = await track("kr.cjlogistics", "DEMO-1234", deps);

    expect(rec.urls).toHaveLength(0);
    expect(result.events).toHaveLength(3);
    expect(result.lastEvent?.statusCode).toBe("OUT_FOR_DELIVERY");
  });

  it("데모 번호와 다른 번호는 외부 호출을 탄다", async () => {
    const rec = scriptedFetch({ graphql: [okTrackBody] });
    const deps = {
      ...baseDeps(memStore({ token: "cached", expiresAt: NOW + 3_600_000 }), rec.fetch),
      demoTrackingNumber: "DEMO-1234",
    };

    await track("kr.cjlogistics", "999", deps);

    expect(rec.urls.filter((u) => u.includes("graphql"))).toHaveLength(1);
  });
});

describe("carriers (목록 파싱)", () => {
  it("edges → CarrierInfo[]", async () => {
    const rec = scriptedFetch({
      graphql: [
        {
          data: {
            carriers: {
              edges: [
                { node: { id: "kr.cjlogistics", name: "CJ대한통운" } },
                { node: { id: "kr.epost", name: "우체국택배" } },
              ],
            },
          },
        },
      ],
    });
    const deps = baseDeps(memStore({ token: "cached", expiresAt: NOW + 3_600_000 }), rec.fetch);

    const list = await carriers(deps);

    expect(list).toEqual([
      { id: "kr.cjlogistics", name: "CJ대한통운" },
      { id: "kr.epost", name: "우체국택배" },
    ]);
  });
});
