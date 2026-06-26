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
  it("미등록 7일 경과(경계 포함) → deactivate 미등록7일, notify:true ('번호 확인' 안내)", () => {
    expect(lifecycleAction({ stage: "미등록", createdAt: NOW - 7 * DAY, now: NOW })).toEqual({
      type: "deactivate",
      reason: "미등록7일",
      notify: true,
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

// webhook-first 전환(ADR-028·ENGINEERING T7)으로 lifecycle 판정은 폴링 루프에서 **독립 sweep**으로 분리된다.
// webhook 송장은 콜백으로만 갱신돼 재폴링이 거의 없으므로(last_polled_at 이 오래 전), 만약 폴링 안에서
// 판정하면 만료가 누락된다. lifecycleAction 의 입력은 {stage, createdAt, now} 뿐 — last_polled_at 이 없음을
// 잠가, 분리 sweep 이 재폴링 cadence 와 무관하게 동일 판정함을 보증한다(QA F-3 W11 회귀 잠금).
describe("lifecycleAction 폴링 분리 회귀 잠금 (W11·T7 — last_polled_at 무관)", () => {
  it("판정은 createdAt/now 만으로 결정 — 시그니처에 last_polled_at 이 없다", () => {
    // 함수 시그니처가 {stage, createdAt, now} 뿐임을 잠근다(폴링 이력 입력 추가 시 컴파일/이 테스트가 깨짐).
    const input: { stage: Stage; createdAt: number; now: number } = {
      stage: "미등록",
      createdAt: NOW - 8 * DAY,
      now: NOW,
    };
    expect(lifecycleAction(input)).toEqual({
      type: "deactivate",
      reason: "미등록7일",
      notify: true,
    });
  });

  it("미등록7일: 재폴링이 오래 전인 webhook 송장도 동일 비활성 판정", () => {
    expect(lifecycleAction({ stage: "미등록", createdAt: NOW - 9 * DAY, now: NOW })).toEqual({
      type: "deactivate",
      reason: "미등록7일",
      notify: true,
    });
  });

  it("분실의심30일: webhook 등록분(재폴링 ≈0)도 동일 비활성 판정", () => {
    expect(lifecycleAction({ stage: "이동중", createdAt: NOW - 31 * DAY, now: NOW })).toEqual({
      type: "deactivate",
      reason: "분실의심30일",
      notify: true,
    });
  });

  it("예외7일: 폴링 분리 후에도 동일 판정(notify:false)", () => {
    expect(lifecycleAction({ stage: "예외", createdAt: NOW - 8 * DAY, now: NOW })).toEqual({
      type: "deactivate",
      reason: "예외7일",
      notify: false,
    });
  });
});
