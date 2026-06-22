/**
 * 택배함 필터(순수 로직). docs/ARCHITECTURE.md "v1.1 설계 보강 ①", PRD "v1.1" 6.택배함 필터.
 * stageBucket 단일 출처 사용(대시보드 카드와 동일 정의·드리프트 금지).
 * **정렬하지 않는다** — filter→sort 는 별개 단계라 sortShipments 는 호출부에서 이후 적용한다.
 * 입력 순서를 보존하고(Array.filter), 결과 0건과 입력 0건 구분은 호출부가 list.length 와 비교한다
 * ("조건에 맞는 택배가 없어요" vs 빈 상태 분기).
 */
import type { Shipment } from "./api";
import { stageBucket, isImminent } from "./bucket";

export type ListFilter = "전체" | "진행중" | "임박" | "완료" | "예외";

export function filterShipments(
  list: Shipment[],
  filter: ListFilter,
  { hideCompleted }: { hideCompleted: boolean },
): Shipment[] {
  switch (filter) {
    case "전체":
      // "완료 숨기기"(지속 토글)는 전체·진행중 뷰에서만 배송완료를 뺀다.
      return hideCompleted ? list.filter((s) => s.status !== "배송완료") : [...list];
    case "진행중":
      // 진행중 버킷은 배송완료를 본래 포함하지 않으므로 hideCompleted 와 무관.
      return list.filter((s) => stageBucket(s.status) === "진행중");
    case "임박":
      return list.filter((s) => isImminent(s.status));
    case "완료":
      // 명시 완료 칩은 hideCompleted 를 무시하고 완료를 보여준다(명시 선택 우선, E15).
      return list.filter((s) => s.status === "배송완료");
    case "예외":
      return list.filter((s) => stageBucket(s.status) === "예외");
  }
}
