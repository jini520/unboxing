/**
 * 단계 → 버킷 단일 출처(순수 로직). docs/ARCHITECTURE.md "v1.1 설계 보강 ①".
 * 대시보드 카드(dashboard.ts)와 택배함 필터 칩(filter.ts)이 **같은 정의**를 공유해야 한다
 * — 드리프트(카드와 칩이 서로 다른 수를 보임)를 막으려 이 모듈이 유일한 출처다(복제 금지).
 * 외부 의존 없음. active 는 버킷에 영향 없다(정지·분실의심도 단계로만 판정).
 */
import type { Stage } from "./api";

/** 8단계를 배타·망라하는 3버킷. 임박(배송출발)은 진행중의 하이라이트 부분집합이라 별도 버킷 아님. */
export type Bucket = "진행중" | "완료" | "예외";

/**
 * 표준 8단계 → 버킷. 진행중={미등록·등록·집화·이동중·배송출발·기타}, 완료={배송완료}, 예외={예외}.
 * 구조상 전수(모든 단계가 정확히 한 버킷)·배타(진행중/완료/예외 상호 배타)를 보장한다.
 */
export function stageBucket(stage: Stage): Bucket {
  if (stage === "배송완료") return "완료";
  if (stage === "예외") return "예외";
  return "진행중"; // 미등록·등록·집화·이동중·배송출발·기타
}

/** 임박 = 배송출발(진행중의 하이라이트 부분집합·"오늘 도착 예정" 후보). 진행중과 겹친다. */
export function isImminent(stage: Stage): boolean {
  return stage === "배송출발";
}
