import { describe, it, expect } from "@jest/globals";
import { displayRecipientName } from "./recipient";

describe("displayRecipientName", () => {
  it("부분 마스킹·실명은 trim 한 값을 그대로 표시한다", () => {
    expect(displayRecipientName("김**")).toBe("김**");
    expect(displayRecipientName("이**")).toBe("이**");
    expect(displayRecipientName("김*윤")).toBe("김*윤");
    expect(displayRecipientName("홍길동")).toBe("홍길동");
  });

  it("앞뒤 공백은 trim 한 뒤 표시한다", () => {
    expect(displayRecipientName("  김**  ")).toBe("김**");
  });

  it("플레이스홀더 라벨은 숨긴다(undefined)", () => {
    expect(displayRecipientName("받는 분")).toBeUndefined();
    expect(displayRecipientName("받는분")).toBeUndefined();
    expect(displayRecipientName("수령인")).toBeUndefined();
    expect(displayRecipientName("수취인")).toBeUndefined();
    expect(displayRecipientName("수신인")).toBeUndefined();
    expect(displayRecipientName("고객")).toBeUndefined();
    expect(displayRecipientName("고객님")).toBeUndefined();
    expect(displayRecipientName("본인")).toBeUndefined();
  });

  it("뒤 공백이 붙은 라벨도 trim 후 denylist 에 걸려 숨긴다", () => {
    expect(displayRecipientName("받는 분 ")).toBeUndefined();
    expect(displayRecipientName("  수령인  ")).toBeUndefined();
  });

  it("완전 마스킹(문자 0개)은 숨긴다", () => {
    expect(displayRecipientName("***")).toBeUndefined();
    expect(displayRecipientName("*")).toBeUndefined();
    expect(displayRecipientName("* *")).toBeUndefined();
  });

  it("빈 값·공백·null·undefined 는 숨긴다", () => {
    expect(displayRecipientName("")).toBeUndefined();
    expect(displayRecipientName("   ")).toBeUndefined();
    expect(displayRecipientName(null)).toBeUndefined();
    expect(displayRecipientName(undefined)).toBeUndefined();
  });
});
