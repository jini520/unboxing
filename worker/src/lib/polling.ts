/** 적응형 폴링 주기 — docs/ARCHITECTURE.md "적응형 폴링 + cron 실행 모델" */

export type Stage =
  | "미등록"
  | "등록"
  | "집화"
  | "이동중"
  | "배송출발"
  | "배송완료"
  | "예외"
  | "기타";

/** 단계별 폴링 간격(분). 배송완료는 폴링 중단(null). */
const BASE_MINUTES: Record<Stage, number | null> = {
  미등록: 360,
  등록: 240,
  집화: 240,
  이동중: 240,
  기타: 240,
  배송출발: 60,
  배송완료: null,
  예외: 720,
};

/** 폴링 간격(ms). null이면 폴링하지 않음. */
export function pollIntervalMs(stage: Stage): number | null {
  const base = BASE_MINUTES[stage];
  return base === null ? null : base * 60_000;
}

/**
 * webhook 등록분의 폴백 폴링 간격(ms) — 신선도는 콜백이 담당하므로 길게(~12h 안전망).
 * webhook.ts 가 re-export 한다(단일 출처 — 두 곳에 중복 정의 ❌). → ADR-028
 */
export const WEBHOOK_FALLBACK_MS = 12 * 60 * 60 * 1000;

/**
 * 조건부 폴백 폴링 간격(ms). isDue 가 소비하는 **단일 출처**(ADR-028 조건부 폴백 cadence).
 * - 배송완료(pollIntervalMs null) → null(폴링 안 함, webhook 무관)
 * - webhook 등록분(webhookExpiresAt !== null) → WEBHOOK_FALLBACK_MS(~12h 안전망, 신선도는 콜백)
 * - 미등록·폴백분(webhookExpiresAt === null) → 기존 적응형 pollIntervalMs(stage)
 */
export function fallbackInterval(stage: Stage, webhookExpiresAt: number | null): number | null {
  const base = pollIntervalMs(stage);
  if (base === null) return null; // 배송완료 → 폴링 안 함
  return webhookExpiresAt !== null ? WEBHOOK_FALLBACK_MS : base;
}

/**
 * 지금 폴링해야 하는가. lastPolledAt이 null이면(=한 번도 안 함) 즉시 due.
 * webhookExpiresAt(선택·기본 null)로 조건부 폴백 간격을 쓴다 — null이면 종전 동작과 동일(하위호환).
 */
export function isDue(
  stage: Stage,
  lastPolledAt: number | null,
  now: number,
  webhookExpiresAt: number | null = null,
): boolean {
  const interval = fallbackInterval(stage, webhookExpiresAt);
  if (interval === null) return false; // 배송완료 → 폴링 안 함
  if (lastPolledAt === null) return true; // 한 번도 안 함 → 즉시
  return now >= lastPolledAt + interval;
}
