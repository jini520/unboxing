import { describe, it, expect } from "vitest";
import { shouldNotify, NOTIFYING_STAGES } from "./notify";
import type { Stage } from "./polling";

describe("NOTIFYING_STAGES", () => {
  it("알림 대상은 등록·집화·이동중·배송출발·배송완료·예외", () => {
    expect([...NOTIFYING_STAGES].sort()).toEqual(
      (["등록", "집화", "이동중", "배송출발", "배송완료", "예외"] as Stage[]).sort(),
    );
  });

  it("이동중은 알림 대상(첫 진입 1회 — ADR-030)", () => {
    expect(NOTIFYING_STAGES.has("이동중")).toBe(true);
  });

  it("기타·미등록은 알림 대상이 아니다", () => {
    expect(NOTIFYING_STAGES.has("기타")).toBe(false);
    expect(NOTIFYING_STAGES.has("미등록")).toBe(false);
  });
});

describe("shouldNotify (단계 전환 알림 판단)", () => {
  const cases: [Stage | null, Stage, boolean][] = [
    [null, "등록", true], // 첫 관측이 알림 대상
    [null, "미등록", false], // 첫 관측이지만 무알림 단계
    ["등록", "등록", false], // 재관측, 멱등
    ["배송출발", "배송완료", true],
    ["집화", "이동중", true], // 이동중 첫 진입 → 알림(ADR-030)
    [null, "이동중", true], // 집화 건너뛴 직행도 첫 진입 1회
    ["이동중", "이동중", false], // 이동중 재관측(터미널 입→출고) → 최초 1회 잠금
    ["이동중", "배송출발", true],
    ["배송완료", "배송완료", false],
    ["등록", "기타", false], // 기타 무알림
  ];

  for (const [prev, next, expected] of cases) {
    it(`${prev ?? "null"} → ${next} = ${expected}`, () => {
      expect(shouldNotify(prev, next)).toBe(expected);
    });
  }
});

describe("shouldNotify (멱등성 — 재관측 무발송)", () => {
  it("같은 단계 재관측은 알림 대상 단계라도 false", () => {
    for (const stage of NOTIFYING_STAGES) {
      expect(shouldNotify(stage, stage)).toBe(false);
    }
  });
});

describe("shouldNotify (무알림 단계로의 전환은 무조건 false)", () => {
  it("기타·미등록 으로의 전환은 prev 무관 false", () => {
    const silent: Stage[] = ["기타", "미등록"];
    const anyPrev: (Stage | null)[] = [null, "등록", "집화", "이동중", "배송출발", "예외"];
    for (const next of silent) {
      for (const prev of anyPrev) {
        expect(shouldNotify(prev, next)).toBe(false);
      }
    }
  });
});
