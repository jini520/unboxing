/** 적응형 폴링 주기 — docs/design.md "적응형 폴링 주기" */

export type Stage =
  | "미등록"
  | "등록"
  | "집화"
  | "이동중"
  | "배송출발"
  | "배송완료"
  | "예외"
  | "기타";

export type KeyType = "shared" | "byok";

/** 단계별 폴링 간격(분). 배송완료는 폴링 중단(null). 개인 키(BYOK)는 절반. */
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
export function pollIntervalMs(stage: Stage, keyType: KeyType = "shared"): number | null {
  const base = BASE_MINUTES[stage];
  if (base === null) return null;
  const minutes = keyType === "byok" ? base / 2 : base;
  return minutes * 60_000;
}

/** 지금 폴링해야 하는가. lastPolledAt이 null이면(=한 번도 안 함) 즉시 due. */
export function isDue(
  stage: Stage,
  lastPolledAt: number | null,
  now: number,
  keyType: KeyType = "shared",
): boolean {
  const interval = pollIntervalMs(stage, keyType);
  if (interval === null) return false; // 배송완료 → 폴링 안 함
  if (lastPolledAt === null) return true; // 한 번도 안 함 → 즉시
  return now >= lastPolledAt + interval;
}
