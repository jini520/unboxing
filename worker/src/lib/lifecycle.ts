/** 만료/좀비 정책 — docs/ARCHITECTURE.md "데이터 수명주기 & 만료". 순수 로직(now 주입). */

import type { Stage } from "./polling";

export type LifecycleAction =
  | { type: "keep" }
  | { type: "deactivate"; reason: "미등록7일" | "예외7일" | "분실의심30일"; notify: boolean };

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 송장을 비활성해야 하는지 판단. now·createdAt 은 epoch ms.
 * Phase 1은 createdAt(등록 시각)을 기준 시계로 사용한다(데이터가 단기·비영속이라 단계별 진입 시각 정밀 추적은 Phase 2).
 * 경계는 `now - createdAt >= 임계`(이상)으로 판정. 7일 규칙이 30일 규칙보다 먼저 걸린다.
 */
export function lifecycleAction(input: { stage: Stage; createdAt: number; now: number }): LifecycleAction {
  const { stage, createdAt, now } = input;
  const age = now - createdAt;

  // 미등록7일: 오타/잘못된 번호 의심 → '번호 확인' 안내 1회(PRD 플로우6 "7일 미수신 시 안내").
  if (stage === "미등록" && age >= SEVEN_DAYS_MS) {
    return { type: "deactivate", reason: "미등록7일", notify: true };
  }
  // 예외7일: 예외 진입 시 이미 예외 푸시를 1회 받았으므로 재안내는 같은 예외 2회 알림(과알림) → 조용히 비활성.
  if (stage === "예외" && age >= SEVEN_DAYS_MS) {
    return { type: "deactivate", reason: "예외7일", notify: false };
  }
  // 30일 강제 비활성은 배송완료·예외를 제외한다(각자 경로로 처리 — "분실 의심" 아님).
  if (age >= THIRTY_DAYS_MS && stage !== "배송완료" && stage !== "예외") {
    return { type: "deactivate", reason: "분실의심30일", notify: true };
  }
  return { type: "keep" };
}
