/**
 * 금액 파싱/포맷 순수 헬퍼(택배 정보 — ADR-024, 로컬 전용). docs/ARCHITECTURE.md "v1.1 설계 보강 ⑥".
 * 금액은 선택 항목 · **0 이상 정수(원)**. 음수·소수·빈·비숫자·상한 초과는 미저장(parseAmount→undefined).
 * 표시는 천단위 구분 + ₩ 접두. Hermes 의 Intl/toLocaleString 불안정성을 피해 천단위는 정규식으로 직접 구현.
 */

/** 금액 상한(이상 미저장) — 10^10. 0 ≤ amount < AMOUNT_LIMIT 만 유효. */
export const AMOUNT_LIMIT = 10_000_000_000;

/**
 * 금액 입력(숫자 키패드 문자열 또는 number)을 검증해 0 이상 정수만 반환. 그 외는 undefined.
 * - 문자열: 앞뒤 공백 trim 후 **순수 정수 문자열(^\d+$)** 만 허용 — 소수점·기호·쉼표·지수·16진수 거부.
 * - 음수·소수·빈·비숫자·상한(10^10) 이상 → undefined(저장 안 함, 호출부가 인라인 안내).
 */
export function parseAmount(input: string | number): number | undefined {
  let n: number;
  if (typeof input === "number") {
    n = input;
  } else {
    const s = input.trim();
    if (!/^\d+$/.test(s)) return undefined; // 빈·비숫자·소수·음수·쉼표·지수 모두 탈락
    n = Number(s);
  }
  if (!Number.isInteger(n) || n < 0 || n >= AMOUNT_LIMIT) return undefined;
  return n;
}

/** 금액 표시 — 천단위 구분 + ₩. 0→"₩0", undefined→"—"(미입력). */
export function formatAmount(n?: number): string {
  if (n === undefined) return "—";
  const grouped = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₩${grouped}`;
}
