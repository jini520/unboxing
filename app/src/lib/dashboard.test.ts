import { describe, it, expect } from "@jest/globals";
import type { Shipment, Stage } from "./api";
import { dashboardCounts } from "./dashboard";

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

const NOW = Date.parse("2026-06-23T14:00:00+09:00"); // KST 06-23 14:00
const base = {
  trashCount: 0,
  unreadCount: 0,
  now: NOW,
  amounts: {} as Record<string, number | undefined>,
};

describe("dashboardCounts", () => {
  it("빈 목록 → 모든 카운트 0", () => {
    expect(dashboardCounts([], base)).toEqual({
      inProgress: 0,
      completed: 0,
      exception: 0,
      arrivingToday: 0,
      trash: 0,
      unread: 0,
      amountTeaser: { total: 0, partial: false },
    });
  });

  it("혼합 목록 → 버킷별 정확(stageBucket 사용)", () => {
    const list = [
      ship({ id: "a", status: "이동중" }),
      ship({ id: "b", status: "배송출발" }),
      ship({ id: "c", status: "배송완료" }),
      ship({ id: "d", status: "예외" }),
      ship({ id: "e", status: "미등록" }),
    ];
    const c = dashboardCounts(list, base);
    expect(c.inProgress).toBe(3); // 이동중·배송출발·미등록
    expect(c.completed).toBe(1);
    expect(c.exception).toBe(1);
  });

  it("active=0 이 버킷을 바꾸지 않는다(비활성 미등록도 진행중)", () => {
    const list = [
      ship({ id: "x", status: "미등록", active: false }),
      ship({ id: "y", status: "예외", active: false }),
    ];
    const c = dashboardCounts(list, base);
    expect(c.inProgress).toBe(1);
    expect(c.exception).toBe(1);
  });

  it("trashCount·unreadCount 를 통과한다", () => {
    const c = dashboardCounts([], { ...base, trashCount: 5, unreadCount: 3 });
    expect(c.trash).toBe(5);
    expect(c.unread).toBe(3);
  });

  it("arrivingToday: 배송출발 ∩ KST 당일만", () => {
    const list = [
      ship({
        id: "today",
        status: "배송출발",
        statusChangedAt: Date.parse("2026-06-23T09:00:00+09:00"),
      }),
      ship({
        id: "yesterday",
        status: "배송출발",
        statusChangedAt: Date.parse("2026-06-22T23:00:00+09:00"),
      }),
      ship({
        id: "moving-today",
        status: "이동중",
        statusChangedAt: Date.parse("2026-06-23T10:00:00+09:00"),
      }),
    ];
    expect(dashboardCounts(list, base).arrivingToday).toBe(1);
  });
});

describe("dashboardCounts — 금액 teaser", () => {
  function teaser(list: Shipment[], amounts: Record<string, number | undefined>, now = NOW) {
    return dashboardCounts(list, { trashCount: 0, unreadCount: 0, now, amounts }).amountTeaser;
  }
  const thisMonth = (id: string, day = "10"): Shipment =>
    ship({ id, status: "이동중", createdAt: Date.parse(`2026-06-${day}T00:00:00+09:00`) });

  it("이번 달 입력 건 합산", () => {
    expect(teaser([thisMonth("a", "10"), thisMonth("b", "20")], { a: 10000, b: 5000 })).toEqual({
      total: 15000,
      partial: false,
    });
  });

  it("일부만 입력 → partial true, 입력분만 합산", () => {
    expect(teaser([thisMonth("a", "10"), thisMonth("b", "20")], { a: 10000 })).toEqual({
      total: 10000,
      partial: true,
    });
  });

  it("전부 미입력 → total 0·partial false", () => {
    expect(teaser([thisMonth("a")], {})).toEqual({ total: 0, partial: false });
  });

  it("지난 달 createdAt 은 제외", () => {
    const list = [
      thisMonth("now", "10"),
      ship({ id: "last", status: "이동중", createdAt: Date.parse("2026-05-30T00:00:00+09:00") }),
    ];
    expect(teaser(list, { now: 3000, last: 9999 })).toEqual({ total: 3000, partial: false });
  });

  it("KST 월 경계(UTC+9): UTC 기준 같은 달이라도 KST 월로 분리", () => {
    const now = Date.parse("2026-07-01T00:30:00+09:00"); // KST 07-01 (UTC 06-30 15:30)
    const list = [
      // UTC 06-30 16:00 = KST 07-01 → 이번 달(7월)
      ship({ id: "july", status: "이동중", createdAt: Date.parse("2026-07-01T01:00:00+09:00") }),
      // UTC 06-30 14:00 = KST 06-30 → 지난 달(6월), UTC 로는 둘 다 6월이지만 KST 로 분리
      ship({ id: "june", status: "이동중", createdAt: Date.parse("2026-06-30T23:00:00+09:00") }),
    ];
    expect(teaser(list, { july: 1000, june: 2000 }, now)).toEqual({ total: 1000, partial: false });
  });

  it("음수·undefined 금액은 합산 제외(미입력 취급 → partial)", () => {
    const list = [thisMonth("a", "10"), thisMonth("b", "11"), thisMonth("c", "12")];
    // a=정상, b=음수(무효), c=undefined → total=a, 입력 1/3 → partial
    expect(teaser(list, { a: 7000, b: -5, c: undefined })).toEqual({ total: 7000, partial: true });
  });
});
