import { describe, it, expect } from "vitest";
import {
  buildClassifyPrompt,
  parseClassifyResponse,
  CLASSIFY_CATEGORIES,
  type ClassifyResult,
} from "./classify";

describe("buildClassifyPrompt", () => {
  const p = buildClassifyPrompt("결제금액 60,190원 백팩");

  it("system + user 2개 메시지, user 에 입력 텍스트 그대로", () => {
    expect(p.messages).toHaveLength(2);
    expect(p.messages[0].role).toBe("system");
    expect(p.messages[1].role).toBe("user");
    expect(p.messages[1].content).toBe("결제금액 60,190원 백팩");
  });

  it("system 프롬프트에 CATEGORIES 9종을 모두 주입", () => {
    const sys = p.messages[0].content;
    for (const c of CLASSIFY_CATEGORIES) {
      expect(sys).toContain(c);
    }
  });

  it("결정성·JSON 모드 옵션", () => {
    expect(p.response_format).toEqual({ type: "json_object" });
    expect(p.temperature).toBe(0);
    expect(p.max_tokens).toBeGreaterThan(0);
  });
});

describe("parseClassifyResponse — 정상", () => {
  it("순수 JSON → 필드 그대로", () => {
    const r = parseClassifyResponse('{"productName":"백팩","price":60190,"category":"의류·패션"}');
    expect(r).toEqual<ClassifyResult>({ productName: "백팩", price: 60190, category: "의류·패션" });
  });

  it("코드펜스(```json) 감싸도 추출", () => {
    const raw = "```json\n{\"productName\":\"버즈\",\"price\":189000,\"category\":\"전자·디지털\"}\n```";
    expect(parseClassifyResponse(raw)).toEqual<ClassifyResult>({
      productName: "버즈",
      price: 189000,
      category: "전자·디지털",
    });
  });

  it("앞뒤 산문이 섞여도 첫 { ~ 마지막 } 추출", () => {
    const raw = '다음과 같습니다: {"productName":"라면","price":12000,"category":"식품"} 끝.';
    expect(parseClassifyResponse(raw)).toEqual<ClassifyResult>({
      productName: "라면",
      price: 12000,
      category: "식품",
    });
  });

  it("productName 앞뒤 공백 trim", () => {
    expect(parseClassifyResponse('{"productName":"  책  ","category":"도서·문구"}').productName).toBe("책");
  });
});

describe("parseClassifyResponse — category 강제(ADR-039)", () => {
  it("화이트리스트 밖 → null", () => {
    expect(parseClassifyResponse('{"productName":"x","category":"음식"}').category).toBeNull();
    expect(parseClassifyResponse('{"productName":"x","category":"가전/디지털"}').category).toBeNull();
  });

  it("category 누락/비문자 → null", () => {
    expect(parseClassifyResponse('{"productName":"x"}').category).toBeNull();
    expect(parseClassifyResponse('{"productName":"x","category":123}').category).toBeNull();
  });

  it("9종 각각 통과", () => {
    for (const c of CLASSIFY_CATEGORIES) {
      expect(parseClassifyResponse(`{"productName":"x","category":"${c}"}`).category).toBe(c);
    }
  });
});

describe("parseClassifyResponse — price 검증", () => {
  it("정수 number → 그대로, 0 허용", () => {
    expect(parseClassifyResponse('{"productName":"x","price":0}').price).toBe(0);
    expect(parseClassifyResponse('{"productName":"x","price":1500}').price).toBe(1500);
  });

  it("음수·소수 number → null", () => {
    expect(parseClassifyResponse('{"productName":"x","price":-100}').price).toBeNull();
    expect(parseClassifyResponse('{"productName":"x","price":199.5}').price).toBeNull();
  });

  it("숫자 문자열(콤마·원·₩) → 정수", () => {
    expect(parseClassifyResponse('{"productName":"x","price":"60,190원"}').price).toBe(60190);
    expect(parseClassifyResponse('{"productName":"x","price":"₩ 12,000"}').price).toBe(12000);
  });

  it("부호/소수점 포함 문자열·비숫자 → null", () => {
    expect(parseClassifyResponse('{"productName":"x","price":"-100"}').price).toBeNull();
    expect(parseClassifyResponse('{"productName":"x","price":"199.5"}').price).toBeNull();
    expect(parseClassifyResponse('{"productName":"x","price":"무료"}').price).toBeNull();
  });

  it("price 누락/null → null", () => {
    expect(parseClassifyResponse('{"productName":"x"}').price).toBeNull();
    expect(parseClassifyResponse('{"productName":"x","price":null}').price).toBeNull();
  });
});

describe("parseClassifyResponse — 폴백($0·ADR-037, throw 금지)", () => {
  const ALL_NULL: ClassifyResult = { productName: "", price: null, category: null };

  it("JSON 깨짐 → 안전 폴백", () => {
    expect(parseClassifyResponse("{not json")).toEqual(ALL_NULL);
    expect(parseClassifyResponse("그냥 텍스트")).toEqual(ALL_NULL);
    expect(parseClassifyResponse("")).toEqual(ALL_NULL);
  });

  it("배열·비객체 JSON → 안전 폴백", () => {
    expect(parseClassifyResponse("[1,2,3]")).toEqual(ALL_NULL);
    expect(parseClassifyResponse('"문자열"')).toEqual(ALL_NULL);
    expect(parseClassifyResponse("42")).toEqual(ALL_NULL);
  });

  it("어떤 입력에도 throw 하지 않는다", () => {
    expect(() => parseClassifyResponse("")).not.toThrow();
    expect(() => parseClassifyResponse("{}")).not.toThrow();
    expect(() => parseClassifyResponse("{{{")).not.toThrow();
  });
});
