import { describe, it, expect } from "@jest/globals";
import type { Shipment } from "./api";
import type { KeyValueStore } from "./cache";
import { cacheShipments, readCachedShipments, clearCache } from "./cache";

/** 인메모리 KeyValueStore. */
function memStore() {
  const store: Record<string, string> = {};
  const kv: KeyValueStore = {
    getItem: async (k) => (k in store ? store[k] : null),
    setItem: async (k, v) => {
      store[k] = v;
    },
    removeItem: async (k) => {
      delete store[k];
    },
  };
  return kv;
}

const SHIPMENTS: Shipment[] = [
  { id: "s1", carrier: "kr.cjlogistics", trackingNo: "1234", status: "배송출발", active: true, createdAt: 100 },
  { id: "s2", carrier: "kr.epost", trackingNo: "5678", status: "배송완료", active: false, createdAt: 200 },
];

describe("cache", () => {
  it("cacheShipments → readCachedShipments 라운드트립(list·cachedAt 보존)", async () => {
    const store = memStore();
    await cacheShipments(SHIPMENTS, { store, now: 1700 });
    const cached = await readCachedShipments({ store });
    expect(cached).toEqual({ list: SHIPMENTS, cachedAt: 1700 });
  });

  it("빈 캐시는 null 을 반환한다", async () => {
    const store = memStore();
    expect(await readCachedShipments({ store })).toBeNull();
  });

  it("clearCache 후엔 null 을 반환한다", async () => {
    const store = memStore();
    await cacheShipments(SHIPMENTS, { store, now: 1700 });
    await clearCache({ store });
    expect(await readCachedShipments({ store })).toBeNull();
  });

  it("cachedAt 은 주입한 now 를 그대로 쓴다(Date.now 비의존)", async () => {
    const store = memStore();
    await cacheShipments(SHIPMENTS, { store, now: 42 });
    const cached = await readCachedShipments({ store });
    expect(cached?.cachedAt).toBe(42);
  });
});
