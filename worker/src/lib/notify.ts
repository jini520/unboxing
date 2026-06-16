/** 알림 트리거 판단 — docs/ARCHITECTURE.md "상태 정규화 & 알림" → "알림 규칙", ADR-018(거래성 알림만) */

import type { Stage } from "./polling";

/** 단계 전환 시 푸시를 보내야 하는 알림 대상 단계. 이동중·기타·미등록은 제외(타임라인만). */
export const NOTIFYING_STAGES: ReadonlySet<Stage> = new Set<Stage>([
  "등록",
  "집화",
  "배송출발",
  "배송완료",
  "예외",
]);

/**
 * 이전 단계(prev)에서 다음 단계(next)로 바뀔 때 푸시를 보낼지.
 * - next 가 알림 대상이고 AND 단계가 실제로 바뀐 경우(prev !== next)에만 true.
 * - 이동중·기타·미등록 으로의 전환은 항상 false(타임라인만).
 * - prev 가 null(첫 관측)이고 next 가 알림 대상이면 true.
 */
export function shouldNotify(prev: Stage | null, next: Stage): boolean {
  if (prev === next) return false; // 재관측 → 멱등(무발송)
  return NOTIFYING_STAGES.has(next);
}
