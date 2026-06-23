import { describe, it, expect } from "@jest/globals";
import type { Shipment, Stage } from "./api";
import { filterShipments } from "./filter";

function ship(id: string, status: Stage, extra: Partial<Shipment> = {}): Shipment {
  return {
    id,
    status,
    carrier: "kr.cjlogistics",
    trackingNo: "1234",
    active: true,
    createdAt: 0,
    statusChangedAt: 0,
    muted: false,
    ...extra,
  };
}

const MIXED: Shipment[] = [
  ship("reg", "등록"),
  ship("move", "이동중"),
  ship("out", "배송출발"),
  ship("done", "배송완료"),
  ship("exc", "예외"),
  ship("unreg", "미등록"),
];

const ids = (l: Shipment[]) => l.map((s) => s.id);

describe("filterShipments (hideCompleted 전용)", () => {
  it("hideCompleted=false → 입력 전부(순서 보존)", () => {
    expect(ids(filterShipments(MIXED, { hideCompleted: false }))).toEqual([
      "reg",
      "move",
      "out",
      "done",
      "exc",
      "unreg",
    ]);
  });

  it("hideCompleted=true → 배송완료만 제외(나머지 순서 보존)", () => {
    expect(ids(filterShipments(MIXED, { hideCompleted: true }))).toEqual([
      "reg",
      "move",
      "out",
      "exc",
      "unreg",
    ]);
  });

  it("빈 입력 → []", () => {
    expect(filterShipments([], { hideCompleted: false })).toEqual([]);
    expect(filterShipments([], { hideCompleted: true })).toEqual([]);
  });

  it("정렬하지 않는다(입력 순서 그대로 — sortShipments 는 별개 단계)", () => {
    // 정렬했다면 배송출발이 배송완료보다 앞으로 왔을 것 — filter 는 입력 순서 그대로.
    const list = [ship("done", "배송완료"), ship("out", "배송출발")];
    expect(ids(filterShipments(list, { hideCompleted: false }))).toEqual(["done", "out"]);
  });

  it("입력 배열을 변형하지 않는다(비파괴)", () => {
    const before = ids(MIXED);
    filterShipments(MIXED, { hideCompleted: true });
    expect(ids(MIXED)).toEqual(before);
  });
});
