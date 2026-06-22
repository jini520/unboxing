import { describe, it, expect } from "vitest";
import { carrierName } from "./carrier";

describe("carrierName (worker 미러, #9)", () => {
  it("지원 carrierId → 한글 택배사명", () => {
    expect(carrierName("kr.cjlogistics")).toBe("CJ대한통운");
    expect(carrierName("kr.epost")).toBe("우체국택배");
    expect(carrierName("kr.coupangls")).toBe("쿠팡 로지스틱스");
  });

  it("미상/미지원 id 는 원문 폴백", () => {
    expect(carrierName("kr.unknown")).toBe("kr.unknown");
    expect(carrierName("")).toBe("");
  });
});
