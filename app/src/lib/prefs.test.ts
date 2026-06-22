import { describe, it, expect } from "@jest/globals";
import type { KeyValueStore } from "./cache";
import {
  clearHomePref,
  clearListFilter,
  loadHomePref,
  loadListFilter,
  saveHomePref,
  saveListFilter,
} from "./prefs";

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

const HOME_KEY = "unboxing.home_screen";
const FILTER_KEY = "unboxing.list_filter";

describe("시작 화면 preference (ADR-025 — 기본 택배함)", () => {
  it("미설정이면 기본값 list(택배함)", async () => {
    expect(await loadHomePref({ store: memKV().store })).toBe("list");
  });

  it("저장 왕복(list ↔ dashboard)", async () => {
    const { store } = memKV();
    await saveHomePref("dashboard", { store });
    expect(await loadHomePref({ store })).toBe("dashboard");
    await saveHomePref("list", { store });
    expect(await loadHomePref({ store })).toBe("list");
  });

  it("손상/목록 외 값은 기본값 폴백", async () => {
    expect(await loadHomePref({ store: memKV({ [HOME_KEY]: "weird" }).store })).toBe("list");
  });

  it("clearHomePref 가 키를 제거(wipe)", async () => {
    const { store, data } = memKV({ [HOME_KEY]: "dashboard" });
    await clearHomePref({ store });
    expect(data[HOME_KEY]).toBeUndefined();
  });
});

describe("택배함 필터 preference (완료 숨기기만 지속)", () => {
  it("미설정이면 기본값 hideCompleted=false", async () => {
    expect(await loadListFilter({ store: memKV().store })).toEqual({ hideCompleted: false });
  });

  it("저장 왕복", async () => {
    const { store } = memKV();
    await saveListFilter({ hideCompleted: true }, { store });
    expect(await loadListFilter({ store })).toEqual({ hideCompleted: true });
    await saveListFilter({ hideCompleted: false }, { store });
    expect(await loadListFilter({ store })).toEqual({ hideCompleted: false });
  });

  it("손상 JSON·비-boolean 은 기본값 폴백", async () => {
    expect(await loadListFilter({ store: memKV({ [FILTER_KEY]: "not json" }).store })).toEqual({
      hideCompleted: false,
    });
    expect(
      await loadListFilter({ store: memKV({ [FILTER_KEY]: '{"hideCompleted":"yes"}' }).store }),
    ).toEqual({ hideCompleted: false });
  });

  it("clearListFilter 가 키를 제거(wipe)", async () => {
    const { store, data } = memKV({ [FILTER_KEY]: '{"hideCompleted":true}' });
    await clearListFilter({ store });
    expect(data[FILTER_KEY]).toBeUndefined();
  });
});
