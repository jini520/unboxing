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

/** KST(UTC+9) 시(0–23). 미등록 폴링 시간대 윈도 판정용. now 주입(결정적 테스트). */
function kstHour(nowMs: number): number {
  return new Date(nowMs + 9 * 3_600_000).getUTCHours();
}

/**
 * 미등록 폴링 간격(ms) — 택배사 등록(첫 이벤트)이 일어나는 시간대(KST)에 집중(ADR-031).
 * webhook 불가 단계(첫 이벤트 전)라 폴링이 유일 감지 → 낮 촘촘·밤 정지로 첫 알림 지연↓·헛폴링 제거.
 * - 06:00–18:00 → 15분 (cron 15분 주기 바닥 — now=scheduledTime 그리드 정렬이라 매 fire 폴링)
 * - 18:00–21:00 → 1시간
 * - 21:00–06:00 → null (폴링 안 함)
 */
export function unregisteredInterval(now: number): number | null {
  const h = kstHour(now);
  if (h >= 21 || h < 6) return null; // 밤: 폴링 안 함
  if (h < 18) return 15 * 60_000; // 낮: 15분
  return 60 * 60_000; // 저녁: 1시간
}

/**
 * 조건부 폴백 폴링 간격(ms). isDue 가 소비하는 **단일 출처**(ADR-028 조건부 폴백 cadence).
 * - 미등록 → 시간대 윈도(unregisteredInterval, ADR-031) — webhook 불가라 webhookExpiresAt 무관
 * - 배송완료(pollIntervalMs null) → null(폴링 안 함)
 * - webhook 등록분(webhookExpiresAt !== null) → WEBHOOK_FALLBACK_MS(~12h 안전망, 신선도는 콜백)
 * - 그 외 폴백분(webhookExpiresAt === null) → 적응형 pollIntervalMs(stage)
 */
export function fallbackInterval(
  stage: Stage,
  webhookExpiresAt: number | null,
  now: number,
): number | null {
  if (stage === "미등록") return unregisteredInterval(now);
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
  const interval = fallbackInterval(stage, webhookExpiresAt, now);
  if (interval === null) {
    // interval null = 배송완료(종료) 또는 미등록 야간(ADR-031). 미등록은 **한 번도 안 본 송장만 1회 허용**
    // (밤에 등록한 택배의 첫 확인) — 이후 재폴링은 06시까지 skip. 배송완료는 종료라 항상 skip.
    return stage === "미등록" && lastPolledAt === null;
  }
  if (lastPolledAt === null) return true; // 한 번도 안 함 → 즉시
  return now >= lastPolledAt + interval;
}
