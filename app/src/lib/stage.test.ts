import { describe, it, expect } from "@jest/globals";
import type { Stage } from "./api";
import {
  stageProgress,
  STAGE_PROGRESS_STEPS,
  STAGE_STATUS_MESSAGE,
  STAGE_SUMMARY,
} from "./stage";

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

describe("STAGE_STATUS_MESSAGE", () => {
  const ALL: Stage[] = [
    "미등록", "등록", "집화", "이동중", "배송출발", "배송완료", "예외", "기타",
  ];

  it("모든 단계에 친절 교정 문구가 있다(빈 문자열 금지)", () => {
    for (const s of ALL) {
      expect(typeof STAGE_STATUS_MESSAGE[s]).toBe("string");
      expect(STAGE_STATUS_MESSAGE[s].length).toBeGreaterThan(0);
    }
  });

  it("happy-path 단계는 간결한 친절 문구로 매핑된다(명사는 '상품' 통일)", () => {
    expect(STAGE_STATUS_MESSAGE["등록"]).toBe("상품 접수");
    expect(STAGE_STATUS_MESSAGE["집화"]).toBe("상품 집화");
    expect(STAGE_STATUS_MESSAGE["이동중"]).toBe("이동 중");
    expect(STAGE_STATUS_MESSAGE["배송출발"]).toBe("배송 출발");
    expect(STAGE_STATUS_MESSAGE["배송완료"]).toBe("배송 완료");
  });

  it("명사는 '물품'·'물건' 없이 '상품'으로만 통일한다", () => {
    for (const m of Object.values(STAGE_STATUS_MESSAGE)) {
      expect(m).not.toMatch(/물품|물건/);
    }
  });

  it("STAGE_SUMMARY 도 모든 단계를 덮는다", () => {
    for (const s of ALL) expect(STAGE_SUMMARY[s].length).toBeGreaterThan(0);
  });
});
