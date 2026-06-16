/**
 * 송장 목록 정렬 — 순수. docs/PRD.md "UX 세부"(목록 정렬: 진행 중 우선, 임박·예외 강조).
 * 우선순위: 배송출발(임박) > 예외 > 그 외 진행 중 > 배송완료 > 비활성. 동순위는 최신(createdAt desc).
 * 비파괴(입력 배열 보존) — 새 배열을 반환한다.
 */
import type { Shipment } from "./api";

/** 낮을수록 위. 비활성(active=false)은 단계와 무관하게 맨 아래. */
function rank(s: Shipment): number {
  if (!s.active) return 4;
  switch (s.status) {
    case "배송출발":
      return 0;
    case "예외":
      return 1;
    case "배송완료":
      return 3;
    default:
      return 2; // 미등록·등록·집화·이동중·기타
  }
}

export function sortShipments(list: Shipment[]): Shipment[] {
  return [...list].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return b.createdAt - a.createdAt; // 최신 먼저
  });
}
