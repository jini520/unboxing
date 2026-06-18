import { describe, it, expect } from "@jest/globals";
import { allSelected, pruneSelected, selectAll, toggleSelected } from "./selection";

describe("toggleSelected", () => {
  it("없으면 추가, 있으면 제거 (비파괴 — 새 Set)", () => {
    const a = new Set<string>();
    const b = toggleSelected(a, "x");
    expect([...b]).toEqual(["x"]);
    expect(a.size).toBe(0); // 원본 불변

    const c = toggleSelected(b, "x");
    expect(c.size).toBe(0);
    expect([...b]).toEqual(["x"]); // 원본 불변
  });

  it("서로 다른 id 는 누적된다", () => {
    let s = new Set<string>();
    s = toggleSelected(s, "a");
    s = toggleSelected(s, "b");
    expect([...s].sort()).toEqual(["a", "b"]);
  });
});

describe("selectAll", () => {
  it("주어진 id 전부를 담은 새 Set", () => {
    expect([...selectAll(["a", "b", "c"])].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("allSelected", () => {
  it("보이는 id 가 모두 선택되면 true", () => {
    expect(allSelected(new Set(["a", "b"]), ["a", "b"])).toBe(true);
  });
  it("하나라도 빠지면 false", () => {
    expect(allSelected(new Set(["a"]), ["a", "b"])).toBe(false);
  });
  it("빈 목록은 false (전체선택할 대상 없음)", () => {
    expect(allSelected(new Set(), [])).toBe(false);
  });
});

describe("pruneSelected (허상 선택 제거)", () => {
  it("목록에 없는 id 는 선택에서 떨군다", () => {
    const out = pruneSelected(new Set(["a", "b", "gone"]), ["a", "b", "c"]);
    expect([...out].sort()).toEqual(["a", "b"]);
  });
  it("전부 사라지면 빈 Set (선택 모드 종료 파생)", () => {
    const out = pruneSelected(new Set(["x", "y"]), ["a"]);
    expect(out.size).toBe(0);
  });
  it("원본 Set 을 변형하지 않는다", () => {
    const src = new Set(["a", "gone"]);
    pruneSelected(src, ["a"]);
    expect([...src].sort()).toEqual(["a", "gone"]);
  });
});
