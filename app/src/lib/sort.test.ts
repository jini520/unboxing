import { describe, it, expect } from "@jest/globals";
import type { Shipment } from "./api";
import { sortShipments } from "./sort";

function ship(p: Partial<Shipment> & Pick<Shipment, "id" | "status">): Shipment {
  return {
    carrier: "kr.cjlogistics",
    trackingNo: "1234",
    active: true,
    createdAt: 0,
    statusChangedAt: 0,
    muted: false,
    ...p,
  };
}

describe("sortShipments", () => {
  it("우선순위: 배송출발 > 예외 > 진행 중 > 배송완료 > 비활성", () => {
    const list: Shipment[] = [
      ship({ id: "done", status: "배송완료" }),
      ship({ id: "inactive", status: "이동중", active: false }),
      ship({ id: "exc", status: "예외" }),
      ship({ id: "moving", status: "이동중" }),
      ship({ id: "out", status: "배송출발" }),
    ];
    expect(sortShipments(list).map((s) => s.id)).toEqual([
      "out",
      "exc",
      "moving",
      "done",
      "inactive",
    ]);
  });

  it("동순위는 createdAt 내림차순(최신 먼저)", () => {
    const list: Shipment[] = [
      ship({ id: "old", status: "이동중", createdAt: 100 }),
      ship({ id: "new", status: "이동중", createdAt: 300 }),
      ship({ id: "mid", status: "이동중", createdAt: 200 }),
    ];
    expect(sortShipments(list).map((s) => s.id)).toEqual(["new", "mid", "old"]);
  });

  it("입력 배열을 변형하지 않는다(비파괴)", () => {
    const list: Shipment[] = [
      ship({ id: "a", status: "배송완료" }),
      ship({ id: "b", status: "배송출발" }),
    ];
    const before = list.map((s) => s.id);
    sortShipments(list);
    expect(list.map((s) => s.id)).toEqual(before);
  });
});
