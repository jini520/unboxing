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

// ── 콜백 처리 순수부 (ADR-029 콜백 보안) ───────────────────────────────────────

/** 콜백 신선도 throttle: 직전 폴링이 이 시간보다 최근이면 재조회 skip(연속·중복 콜백 dedupe). */
export const CALLBACK_FRESHNESS_MS = 60_000;

/**
 * 콜백 경로 시크릿을 **상수시간(timing-safe)**으로 비교한다. → ADR-029 ①, ENGINEERING T6.
 * 첫 불일치/길이에서 early-return 으로 끊지 않는다(타이밍 오라클 차단) — 길이 차는 누산기에 반영하고
 * got 전체를 끝까지 스캔한다. 빈 got 은 비교할 콘텐츠가 없어 seed=1(항상 불일치)로 두어 빈 콜백 경로
 * 우회를 막는다. 길이·seed 항은 attacker-controlled 인 got 길이에만 의존하므로 비밀 콘텐츠 타이밍은 누출되지 않는다.
 */
export function verifyCallbackSecret(got: string, expected: string): boolean {
  let mismatch = got.length === 0 ? 1 : got.length ^ expected.length;
  for (let i = 0; i < got.length; i += 1) {
    mismatch |= got.charCodeAt(i) ^ expected.charCodeAt(i % expected.length);
  }
  return mismatch === 0;
}

/**
 * 콜백 수신 시 track 을 재조회해야 하는가(송장별 신선도 throttle). → ADR-029 ③, QA W6.
 * 직전 폴링이 60s 이내(<CALLBACK_FRESHNESS_MS)면 연속·중복 콜백으로 보고 skip(false). 그 외 true.
 * IP rate limit 은 쓰지 않는다(콜백은 tracker 고정 IP — 거짓양성, ADR-029·T2).
 */
export function shouldRefetchOnCallback(lastPolledAt: number | null, now: number): boolean {
  if (lastPolledAt !== null && now - lastPolledAt < CALLBACK_FRESHNESS_MS) return false;
  return true;
}

/**
 * 콜백 본문에서 carrierId·trackingNumber 만 파싱(여분 필드 무시). → ADR-029 ②(형식부), QA W1.
 * 누락·타입오류·손상(비객체)·빈 문자열 → null. 페이로드 불신(D1 active 송장 확인)은 호출부(step4) 소관.
 */
export function parseCallback(
  body: unknown,
): { carrierId: string; trackingNumber: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const { carrierId, trackingNumber } = body as Record<string, unknown>;
  if (typeof carrierId !== "string" || carrierId.length === 0) return null;
  if (typeof trackingNumber !== "string" || trackingNumber.length === 0) return null;
  return { carrierId, trackingNumber };
}
