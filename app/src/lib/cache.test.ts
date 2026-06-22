import { describe, it, expect } from "@jest/globals";
import type { NotificationRecord, Shipment } from "./api";
import type { KeyValueStore } from "./cache";
import {
  cacheNotifications,
  cacheShipments,
  clearCache,
  readCachedNotifications,
  readCachedShipments,
} from "./cache";

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
  { id: "s1", carrier: "kr.cjlogistics", trackingNo: "1234", status: "배송출발", active: true, createdAt: 100, statusChangedAt: 100, muted: false },
  { id: "s2", carrier: "kr.epost", trackingNo: "5678", status: "배송완료", active: false, createdAt: 200, statusChangedAt: 200, muted: false },
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

const NOTIFS: NotificationRecord[] = [
  { id: "n1", shipmentId: "s1", carrier: "kr.cjlogistics", last4: "1234", body: "배송 완료 ✓", stage: "배송완료", sentAt: 1700 },
  { id: "n2", shipmentId: null, carrier: "kr.epost", last4: "5678", body: "접수 확인", stage: "등록", sentAt: 1600 },
];

describe("notifications cache", () => {
  it("cacheNotifications → readCachedNotifications 라운드트립(list 보존)", async () => {
    const store = memStore();
    await cacheNotifications(NOTIFS, { store, now: 9000 });
    expect(await readCachedNotifications({ store })).toEqual(NOTIFS);
  });

  it("빈 캐시는 null 을 반환한다", async () => {
    const store = memStore();
    expect(await readCachedNotifications({ store })).toBeNull();
  });

  it("손상 JSON 은 null 로 graceful 처리한다", async () => {
    const store = memStore();
    await store.setItem("unboxing.notifications_cache", "{broken");
    expect(await readCachedNotifications({ store })).toBeNull();
  });

  it("clearCache 는 알림 캐시도 함께 폐기한다(wipe 커버리지)", async () => {
    const store = memStore();
    await cacheShipments(SHIPMENTS, { store, now: 1 });
    await cacheNotifications(NOTIFS, { store, now: 1 });
    await clearCache({ store });
    expect(await readCachedShipments({ store })).toBeNull();
    expect(await readCachedNotifications({ store })).toBeNull();
  });
});
