/**
 * 택배함 "완료 숨기기" 필터(순수 로직). ROADMAP v1.1 Bug Fix A2 — 필터 칩(전체/진행중/임박/완료/예외)을
 * 전면 제거하고 hideCompleted 토글만 남긴다(설정→택배함으로 이동한 지속 토글).
 * **정렬하지 않는다** — filter→sort 는 별개 단계라 sortShipments 는 호출부에서 이후 적용한다.
 * 입력 순서를 보존하고(Array.filter), 입력 배열을 변형하지 않는다(비파괴).
 */
import type { Shipment } from "./api";

export function filterShipments(
  list: Shipment[],
  { hideCompleted }: { hideCompleted: boolean },
): Shipment[] {
  // hideCompleted=true 면 배송완료만 제외, false 면 입력 그대로(얕은 복사로 비파괴 유지).
  return hideCompleted ? list.filter((s) => s.status !== "배송완료") : [...list];
}
