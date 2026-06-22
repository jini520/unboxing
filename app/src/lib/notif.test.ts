import { describe, it, expect } from "@jest/globals";
import type { KeyValueStore } from "./cache";
import {
  badgeText,
  clearLastSeen,
  initLastSeen,
  loadLastSeen,
  markSeen,
  unreadCount,
} from "./notif";

function memKV(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  const store: KeyValueStore = {
    getItem: async (k) => (k in data ? data[k] : null),
    setItem: async (k, v) => {
      data[k] = v;
    },
    removeItem: async (k) => {
      delete data[k];
    },
  };
  return { store, data };
}

const KEY = "unboxing.notif_last_seen";

describe("unreadCount", () => {
  const notifs = [{ sentAt: 100 }, { sentAt: 200 }, { sentAt: 300 }];

  it("sentAt > lastSeen 인 알림만 센다(같은 시각은 읽음)", () => {
    expect(unreadCount(notifs, 150)).toBe(2);
    expect(unreadCount(notifs, 300)).toBe(0);
    expect(unreadCount(notifs, 0)).toBe(3);
  });

  it("E11: lastSeen 미설정(null)이면 0 — 첫 fetch 미읽음 폭주 방지", () => {
    expect(unreadCount(notifs, null)).toBe(0);
  });

  it("빈 목록은 0", () => {
    expect(unreadCount([], 100)).toBe(0);
  });
});

describe("loadLastSeen", () => {
  it("미설정이면 null, 저장값은 number, 손상값은 null", async () => {
    expect(await loadLastSeen({ store: memKV().store })).toBeNull();
    expect(await loadLastSeen({ store: memKV({ [KEY]: "1500" }).store })).toBe(1500);
    expect(await loadLastSeen({ store: memKV({ [KEY]: "corrupt" }).store })).toBeNull();
  });
});

describe("initLastSeen (보강⑤·E11)", () => {
  it("미설정이면 now 로 초기화하고 반환한다", async () => {
    const { store, data } = memKV();
    expect(await initLastSeen({ store, now: 5000 })).toBe(5000);
    expect(data[KEY]).toBe("5000");
  });

  it("이미 있으면 now 로 덮어쓰지 않는다", async () => {
    const { store, data } = memKV({ [KEY]: "1000" });
    expect(await initLastSeen({ store, now: 9999 })).toBe(1000);
    expect(data[KEY]).toBe("1000");
  });
});

describe("markSeen", () => {
  it("lastSeen = max(now, 최신 sentAt)", async () => {
    const { store, data } = memKV();
    await markSeen({ store, now: 100 }, 500); // 최신 sentAt 가 더 큼
    expect(data[KEY]).toBe("500");
    await markSeen({ store, now: 800 }, 500); // now 가 더 큼
    expect(data[KEY]).toBe("800");
  });

  it("알림이 없으면(latestSentAt 생략=0) now 로", async () => {
    const { store, data } = memKV();
    await markSeen({ store, now: 700 });
    expect(data[KEY]).toBe("700");
  });
});

describe("badgeText", () => {
  it("0 이하는 빈 문자열, 99 초과는 99+", () => {
    expect(badgeText(0)).toBe("");
    expect(badgeText(-1)).toBe("");
    expect(badgeText(5)).toBe("5");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
    expect(badgeText(1000)).toBe("99+");
  });
});

describe("clearLastSeen", () => {
  it("읽음 키를 제거한다(wipe)", async () => {
    const { store, data } = memKV({ [KEY]: "123" });
    await clearLastSeen({ store });
    expect(data[KEY]).toBeUndefined();
  });
});
