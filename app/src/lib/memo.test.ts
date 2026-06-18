import { describe, it, expect } from "@jest/globals";
import type { KeyValueStore } from "./cache";
import { loadMemos, setMemo, removeMemo, pruneMemos, clearMemos } from "./memo";

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

describe("memo", () => {
  it("빈 저장소는 빈 맵을 반환한다", async () => {
    expect(await loadMemos({ store: memStore() })).toEqual({});
  });

  it("setMemo 로 저장·갱신, loadMemos 로 읽기", async () => {
    const store = memStore();
    await setMemo("s1", "엄마 선물", { store });
    await setMemo("s2", "노트북", { store });
    expect(await loadMemos({ store })).toEqual({ s1: "엄마 선물", s2: "노트북" });
    await setMemo("s1", "엄마 생신 선물", { store });
    expect((await loadMemos({ store })).s1).toBe("엄마 생신 선물");
  });

  it("앞뒤 공백은 trim 하고, 공백만이면 삭제한다", async () => {
    const store = memStore();
    await setMemo("s1", "  책  ", { store });
    expect((await loadMemos({ store })).s1).toBe("책");
    await setMemo("s1", "   ", { store });
    expect("s1" in (await loadMemos({ store }))).toBe(false);
  });

  it("removeMemo 는 해당 id 만 지운다", async () => {
    const store = memStore();
    await setMemo("s1", "a", { store });
    await setMemo("s2", "b", { store });
    await removeMemo("s1", { store });
    expect(await loadMemos({ store })).toEqual({ s2: "b" });
  });

  it("pruneMemos 는 keepIds 에 없는 메모를 정리한다(삭제된 송장)", async () => {
    const store = memStore();
    await setMemo("s1", "a", { store });
    await setMemo("s2", "b", { store });
    await setMemo("s3", "c", { store });
    const pruned = await pruneMemos(["s1", "s3"], { store });
    expect(pruned).toEqual({ s1: "a", s3: "c" });
    expect(await loadMemos({ store })).toEqual({ s1: "a", s3: "c" });
  });

  it("clearMemos 후엔 빈 맵", async () => {
    const store = memStore();
    await setMemo("s1", "a", { store });
    await clearMemos({ store });
    expect(await loadMemos({ store })).toEqual({});
  });

  it("손상된 JSON 은 빈 맵으로 안전 처리", async () => {
    const store = memStore();
    await store.setItem("unboxing.memos", "{not json");
    expect(await loadMemos({ store })).toEqual({});
  });
});
