/** 상태 정규화 — docs/ARCHITECTURE.md "원문 status.code → 표준 7단계 매핑", ADR-009(코드 상수 맵) */

import type { Stage } from "./polling";

/** 택배사 원문 status.code → 표준 단계. 새 코드 추가는 이 맵에만. */
const STATUS_MAP: Record<string, Stage> = {
  INFORMATION_RECEIVED: "등록",
  AT_PICKUP: "집화",
  IN_TRANSIT: "이동중",
  OUT_FOR_DELIVERY: "배송출발",
  DELIVERED: "배송완료",
  AVAILABLE_FOR_PICKUP: "배송완료",
  ATTEMPT_FAIL: "예외",
  EXCEPTION: "예외",
  UNKNOWN: "기타",
};

/** 택배사 원문 status.code → 표준 단계. 미매핑/알 수 없는 코드는 '기타', 데이터 없음(null/undefined/"")은 '미등록'. */
export function normalizeStatus(code: string | null | undefined): Stage {
  if (!code) return "미등록";
  return STATUS_MAP[code] ?? "기타";
}
