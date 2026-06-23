/**
 * 택배사 후보 추정(로컬·순수) — 번호 형식 휴리스틱으로 후보를 제시한다. **확정이 아니라 사용자 확인용**.
 * 식별 실패/모호하면 사용자가 드롭다운(CARRIERS 전체)에서 직접 고른다(PRD 핵심 기능 2).
 * carrierId 형식은 tracker.delivery 기준(예: kr.cjlogistics). 운송장 검증은 tracking.ts 단일 출처를 재사용.
 */
import { isValidTrackingNumber, normalizeTrackingNumber } from "./tracking";

export interface CarrierCandidate {
  id: string;
  name: string;
}

/** 국내 주요 택배사(드롭다운 전체 목록). id = tracker.delivery carrierId. */
export const CARRIERS: CarrierCandidate[] = [
  { id: "kr.cjlogistics", name: "CJ대한통운" },
  { id: "kr.epost", name: "우체국택배" },
  { id: "kr.hanjin", name: "한진택배" },
  { id: "kr.lotte", name: "롯데택배" },
  { id: "kr.logen", name: "로젠택배" },
  { id: "kr.kdexp", name: "경동택배" },
  { id: "kr.cupost", name: "CU 편의점택배" },
  { id: "kr.coupangls", name: "쿠팡 로지스틱스" },
];

/** carrierId → 한글 택배사명. 미지원/미상 id 는 그대로 반환(폴백). 목록·상세·알림 표기 단일 출처. */
export function carrierName(id: string): string {
  return CARRIERS.find((c) => c.id === id)?.name ?? id;
}

/** 정규화 후 자릿수 → 후보 carrierId 순서(가능성 높은 순). 미매칭 길이는 흔한 기본값. */
const BY_LENGTH: Record<number, string[]> = {
  13: ["kr.epost", "kr.cjlogistics", "kr.hanjin"],
  12: ["kr.cjlogistics", "kr.lotte", "kr.hanjin"],
  11: ["kr.logen", "kr.cjlogistics"],
  10: ["kr.cjlogistics", "kr.hanjin"],
};

const DEFAULT_ORDER = ["kr.cjlogistics", "kr.epost", "kr.hanjin"];

/**
 * 번호 형식 휴리스틱으로 택배사 후보 추정(로컬). 확정 아님 — 사용자 확인용.
 * 형식이 무효면 빈 배열(추정 불가 → 화면이 수동 선택을 유도).
 */
export function estimateCarriers(trackingNo: string): CarrierCandidate[] {
  if (!isValidTrackingNumber(trackingNo)) return [];
  const n = normalizeTrackingNumber(trackingNo);
  const ids = BY_LENGTH[n.length] ?? DEFAULT_ORDER;
  return ids.map((id) => CARRIERS.find((c) => c.id === id)!);
}

/**
 * 추정 후보 중 "자동 선택"할 carrierId. 후보가 **정확히 1개**일 때만 그 id, 그 외(0개·2개 이상)는 null.
 * 후보가 모호하면(>=2) 자동선택하지 않고 사용자가 드롭다운에서 명시 선택한다(ADR-026, 오선택 방지).
 */
export function autoPickCarrier(candidates: CarrierCandidate[]): string | null {
  return candidates.length === 1 ? candidates[0].id : null;
}
