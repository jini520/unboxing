/**
 * 알림 미읽음/읽음(로컬) — 받은 푸시 기록은 서버 SOT(GET /notifications), 읽음 상태만 기기 로컬(ADR-023).
 * docs/ARCHITECTURE.md "로컬 스토어"(unboxing.notif_last_seen)·"v1.1 설계 보강 ⑤"(첫 실행 now 초기화·99+ 상한).
 *
 * - 미읽음 = sentAt > lastSeen 인 알림 수.
 * - lastSeen 미설정(첫 fetch) → now 로 초기화 → 0(기존 기록이 한꺼번에 미읽음 배지로 폭주하는 것 방지, 보강⑤·E11).
 * - 읽음(markSeen)은 lastSeen = max(now, 최신 sentAt) — 서버/기기 시계차로 최신이 미래여도 그 이하를 읽음 처리.
 * - 서버 동기화 없음 — 로컬 전용(Phase 2 계정). store·now 주입(결정적 테스트). 손상값은 미설정(null) 취급.
 */
import { type KeyValueStore, cacheStore } from "./cache";

const LAST_SEEN_KEY = "unboxing.notif_last_seen";

/** 미읽음 계산에 필요한 최소 알림 형태(sentAt 만) — GET /notifications 응답의 부분집합. */
export interface SeenNotification {
  sentAt: number;
}

/** 저장된 마지막 열람 시각(epoch ms). 없거나 손상이면 null(미설정). */
export async function loadLastSeen(deps: { store: KeyValueStore }): Promise<number | null> {
  const raw = await deps.store.getItem(LAST_SEEN_KEY);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function saveLastSeen(value: number, deps: { store: KeyValueStore }): Promise<void> {
  await deps.store.setItem(LAST_SEEN_KEY, String(value));
}

/**
 * 미읽음 수 = sentAt > lastSeen 인 알림 수.
 * lastSeen 미설정(null) → 0 — 첫 fetch 에서 기존 기록을 미읽음으로 폭주시키지 않는다(보강⑤·E11).
 * 순수 함수(저장소 무관) — 첫 fetch 의 now 초기화 side effect 는 initLastSeen 이 담당한다.
 */
export function unreadCount(notifs: SeenNotification[], lastSeen: number | null): number {
  if (lastSeen === null) return 0;
  return notifs.reduce((n, x) => (x.sentAt > lastSeen ? n + 1 : n), 0);
}

/**
 * 첫 fetch 시 lastSeen 이 없으면 now 로 초기화하고 그 값을 반환(보강⑤·E11). 이미 있으면 기존 값.
 * 이후 unreadCount 는 이 값을 기준으로 센다 — 기존 기록이 한꺼번에 미읽음이 되지 않는다.
 */
export async function initLastSeen(deps: { store: KeyValueStore; now: number }): Promise<number> {
  const existing = await loadLastSeen(deps);
  if (existing !== null) return existing;
  await saveLastSeen(deps.now, deps);
  return deps.now;
}

/**
 * 알림 화면 열람·'모두 읽음' — lastSeen = max(now, 최신 sentAt) 저장(보강⑤).
 * latestSentAt 가 미래(시계차)여도 그 이하 알림이 읽음 처리되도록 max. 알림이 없으면 0 → now.
 */
export async function markSeen(
  deps: { store: KeyValueStore; now: number },
  latestSentAt = 0,
): Promise<void> {
  await saveLastSeen(Math.max(deps.now, latestSentAt), deps);
}

/** 배지 표시 문구 — 99 초과는 "99+", 0 이하는 빈 문자열(배지 없음). */
export function badgeText(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}

/** 마지막 열람 시각 폐기(모든 데이터 삭제 — wipeAllData 가 호출). */
export async function clearLastSeen(deps: { store: KeyValueStore }): Promise<void> {
  await deps.store.removeItem(LAST_SEEN_KEY);
}

/** 운영용 저장소 — cache 와 동일 AsyncStorage 인스턴스(키만 다름). */
export const notifStore = cacheStore;
