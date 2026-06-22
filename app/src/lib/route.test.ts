import { describe, it, expect } from "@jest/globals";
import { resolveInitialRoute } from "./route";

describe("resolveInitialRoute (보강③ 콜드스타트 우선순위)", () => {
  it("E17: 알림 딥링크가 있으면 시작화면을 이기고 상세로(최우선)", () => {
    expect(
      resolveInitialRoute({
        lastNotificationResponse: { shipment_id: "abc" },
        homePref: "dashboard",
      }),
    ).toEqual({ kind: "deepLink", path: "/shipment/abc" });
  });

  it("딥링크 없으면 시작화면 preference 를 따른다", () => {
    expect(
      resolveInitialRoute({ lastNotificationResponse: null, homePref: "dashboard" }),
    ).toEqual({ kind: "home", home: "dashboard" });
    expect(resolveInitialRoute({ lastNotificationResponse: null, homePref: "list" })).toEqual({
      kind: "home",
      home: "list",
    });
  });

  it("preference 미설정/실패(null)면 택배함 폴백", () => {
    expect(resolveInitialRoute({ lastNotificationResponse: null, homePref: null })).toEqual({
      kind: "home",
      home: "list",
    });
  });

  it("무효 알림 payload 는 딥링크로 보지 않는다(시작화면 적용)", () => {
    expect(
      resolveInitialRoute({
        lastNotificationResponse: { shipment_id: "" },
        homePref: "dashboard",
      }),
    ).toEqual({ kind: "home", home: "dashboard" });
  });
});
