import { describe, it, expect } from "@jest/globals";
import type { Stage } from "./api";
import { stageBucket, isImminent } from "./bucket";

const ALL_STAGES: Stage[] = [
  "미등록",
  "등록",
  "집화",
  "이동중",
  "배송출발",
  "배송완료",
  "예외",
  "기타",
];

describe("stageBucket (단일 출처 — 보강①)", () => {
  it("진행중 = 미등록·등록·집화·이동중·배송출발·기타", () => {
    for (const s of ["미등록", "등록", "집화", "이동중", "배송출발", "기타"] as Stage[]) {
      expect(stageBucket(s)).toBe("진행중");
    }
  });

  it("완료 = 배송완료", () => {
    expect(stageBucket("배송완료")).toBe("완료");
  });

  it("예외 = 예외", () => {
    expect(stageBucket("예외")).toBe("예외");
  });

  it("8단계 전수 매핑(누락 0)", () => {
    for (const s of ALL_STAGES) {
      expect(["진행중", "완료", "예외"]).toContain(stageBucket(s));
    }
  });

  it("진행중·완료·예외는 상호 배타(각 단계는 정확히 한 버킷)", () => {
    const buckets = ALL_STAGES.map(stageBucket);
    expect(buckets.filter((b) => b === "완료")).toHaveLength(1); // 배송완료
    expect(buckets.filter((b) => b === "예외")).toHaveLength(1); // 예외
    expect(buckets.filter((b) => b === "진행중")).toHaveLength(6); // 나머지 전부
  });
});

describe("isImminent", () => {
  it("배송출발만 true(진행중의 부분집합)", () => {
    for (const s of ALL_STAGES) {
      expect(isImminent(s)).toBe(s === "배송출발");
    }
  });

  it("임박은 진행중과 겹친다(배송출발은 진행중 버킷)", () => {
    expect(isImminent("배송출발")).toBe(true);
    expect(stageBucket("배송출발")).toBe("진행중");
  });
});
