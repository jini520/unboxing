import { describe, it, expect } from "@jest/globals";
import { stageProgress, STAGE_PROGRESS_STEPS } from "./stage";

describe("stageProgress", () => {
  it("happy-path 단계는 normal track + 0~4 인덱스", () => {
    expect(stageProgress("등록")).toEqual({ index: 0, track: "normal" });
    expect(stageProgress("집화")).toEqual({ index: 1, track: "normal" });
    expect(stageProgress("이동중")).toEqual({ index: 2, track: "normal" });
    expect(stageProgress("배송출발")).toEqual({ index: 3, track: "normal" });
    expect(stageProgress("배송완료")).toEqual({ index: 4, track: "normal" });
  });

  it("미등록 → pre track(진행 없음)", () => {
    expect(stageProgress("미등록")).toEqual({ index: -1, track: "pre" });
  });

  it("기타 → pre track(진행 추정 안 함)", () => {
    expect(stageProgress("기타")).toEqual({ index: -1, track: "pre" });
  });

  it("예외 → exception track(선형 매핑 금지)", () => {
    expect(stageProgress("예외")).toEqual({ index: -1, track: "exception" });
  });

  it("STAGE_PROGRESS_STEPS 는 등록…배송완료 5단계", () => {
    expect(STAGE_PROGRESS_STEPS).toEqual(["등록", "집화", "이동중", "배송출발", "배송완료"]);
  });
});
