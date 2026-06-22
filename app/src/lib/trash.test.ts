import { describe, it, expect } from "@jest/globals";
import type { KeyValueStore } from "./cache";
import {
  type TrashSnapshot,
  MAX_TRASH,
  trashKey,
  loadTrash,
  addTrash,
  pruneTrash,
  reconcileTrash,
  removeTrash,
  clearTrash,
} from "./trash";

/** 인메모리 KeyValueStore(memo.test 와 동일 패턴). */
function memStore(): KeyValueStore {
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

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const HOUR = 3_600_000;

function snap(carrier: string, trackingNo: string, over: Partial<TrashSnapshot> = {}): TrashSnapshot {
  return {
    carrier,
    trackingNo,
    status: "이동중",
    createdAt: NOW - DAY,
    statusChangedAt: NOW - HOUR,
    ...over,
  };
}

describe("trash", () => {
  it("빈 저장소는 빈 맵을 반환한다", async () => {
    expect(await loadTrash({ store: memStore() })).toEqual({});
  });

  it("trashKey 는 carrier:trackingNo 형식이다", () => {
    expect(trashKey("kr.cjlogistics", "522093451360")).toBe("kr.cjlogistics:522093451360");
  });

  it("addTrash 는 키·info 스냅샷·deletedAt=now 로 적재한다", async () => {
    const store = memStore();
    await addTrash(snap("kr.cjlogistics", "1", { info: { memo: "엄마 선물", category: "식품", amount: 12000 } }), {
      store,
      now: NOW,
    });
    const map = await loadTrash({ store });
    expect(map).toEqual({
      "kr.cjlogistics:1": {
        carrier: "kr.cjlogistics",
        trackingNo: "1",
        status: "이동중",
        createdAt: NOW - DAY,
        statusChangedAt: NOW - HOUR,
        info: { memo: "엄마 선물", category: "식품", amount: 12000 },
        deletedAt: NOW,
      },
    });
  });

  it("info 없는 스냅샷도 적재된다(info 미포함)", async () => {
    const store = memStore();
    await addTrash(snap("kr.a", "1"), { store, now: NOW });
    const entry = (await loadTrash({ store }))["kr.a:1"];
    expect(entry.info).toBeUndefined();
    expect(entry.deletedAt).toBe(NOW);
  });

  it("같은 키 재삭제는 덮어쓴다(최신 deletedAt)", async () => {
    const store = memStore();
    await addTrash(snap("kr.a", "1", { info: { memo: "구버전" } }), { store, now: NOW });
    await addTrash(snap("kr.a", "1", { info: { memo: "최신" } }), { store, now: NOW + DAY });
    const map = await loadTrash({ store });
    expect(Object.keys(map)).toHaveLength(1);
    expect(map["kr.a:1"].deletedAt).toBe(NOW + DAY);
    expect(map["kr.a:1"].info).toEqual({ memo: "최신" });
  });

  it("pruneTrash 는 30일 경과분을 제거하고 창 내는 보존한다", async () => {
    const store = memStore();
    await addTrash(snap("kr.a", "old"), { store, now: NOW - 31 * DAY }); // 만료
    await addTrash(snap("kr.b", "edge"), { store, now: NOW - 30 * DAY }); // 경계(미만 아님 → 보존)
    await addTrash(snap("kr.c", "fresh"), { store, now: NOW - 29 * DAY }); // 보존
    const map = await pruneTrash({ store, now: NOW });
    expect(Object.keys(map).sort()).toEqual(["kr.b:edge", "kr.c:fresh"]);
    expect(await loadTrash({ store })).toEqual(map); // 영속까지 반영
  });

  it("pruneTrash 는 용량 상한 초과 시 오래된 것부터 정리한다", async () => {
    const store = memStore();
    for (let i = 0; i < MAX_TRASH + 5; i++) {
      await addTrash(snap("kr.x", `t${i}`), { store, now: NOW + i }); // deletedAt 오름차순
    }
    const map = await pruneTrash({ store, now: NOW + MAX_TRASH + 100 }); // 전부 창 내
    expect(Object.keys(map)).toHaveLength(MAX_TRASH);
    // 가장 오래된 5건(t0~t4) 제거, 최신은 보존
    for (let i = 0; i < 5; i++) expect(map[`kr.x:t${i}`]).toBeUndefined();
    expect(map[`kr.x:t${MAX_TRASH + 4}`]).toBeDefined();
  });

  it("reconcileTrash 는 서버 목록에 다시 나타난 키를 제거한다(E4)", async () => {
    const store = memStore();
    await addTrash(snap("kr.a", "1"), { store, now: NOW });
    await addTrash(snap("kr.b", "2"), { store, now: NOW });
    const map = await reconcileTrash(new Set([trashKey("kr.a", "1")]), { store });
    expect(Object.keys(map)).toEqual(["kr.b:2"]);
    expect(await loadTrash({ store })).toEqual(map);
  });

  it("removeTrash 는 해당 키만 지운다", async () => {
    const store = memStore();
    await addTrash(snap("kr.a", "1"), { store, now: NOW });
    await addTrash(snap("kr.b", "2"), { store, now: NOW });
    await removeTrash("kr.a:1", { store });
    expect(Object.keys(await loadTrash({ store }))).toEqual(["kr.b:2"]);
  });

  it("clearTrash 후엔 빈 맵", async () => {
    const store = memStore();
    await addTrash(snap("kr.a", "1"), { store, now: NOW });
    await clearTrash({ store });
    expect(await loadTrash({ store })).toEqual({});
  });

  it("손상된 JSON 은 빈 맵으로 안전 처리", async () => {
    const store = memStore();
    await store.setItem("unboxing.trash", "{not json");
    expect(await loadTrash({ store })).toEqual({});
  });
});
