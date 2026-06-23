import { describe, it, expect } from "@jest/globals";
import type { KeyValueStore } from "./cache";
import {
  type InfoMap,
  loadInfo,
  getInfo,
  setInfo,
  pruneInfo,
  clearInfo,
  memosToInfoMap,
  migrateMemosToInfo,
  transferInfo,
} from "./info";

/** 인메모리 KeyValueStore(memo.test·trash.test 와 동일 패턴). */
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

const INFO_KEY = "unboxing.shipment_info";
const MEMO_KEY = "unboxing.memos";

describe("info — 스토어", () => {
  it("빈 저장소는 빈 맵·빈 정보를 반환한다", async () => {
    const store = memStore();
    expect(await loadInfo({ store })).toEqual({});
    expect(await getInfo("s1", { store })).toEqual({});
  });

  it("setInfo 로 메모+카테고리+금액 저장·getInfo 로 읽기", async () => {
    const store = memStore();
    await setInfo("s1", { memo: "엄마 선물", category: "식품", amount: 12000 }, { store });
    expect(await getInfo("s1", { store })).toEqual({
      memo: "엄마 선물",
      category: "식품",
      amount: 12000,
    });
  });

  it("빈 메모는 memo 필드를 저장하지 않는다", async () => {
    const store = memStore();
    await setInfo("s1", { memo: "  ", category: "뷰티" }, { store });
    expect(await getInfo("s1", { store })).toEqual({ category: "뷰티" });
  });

  it("메모는 앞뒤 공백을 trim 한다", async () => {
    const store = memStore();
    await setInfo("s1", { memo: "  책  " }, { store });
    expect(await getInfo("s1", { store })).toEqual({ memo: "책" });
  });

  it("미설정 category/amount 는 키 자체를 저장하지 않는다", async () => {
    const store = memStore();
    await setInfo("s1", { memo: "노트북" }, { store });
    const info = await getInfo("s1", { store });
    expect(info).toEqual({ memo: "노트북" });
    expect("category" in info).toBe(false);
    expect("amount" in info).toBe(false);
  });

  it("amount 0 은 유효값으로 저장한다(falsy 제거 금지)", async () => {
    const store = memStore();
    await setInfo("s1", { amount: 0 }, { store });
    expect(await getInfo("s1", { store })).toEqual({ amount: 0 });
  });

  it("빈 문자열 category 는 미설정으로 취급(미저장)", async () => {
    const store = memStore();
    await setInfo("s1", { memo: "x", category: "" }, { store });
    expect(await getInfo("s1", { store })).toEqual({ memo: "x" });
  });

  it("목록 외 레거시 카테고리 값도 저장·표시 허용", async () => {
    const store = memStore();
    await setInfo("s1", { category: "구버전분류" }, { store });
    expect(await getInfo("s1", { store })).toEqual({ category: "구버전분류" });
  });

  it("모든 필드가 빈/미설정이면 해당 id 엔트리를 제거한다", async () => {
    const store = memStore();
    await setInfo("s1", { memo: "x" }, { store });
    await setInfo("s1", { memo: "  ", category: "", amount: undefined }, { store });
    expect("s1" in (await loadInfo({ store }))).toBe(false);
  });

  it("pruneInfo 는 keepIds 에 없는 정보를 정리한다", async () => {
    const store = memStore();
    await setInfo("s1", { memo: "a" }, { store });
    await setInfo("s2", { memo: "b" }, { store });
    await setInfo("s3", { memo: "c" }, { store });
    const pruned = await pruneInfo(["s1", "s3"], { store });
    expect(pruned).toEqual({ s1: { memo: "a" }, s3: { memo: "c" } });
    expect(await loadInfo({ store })).toEqual({ s1: { memo: "a" }, s3: { memo: "c" } });
  });

  it("clearInfo 후엔 빈 맵", async () => {
    const store = memStore();
    await setInfo("s1", { memo: "a" }, { store });
    await clearInfo({ store });
    expect(await loadInfo({ store })).toEqual({});
  });

  it("손상된 JSON 은 빈 맵으로 안전 처리", async () => {
    const store = memStore();
    await store.setItem(INFO_KEY, "{not json");
    expect(await loadInfo({ store })).toEqual({});
  });
});

