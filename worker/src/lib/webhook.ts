/**
 * webhook 등록/재등록/조건부 폴백 결정 — 순수 로직(now 주입, 외부 의존 없음).
 * docs/ADR.md ADR-028(webhook-first), docs/QA.md F-1, docs/ARCHITECTURE.md "Webhook (1차 신선도)".
 */

import { pollIntervalMs, fallbackInterval, WEBHOOK_FALLBACK_MS, type Stage } from "./polling";

/** 등록 시 webhook 만료를 now+48h 로 둔다(재등록 sweep 기준). */
export const WEBHOOK_TTL_MS = 48 * 60 * 60 * 1000;
/** 만료가 24h 이내로 남으면 재등록 임박으로 본다. */
export const REREGISTER_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// 폴백 간격(상수·함수)은 polling.ts 단일 출처를 그대로 재노출한다(드리프트 금지 — webhook.ts 재정의 ❌).
export { fallbackInterval, WEBHOOK_FALLBACK_MS };

/** 등록 가능 단계 = 비종료(배송완료 제외) && 미등록 아님(이벤트 0이면 tracker가 모르는 번호). */
function isRegistrableStage(stage: Stage): boolean {
  return pollIntervalMs(stage) !== null && stage !== "미등록";
}

/**
 * webhook 을 (재)등록해야 하는가. → ADR-028 등록 규칙.
 * active && 등록 가능 단계 && (미등록[NULL] 또는 만료 임박[<24h]).
 * 배송완료(종료)·미등록(이벤트0)·비active → false. 이미 등록·여유 → false(멱등).
 */
export function shouldRegisterWebhook(
  stage: Stage,
  active: boolean,
  webhookExpiresAt: number | null,
  now: number,
): boolean {
  if (!active) return false;
  if (!isRegistrableStage(stage)) return false;
  // NULL(미등록) 또는 만료 임박이면 (재)등록 대상.
  return webhookExpiresAt === null || webhookExpiresAt - now < REREGISTER_THRESHOLD_MS;
}

/** 등록 시 보낼 만료 시각을 ISO8601 UTC(끝 Z) 문자열로. */
export function webhookExpiration(now: number): string {
  return new Date(now + WEBHOOK_TTL_MS).toISOString();
}

/**
 * 재등록 sweep 대상인가(만료 임박분만). active 필터는 호출부 쿼리(step5) 소관.
 * webhookExpiresAt !== null && 만료까지 24h 미만 → true. NULL·여유 → false.
 */
export function reregisterDue(webhookExpiresAt: number | null, now: number): boolean {
  return webhookExpiresAt !== null && webhookExpiresAt - now < REREGISTER_THRESHOLD_MS;
}
