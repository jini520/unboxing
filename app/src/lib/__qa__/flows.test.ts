/**
 * Step 4 (app-flows) — 앱 로직 플로우 QA. 화면 렌더 없이 순수 lib 를 **여정 단위로 조합**해 검증한다.
 * 단위 테스트(device/api/cache/wipe/push/tokens.test.ts)가 각 모듈을 따로 보는 것과 달리, 여기선
 * 여러 모듈을 묶어 사용자 여정의 불변식을 확인한다. 외부 의존(fetch·storage)은 주입 mock — 실 네트워크·네이티브 호출 금지.
 *
 * QA 철칙: 버그를 고치지 않는다. 갭은 it.todo + docs/QA_FINDINGS.md. verify green 유지.
 * 정적 감사(안티패턴·색 단독·에러코드·EXPO_PUBLIC)는 grep 으로 수행해 FINDINGS '정적 감사 결과(Step 4)' 표에 기록.
 */
import { describe, it, expect } from "@jest/globals";
import type { SecureStorage } from "../device";
import { getDeviceId, deleteDeviceId } from "../device";
import type { KeyValueStore } from "../cache";
import { cacheShipments, clearCache, readCachedShipments } from "../cache";
import type { ApiDeps, Shipment } from "../api";
import { ApiError, createShipment, listShipments } from "../api";
import { wipeAllData } from "../wipe";
import { routeForNotification } from "../push";
import { resolveTokens, tokens } from "../../theme/tokens";

const BASE = "https://api.test";

/** 결정적 randomBytes(seed 기반). 같은 seed → 같은 바이트(테스트 재현성). */
function seqRandomBytes(seed: number): (n: number) => Uint8Array {
  return (n) => Uint8Array.from({ length: n }, (_, i) => (seed + i) % 256);
}

/** 인메모리 SecureStorage(device_id) + set 호출 카운터. */
function memSecure() {
  const store: Record<string, string> = {};
  const calls = { set: 0, del: 0 };
  const storage: SecureStorage = {
    getItem: async (k) => (k in store ? store[k] : null),
    setItem: async (k, v) => {
      calls.set++;
      store[k] = v;
    },
    deleteItem: async (k) => {
      calls.del++;
      delete store[k];
    },
  };
  return { storage, calls };
}

/** 인메모리 KeyValueStore(오프라인 캐시). */
function memKV(): KeyValueStore {
  const store: Record<string, string> = {};
  return {
    getItem: async (k) => (k in store ? store[k] : null),
    setItem: async (k, v) => {
      store[k] = v;
    },
    removeItem: async (k) => {
      delete store[k];
    },
  };
}

