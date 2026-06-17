/**
 * 조용시간(quiet hours) 판정 — 야간 비긴급 알림을 보류했다가 아침에 묶어 보내기 위한 순수 헬퍼.
 * 설계 기준: docs/PRD.md "알림 정책"(야간 22:00–08:00 KST 보류 후 아침 묶음),
 *           ADR-012(날짜·시각은 KST), ADR-018(과알림 방지).
 *
 * 핵심:
 *  - 시각 판정은 **KST(UTC+9)**, now 주입(결정적 테스트). Date.now()/UTC 야간 판정 금지.
 *  - 긴급 단계(예외·배송완료)는 야간에도 즉시 발송한다(보류 금지).
 */

import type { Stage } from "./polling";

/**
 * KST(UTC+9) 기준 야간(조용시간)인가 — 22:00(포함)부터 08:00(미포함)까지.
 * 경계는 시(hour) 단위로 정확: 22:00 → 야간, 08:00 → 주간(끝, 미포함). (PRD 알림 정책)
 */
export function isQuietHours(nowMs: number): boolean {
  const kstHour = new Date(nowMs + 9 * 3_600_000).getUTCHours();
  return kstHour >= 22 || kstHour < 8;
}

/** 야간에도 즉시 발송해야 하는 긴급 단계(예외·배송완료). 그 외는 야간 보류 대상. */
export function isUrgentStage(stage: Stage): boolean {
  return stage === "예외" || stage === "배송완료";
}
