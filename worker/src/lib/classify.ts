/**
 * 구매 캡처 분류(v1.1.2) — **순수 헬퍼**(프롬프트 빌드·LLM 응답 파싱). test-first.
 * 결정: docs/ADR.md ADR-036(하이브리드 파이프라인)·037(모델·$0)·038(PII)·039(매핑), docs/ARCHITECTURE.md "v1.1.2".
 *
 * 외부 호출(env.AI.run)은 index.ts 핸들러(handleClassifyPurchase)가 담당하고, 이 모듈은
 * **순수 변환만** 둔다 → 외부 경계(mock) 없이 단위 테스트로 분류 강제·폴백 규칙을 잠근다.
 * CRITICAL(ADR-005): 입력 텍스트·LLM 출력은 어디에도 저장하지 않는다(이 모듈은 메모리 변환만).
 */

/** 분류 모델 — Workers AI 오픈웨이트(OpenAI API 아님·비학습·무료 10k neuron/day). ADR-037. */
export const CLASSIFY_MODEL = "@cf/openai/gpt-oss-120b" as const;

/**
 * 카테고리 화이트리스트 — app/src/lib/info.ts CATEGORIES 9종과 **동일하게 동기화**(드리프트 시 함께 갱신).
 * worker 는 app(react-native cache 의존)을 import 할 수 없어 코드 상수로 미러한다(SUPPORTED_CARRIERS 와 동일 패턴).
 * LLM 출력 category 는 반드시 이 9종 중 하나로 강제 — 그 외/불명이면 null(앱이 미분류 처리). ADR-039.
 */
export const CLASSIFY_CATEGORIES = [
  "식품",
  "생활용품",
  "의류·패션",
  "뷰티",
  "전자·디지털",
  "도서·문구",
  "가구·인테리어",
  "유아·반려",
  "기타",
] as const;

/** 분류 결과 — 앱이 ShipmentInfo(memo←productName·amount←price·category)로 매핑(step 2). */
export interface ClassifyResult {
  productName: string;
  price: number | null;
  category: string | null;
}

/** env.AI.run 입력(OpenAI chat-completions 호환). messages·json 모드·결정성(temperature 0). */
export interface ClassifyPrompt {
  messages: Array<{ role: "system" | "user"; content: string }>;
  response_format: { type: "json_object" };
  temperature: number;
  max_tokens: number;
}

/**
 * 마스킹된 텍스트 → LLM 입력. CATEGORIES 9종을 프롬프트에 주입하고 "총 결제금액" 을 고르도록 유도(ADR-039).
 * 입력은 이미 PII 가 제거된 텍스트(ADR-038) — 시스템 프롬프트도 PII 미출력을 재차 지시(출력측 안전망).
 */
export function buildClassifyPrompt(text: string): ClassifyPrompt {
  const categoryList = CLASSIFY_CATEGORIES.join(", ");
  const system =
    "당신은 한국 온라인 쇼핑 주문내역 텍스트에서 정보를 추출하는 분류기입니다. " +
    "입력은 개인정보가 이미 제거된 텍스트입니다. 아래만 추출해 **JSON 으로만** 답하세요(설명·코드펜스 금지).\n" +
    '형식: {"productName": string, "price": number|null, "category": string|null}\n' +
    '- productName: 대표 상품명 1개(여러 개면 가장 주된 것). 없으면 "".\n' +
    "- price: **총 결제금액**(합계/총 결제금액). 소계·정가·할인액·배송비·적립금이 아닌 실제 결제한 총액. 정수(원). 모르면 null.\n" +
    `- category: 반드시 다음 중 하나 또는 null — ${categoryList}.\n` +
    "- 개인정보(이름·주소·전화·이메일)는 절대 출력하지 마세요.";
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: text },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 1024,
  };
}

/** raw 문자열에서 JSON 객체 추출 — 직접 파싱 실패 시 첫 `{` ~ 마지막 `}` 구간 재시도(코드펜스·프롬프트 잔여 대비). */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s) as unknown;
      return v !== null && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(raw.trim());
  if (direct) return direct;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return tryParse(raw.slice(start, end + 1));
  return null;
}

/** price 정규화 — 0 이상 정수만(원). 숫자/숫자문자열("60,190원") 허용, 음수·소수·비숫자·null → null. */
function normalizePrice(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isInteger(v) && v >= 0 ? v : null;
  }
  if (typeof v === "string") {
    const cleaned = v.replace(/[,\s₩원]/g, "");
    if (!/^\d+$/.test(cleaned)) return null; // 부호·소수점·기타문자 → null(과대치는 앱 parseAmount 가 추가 검증)
    const n = Number(cleaned);
    return Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : null;
  }
  return null;
}

/** category 강제 — CLASSIFY_CATEGORIES 9종 중 하나만 통과, 그 외/불명 → null. */
function normalizeCategory(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return (CLASSIFY_CATEGORIES as readonly string[]).includes(t) ? t : null;
}

/**
 * LLM content(JSON 문자열) → 구조화 결과. **항상 ClassifyResult 반환**(throw 금지 — $0 폴백, ADR-037).
 * JSON 깨짐·비객체·카테고리 밖·price 무효는 모두 안전 폴백(productName ""·price null·category null).
 */
export function parseClassifyResponse(raw: string): ClassifyResult {
  const fallback: ClassifyResult = { productName: "", price: null, category: null };
  const obj = extractJsonObject(raw);
  if (!obj) return fallback;
  return {
    productName: typeof obj.productName === "string" ? obj.productName.trim() : "",
    price: normalizePrice(obj.price),
    category: normalizeCategory(obj.category),
  };
}
