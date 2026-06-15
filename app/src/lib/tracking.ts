/** 운송장 번호 유틸 — 국내(Phase 1). docs/design.md "운송장 등록" */

/** 공백·하이픈 제거 (국내 운송장은 숫자). */
export function normalizeTrackingNumber(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

/** 국내 운송장 형식 대략 검증: 정규화 후 9~14자리 숫자. */
export function isValidTrackingNumber(raw: string): boolean {
  const n = normalizeTrackingNumber(raw);
  return /^\d{9,14}$/.test(n);
}
