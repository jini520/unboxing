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

describe("filterShipments", () => {
  it("전체(hideCompleted=false) → 전부", () => {
    expect(ids(filterShipments(MIXED, "전체", { hideCompleted: false }))).toEqual([
      "reg",
      "move",
      "out",
      "done",
      "exc",
      "unreg",
    ]);
  });

  it("전체 + hideCompleted → 배송완료 제외", () => {
    expect(ids(filterShipments(MIXED, "전체", { hideCompleted: true }))).toEqual([
      "reg",
      "move",
      "out",
      "exc",
      "unreg",
    ]);
  });

  it("진행중 → 진행중 버킷(완료·예외 제외)", () => {
    expect(ids(filterShipments(MIXED, "진행중", { hideCompleted: false }))).toEqual([
      "reg",
      "move",
      "out",
      "unreg",
    ]);
  });

  it("임박 → 배송출발만", () => {
    expect(ids(filterShipments(MIXED, "임박", { hideCompleted: false }))).toEqual(["out"]);
  });

  it("완료 → 배송완료만", () => {
    expect(ids(filterShipments(MIXED, "완료", { hideCompleted: false }))).toEqual(["done"]);
  });

  it("예외 → 예외만", () => {
    expect(ids(filterShipments(MIXED, "예외", { hideCompleted: false }))).toEqual(["exc"]);
  });

  it("E15: hideCompleted ON 이어도 명시 완료 칩은 완료를 보여준다(명시 우선)", () => {
    expect(ids(filterShipments(MIXED, "완료", { hideCompleted: true }))).toEqual(["done"]);
  });

  it("결과 0건과 입력 0건을 구분할 수 있다(빈 배열 반환·호출부가 list.length 비교)", () => {
    const onlyDone = [ship("d", "배송완료")];
    expect(filterShipments(onlyDone, "예외", { hideCompleted: false })).toEqual([]); // 결과 0
    expect(onlyDone.length).toBe(1); // 입력은 0 아님 → "조건에 맞는 택배 없음" 안내
    expect(filterShipments([], "예외", { hideCompleted: false })).toEqual([]); // 입력 0
  });

  it("순서·정렬을 바꾸지 않는다(sortShipments 와 달리 입력 순서 보존)", () => {
    // 정렬했다면 배송출발이 배송완료보다 앞으로 왔을 것 — filter 는 입력 순서 그대로.
    const list = [ship("done", "배송완료"), ship("out", "배송출발")];
    expect(ids(filterShipments(list, "전체", { hideCompleted: false }))).toEqual(["done", "out"]);
  });

  it("입력 배열을 변형하지 않는다(비파괴)", () => {
    const before = ids(MIXED);
    filterShipments(MIXED, "전체", { hideCompleted: false });
    expect(ids(MIXED)).toEqual(before);
  });
});
