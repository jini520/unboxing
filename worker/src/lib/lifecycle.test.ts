import { describe, it, expect } from "vitest";
import { lifecycleAction, SEVEN_DAYS_MS, THIRTY_DAYS_MS } from "./lifecycle";
import type { Stage } from "./polling";

const NOW = 1_700_000_000_000; // 고정 시계(epoch ms)
const DAY = 24 * 60 * 60 * 1000;

describe("상수", () => {
  it("SEVEN_DAYS_MS · THIRTY_DAYS_MS", () => {
    expect(SEVEN_DAYS_MS).toBe(7 * DAY);
    expect(THIRTY_DAYS_MS).toBe(30 * DAY);
  });
});

describe("lifecycleAction (만료/좀비 판단)", () => {
  it("미등록 7일 경과(경계 포함) → deactivate 미등록7일, notify:false", () => {
    expect(lifecycleAction({ stage: "미등록", createdAt: NOW - 7 * DAY, now: NOW })).toEqual({
      type: "deactivate",
      reason: "미등록7일",
      notify: false,
    });
  });

  it("미등록 6일 → keep (7일 미만)", () => {
    expect(lifecycleAction({ stage: "미등록", createdAt: NOW - 6 * DAY, now: NOW })).toEqual({
      type: "keep",
    });
  });

  it("예외 7일 경과 → deactivate 예외7일, notify:false", () => {
    expect(lifecycleAction({ stage: "예외", createdAt: NOW - 7 * DAY, now: NOW })).toEqual({
      type: "deactivate",
      reason: "예외7일",
      notify: false,
    });
  });

  it("이동중 30일 경과 → deactivate 분실의심30일, notify:true", () => {
    expect(lifecycleAction({ stage: "이동중", createdAt: NOW - 30 * DAY, now: NOW })).toEqual({
      type: "deactivate",
      reason: "분실의심30일",
      notify: true,
    });
  });

  it("배송완료 40일 → keep (만료 대상 아님 — 별도 경로)", () => {
    expect(lifecycleAction({ stage: "배송완료", createdAt: NOW - 40 * DAY, now: NOW })).toEqual({
      type: "keep",
    });
  });

  it("예외 30일 → 예외7일이 30일보다 먼저 걸린다 (우선순위 고정)", () => {
    expect(lifecycleAction({ stage: "예외", createdAt: NOW - 30 * DAY, now: NOW })).toEqual({
      type: "deactivate",
      reason: "예외7일",
      notify: false,
    });
  });
});

describe("lifecycleAction (경계값 정밀)", () => {
  it("30일 정확히 경계 → 분실의심30일", () => {
    expect(lifecycleAction({ stage: "이동중", createdAt: NOW - THIRTY_DAYS_MS, now: NOW })).toEqual({
      type: "deactivate",
      reason: "분실의심30일",
      notify: true,
    });
  });

  it("30일 직전(1ms 모자람) → keep", () => {
    expect(
      lifecycleAction({ stage: "이동중", createdAt: NOW - THIRTY_DAYS_MS + 1, now: NOW }),
    ).toEqual({ type: "keep" });
  });

  it("미등록 7일 직전(1ms 모자람) → keep", () => {
    expect(
      lifecycleAction({ stage: "미등록", createdAt: NOW - SEVEN_DAYS_MS + 1, now: NOW }),
    ).toEqual({ type: "keep" });
  });
});

describe("lifecycleAction (만료 전 단계는 keep)", () => {
  it("진행 단계 + 30일 미만 → keep", () => {
    const stages: Stage[] = ["등록", "집화", "이동중", "배송출발", "기타"];
    for (const stage of stages) {
      expect(lifecycleAction({ stage, createdAt: NOW - 5 * DAY, now: NOW })).toEqual({
        type: "keep",
      });
    }
  });
});