/** Response 유사 객체(전역 Response 비의존). */
function res(status: number, body?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

interface Recorded {
  url: string;
  method?: string;
  authorization?: string;
}

/** (url, method) → Response 핸들러로 응답하며 Authorization/메서드를 기록하는 주입 fetch. */
function recordingFetch(handler: (url: string, method?: string) => Response) {
  const calls: Recorded[] = [];
  const fetch = (async (url: string, init: { method?: string; headers?: Record<string, string> }) => {
    calls.push({ url, method: init?.method, authorization: init?.headers?.Authorization });
    return handler(url, init?.method);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const RAW = {
  id: "ship-1",
  carrier: "kr.cjlogistics",
  tracking_no: "123456789012",
  status: "등록",
  active: true,
  created_at: 1700000000000,
};

const SHIPMENTS: Shipment[] = [
  { id: "s1", carrier: "kr.cjlogistics", trackingNo: "1234", status: "배송출발", active: true, createdAt: 100 },
  { id: "s2", carrier: "kr.epost", trackingNo: "5678", status: "배송완료", active: false, createdAt: 200 },
];

// ── 여정 1: device_id 영속·재사용 → "내 송장만" 자격 일관성(ADR-007) ───────────────────────
describe("여정: device_id 영속·재사용 (api 호출과 조합)", () => {
  it("같은 기기의 모든 API 호출은 동일한 Bearer<device_id>를 쓴다(생성 1회·재사용)", async () => {
    const { storage, calls: scalls } = memSecure();
    const deviceDeps = { storage, randomBytes: seqRandomBytes(5) };
    const { fetch, calls } = recordingFetch((_url, method) =>
      method === "POST" ? res(201, { shipment: RAW }) : res(200, { shipments: [] }),
    );
    const deps: ApiDeps = { fetch, getDeviceId: () => getDeviceId(deviceDeps), baseUrl: BASE };

    await listShipments(deps);
    await createShipment("kr.cjlogistics", "123456789012", deps);
    const id = await getDeviceId(deviceDeps); // 별도 세션 resolution

    expect(calls[0].authorization).toBe(`Bearer ${id}`);
    expect(calls[1].authorization).toBe(`Bearer ${id}`); // 두 호출이 같은 자격
    expect(scalls.set).toBe(1); // 최초 1회만 저장(이후 재사용·멱등)
    expect(calls[0].url).not.toContain(id); // device_id 는 URL/쿼리스트링에 없다(ADR-007)
  });
});

// ── 여정 2: 에러 매핑 — 전 status 가 catch 가능한 ApiError 로(원시 code 는 내부 분기용, 화면 비노출) ──
describe("여정: api 에러 매핑(에러 매트릭스 완전성)", () => {
  /** 단일 응답 고정 deps. */
  function fixed(response: Response): ApiDeps {
    const { fetch } = recordingFetch(() => response);
    return { fetch, getDeviceId: async () => "dev", baseUrl: BASE };
  }

  it.each([401, 403, 404, 409, 422, 429, 500, 502])(
    "서버 %i → ApiError(status·code 보존; 화면이 친근 카피로 매핑)",
    async (status) => {
      const deps = fixed(res(status, { error: "서버 원문(노출 금지)", code: "SRV_CODE" }));
      const err = (await listShipments(deps).catch((e) => e)) as ApiError;
      expect(err).toBeInstanceOf(ApiError);
      expect(err.status).toBe(status);
      // code 는 화면 분기용으로 보존하되, 화면은 이 code/원문 message 를 렌더하지 않는다(정적 감사 Step 4).
      expect(err.code).toBe("SRV_CODE");
    },
  );

  it("네트워크 throw → ApiError(code:'NETWORK') — 오프라인 분기 신호", async () => {
    const fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof globalThis.fetch;
    const deps: ApiDeps = { fetch, getDeviceId: async () => "dev", baseUrl: BASE };
    const err = (await listShipments(deps).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("NETWORK");
  });
});

// ── 여정 3: 오프라인 읽기 — 서버 갱신 실패 시 마지막 캐시로 폴백(ADR-014) ──────────────────────
describe("여정: 오프라인 읽기 라운드트립(api 실패 → 캐시)", () => {
  it("온라인 동기화(NETWORK)가 실패해도 마지막 캐시 목록을 읽을 수 있다", async () => {
    const store = memKV();
    await cacheShipments(SHIPMENTS, { store, now: 1000 }); // 직전 온라인에서 캐시됨

    const fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof globalThis.fetch;
    const deps: ApiDeps = { fetch, getDeviceId: async () => "dev", baseUrl: BASE };

    const err = (await listShipments(deps).catch((e) => e)) as ApiError;
    expect(err.code).toBe("NETWORK"); // 화면은 오프라인 배너 + 캐시 유지

    const cached = await readCachedShipments({ store });
    expect(cached?.list).toEqual(SHIPMENTS);
    expect(cached?.cachedAt).toBe(1000);
  });
});

// ── 여정 4: 모든 데이터 삭제 오케스트레이션(실제 device·cache 모듈 조합, ADR-017/007) ──────────
describe("여정: wipe 오케스트레이션(서버→캐시→device_id)", () => {
  it("성공: 순서대로 폐기 → 캐시 비고 device_id 는 새로 발급(복구 불가)", async () => {
    const { storage } = memSecure();
    const store = memKV();
    const before = await getDeviceId({ storage, randomBytes: seqRandomBytes(9) });
    await cacheShipments(SHIPMENTS, { store, now: 1 });

    const order: string[] = [];
    await wipeAllData({
      deleteMe: async () => {
        order.push("server");
      },
      clearCache: async () => {
        order.push("cache");
        await clearCache({ store });
      },
      deleteDeviceId: async () => {
        order.push("device");
        await deleteDeviceId({ storage });
      },
    });

    expect(order).toEqual(["server", "cache", "device"]);
    expect(await readCachedShipments({ store })).toBeNull();
    const after = await getDeviceId({ storage, randomBytes: seqRandomBytes(11) });
    expect(after).not.toBe(before); // device_id 실제 폐기 → 새 id(앱이 새 익명 기기가 됨)
  });

  it("서버 삭제 실패: 로컬 보존 → device_id 재사용(재시도 가능)", async () => {
    const { storage } = memSecure();
    const store = memKV();
    const deviceDeps = { storage, randomBytes: seqRandomBytes(9) };
    const before = await getDeviceId(deviceDeps);
    await cacheShipments(SHIPMENTS, { store, now: 1 });

    const run = wipeAllData({
      deleteMe: async () => {
        throw new Error("network");
      },
      clearCache: async () => {
        await clearCache({ store });
      },
      deleteDeviceId: async () => {
        await deleteDeviceId({ storage });
      },
    });
    await expect(run).rejects.toThrow("network");

    // 서버 실패 시 로컬(캐시·device_id)은 손대지 않아 같은 기기로 재시도 가능(ADR-007 자격 보존).
    expect((await readCachedShipments({ store }))?.list).toEqual(SHIPMENTS);
    expect(await getDeviceId(deviceDeps)).toBe(before);
  });
});

// ── 여정 5: 알림 탭 딥링크(routeForNotification) ──────────────────────────────────────────
describe("여정: 알림 탭 → 상세 딥링크", () => {
  it("유효 payload 는 상세 경로, 무효 payload 는 null(내비게이션 안 함)", () => {
    expect(routeForNotification({ shipment_id: "abc" })).toBe("/shipment/abc");
    expect(routeForNotification({ shipment_id: "" })).toBeNull();
    expect(routeForNotification({ other: "x" })).toBeNull();
    expect(routeForNotification(null)).toBeNull();
  });
});

// ── 여정 6: 테마 해석 + 다크 동등 지원(색 단독 금지의 색 출처) ───────────────────────────────
describe("여정: theme resolveTokens", () => {
  it("system→시스템 외형, 미확정→라이트 기준(ADR-016), 고정 선호는 시스템과 무관", () => {
    expect(resolveTokens("system", "dark")).toBe(tokens.dark);
    expect(resolveTokens("system", null)).toBe(tokens.light);
    expect(resolveTokens("system", undefined)).toBe(tokens.light);
    expect(resolveTokens("dark", "light")).toBe(tokens.dark);
    expect(resolveTokens("light", "dark")).toBe(tokens.light);
  });

  it("라이트·다크 모두 5단계 색이 정의된다(다크 동등 지원 — 단계 배지 색 출처)", () => {
    const keys = ["delivered", "outForDelivery", "exception", "neutral", "unregistered"] as const;
    for (const k of keys) {
      expect(tokens.light.stage[k]).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(tokens.dark.stage[k]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

// ── QA-001 후속(앱측 원인) — 데드락의 앱측 뿌리 ────────────────────────────────────────────
// registerDevice(api.ts)는 push_token 을 필수 인자로 받고, 호출처(usePushNotifications·onboarding·settings)는
// 모두 'token' in result / perm.granted 가드 뒤에서만 호출한다. 즉 푸시 거부 시 device 가 서버에 등록되지 않아
// 첫 createShipment 의 Bearer<device_id> 가 미등록 → 서버 401(QA-001 데드락). 앱에는 '푸시 없이 device 등록'
// 익명 경로가 없다. (정적 감사: grep registerDevice → 3 호출처 전부 토큰 가드.) 수정 금지 — FINDINGS QA-001 '앱측 원인'에 기록.
describe("QA-001 후속: 앱측 원인(푸시 없는 익명 device 등록 경로 부재)", () => {
  it.todo("QA-001: 앱이 push_token 없이 device 를 등록하는 익명 경로를 가져야 한다(현재 없음 → 401 데드락)");
});