describe("info — transferInfo", () => {
  it("old 정보(메모+카테고리+금액) → new 로 이동·old 제거", async () => {
    const store = memStore();
    await setInfo("old", { memo: "엄마 선물", category: "식품", amount: 12000 }, { store });
    const map = await transferInfo("old", "new", { store });
    expect(map.new).toEqual({ memo: "엄마 선물", category: "식품", amount: 12000 });
    expect("old" in map).toBe(false);
    expect(await loadInfo({ store })).toEqual({ new: { memo: "엄마 선물", category: "식품", amount: 12000 } });
  });

  it("amount 0 을 보존하며 이관한다(falsy 유실 금지)", async () => {
    const store = memStore();
    await setInfo("old", { amount: 0 }, { store });
    await transferInfo("old", "new", { store });
    expect(await getInfo("new", { store })).toEqual({ amount: 0 });
    expect(await getInfo("old", { store })).toEqual({});
  });

  it("old 에 정보 없음 → new 변화 없음·old 도 없음(no-op)", async () => {
    const store = memStore();
    await setInfo("other", { memo: "유지" }, { store });
    const map = await transferInfo("old", "new", { store });
    expect("new" in map).toBe(false);
    expect("old" in map).toBe(false);
    expect(map).toEqual({ other: { memo: "유지" } });
  });

  it("oldId === newId → 맵 불변(자기 자신 삭제 안 함)", async () => {
    const store = memStore();
    await setInfo("s1", { memo: "내 메모", amount: 0 }, { store });
    const map = await transferInfo("s1", "s1", { store });
    expect(map).toEqual({ s1: { memo: "내 메모", amount: 0 } });
    expect(await getInfo("s1", { store })).toEqual({ memo: "내 메모", amount: 0 });
  });

  it("new 에 기존 정보가 있어도 old 값으로 덮어쓴다", async () => {
    const store = memStore();
    await setInfo("old", { memo: "수정중 택배" }, { store });
    await setInfo("new", { memo: "방금 등록" }, { store });
    await transferInfo("old", "new", { store });
    expect(await getInfo("new", { store })).toEqual({ memo: "수정중 택배" });
    expect(await getInfo("old", { store })).toEqual({});
  });
});

describe("info — memosToInfoMap(순수 변환)", () => {
  it("{id:'t'} → {id:{memo:'t'}}", () => {
    expect(memosToInfoMap({ s1: "엄마 선물", s2: "노트북" })).toEqual({
      s1: { memo: "엄마 선물" },
      s2: { memo: "노트북" },
    });
  });

  it("비문자 값은 스킵한다(손상 안전)", () => {
    const input: Record<string, unknown> = {
      s1: "메모",
      s2: 123,
      s3: null,
      s4: { nested: true },
      s5: ["a"],
    };
    expect(memosToInfoMap(input)).toEqual({ s1: { memo: "메모" } });
  });

  it("문자열은 trim·빈값은 스킵", () => {
    expect(memosToInfoMap({ s1: "  책  ", s2: "   ", s3: "" })).toEqual({ s1: { memo: "책" } });
  });

  it("빈 입력은 빈 맵", () => {
    expect(memosToInfoMap({})).toEqual({});
  });
});

describe("info — migrateMemosToInfo", () => {
  it("구 메모 → 신 정보로 변환·신 키 기록·구 키 제거", async () => {
    const store = memStore();
    await store.setItem(MEMO_KEY, JSON.stringify({ s1: "엄마 선물", s2: "노트북" }));
    const map = await migrateMemosToInfo({ store });
    expect(map).toEqual({ s1: { memo: "엄마 선물" }, s2: { memo: "노트북" } });
    expect(await loadInfo({ store })).toEqual(map);
    expect(await store.getItem(MEMO_KEY)).toBeNull(); // 구 키 제거
  });

  it("멱등하다(2회=1회·데이터 불변)", async () => {
    const store = memStore();
    await store.setItem(MEMO_KEY, JSON.stringify({ s1: "메모" }));
    const first = await migrateMemosToInfo({ store });
    const second = await migrateMemosToInfo({ store });
    expect(second).toEqual(first);
    expect(await loadInfo({ store })).toEqual({ s1: { memo: "메모" } });
  });

  it("신 키 존재 시 그대로(구 키 없으면 no-op)", async () => {
    const store = memStore();
    const existing: InfoMap = { s1: { memo: "기존", category: "식품", amount: 5000 } };
    await store.setItem(INFO_KEY, JSON.stringify(existing));
    const map = await migrateMemosToInfo({ store });
    expect(map).toEqual(existing);
  });

  it("신·구 동시 → 신 우선·구 정리", async () => {
    const store = memStore();
    await store.setItem(INFO_KEY, JSON.stringify({ s2: { memo: "신규" } }));
    await store.setItem(MEMO_KEY, JSON.stringify({ s1: "구버전" }));
    const map = await migrateMemosToInfo({ store });
    expect(map).toEqual({ s2: { memo: "신규" } }); // 신 우선(구 미병합)
    expect(await store.getItem(MEMO_KEY)).toBeNull(); // 구 정리
  });

  it("둘 다 없으면 빈 맵(no-op)", async () => {
    const store = memStore();
    expect(await migrateMemosToInfo({ store })).toEqual({});
    expect(await store.getItem(INFO_KEY)).toBeNull();
  });

  it("손상된 구 JSON·비문자 값은 안전 처리(빈/스킵) 후 구 키 제거", async () => {
    const store = memStore();
    await store.setItem(MEMO_KEY, "{not json");
    const map = await migrateMemosToInfo({ store });
    expect(map).toEqual({});
    expect(await store.getItem(MEMO_KEY)).toBeNull();
  });

  it("구 메모에 비문자 값이 섞여도 문자열만 마이그레이션한다", async () => {
    const store = memStore();
    await store.setItem(MEMO_KEY, JSON.stringify({ s1: "메모", s2: 42, s3: null }));
    const map = await migrateMemosToInfo({ store });
    expect(map).toEqual({ s1: { memo: "메모" } });
  });
});
