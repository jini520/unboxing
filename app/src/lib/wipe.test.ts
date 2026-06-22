import { describe, it, expect } from "@jest/globals";
import { wipeAllData, clearLocalStores } from "./wipe";
import { type KeyValueStore, clearCache } from "./cache";

/** 인메모리 KeyValueStore + 백킹 객체(키 잔존 검증용). */
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

describe("wipeAllData", () => {
  it("서버(DELETE /me) → 캐시 → 메모 → 로컬 스토어 → device_id 순으로 모두 폐기한다", async () => {
    const calls: string[] = [];
    await wipeAllData({
      deleteMe: async () => {
        calls.push("deleteMe");
      },
      clearCache: async () => {
        calls.push("clearCache");
      },
      clearMemos: async () => {
        calls.push("clearMemos");
      },
      clearLocal: async () => {
        calls.push("clearLocal");
      },
      deleteDeviceId: async () => {
        calls.push("deleteDeviceId");
      },
    });
    expect(calls).toEqual([
      "deleteMe",
      "clearCache",
      "clearMemos",
      "clearLocal",
      "deleteDeviceId",
    ]);
  });

  it("서버 삭제 실패 시 로컬은 보존하고(재시도 가능) 에러를 전파한다", async () => {
    const calls: string[] = [];
    const run = wipeAllData({
      deleteMe: async () => {
        calls.push("deleteMe");
        throw new Error("network");
      },
      clearCache: async () => {
        calls.push("clearCache");
      },
      clearMemos: async () => {
        calls.push("clearMemos");
      },
      clearLocal: async () => {
        calls.push("clearLocal");
      },
      deleteDeviceId: async () => {
        calls.push("deleteDeviceId");
      },
    });
    await expect(run).rejects.toThrow("network");
    // 서버가 실패하면 로컬 폐기는 호출되지 않는다.
    expect(calls).toEqual(["deleteMe"]);
  });
});

describe("clearLocalStores → wipeAllData (E19: 신규 로컬 키 누락 0)", () => {
  it("v1.1 로컬 키 전부(info·trash·읽음·시작화면·필터) + 캐시를 폐기하고 서버 DELETE /me 를 부른다", async () => {
    const { store, data } = memKV({
      "unboxing.shipment_info": "{}",
      "unboxing.trash": "{}",
      "unboxing.notif_last_seen": "123",
      "unboxing.home_screen": "dashboard",
      "unboxing.list_filter": '{"hideCompleted":true}',
      "unboxing.shipments_cache": "{}",
    });
    let deletedMe = false;

    // 운영(settings.doWipe)과 동일한 clearLocalStores 합성으로 폐기한다 — 드리프트 없는 단일 출처 검증.
    await wipeAllData({
      deleteMe: async () => {
        deletedMe = true;
      },
      clearCache: () => clearCache({ store }),
      clearMemos: async () => {},
      clearLocal: () => clearLocalStores(store),
      deleteDeviceId: async () => {},
    });

    expect(deletedMe).toBe(true);
    // 신규 로컬 키 전부 + 캐시 키가 사라졌는지(누락 0).
    for (const key of [
      "unboxing.shipment_info",
      "unboxing.trash",
      "unboxing.notif_last_seen",
      "unboxing.home_screen",
      "unboxing.list_filter",
      "unboxing.shipments_cache",
    ]) {
      expect(data[key]).toBeUndefined();
    }
  });
});
