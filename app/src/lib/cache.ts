/**
 * 오프라인 읽기 캐시 — 서버가 SOT, 앱은 마지막 목록 응답만 로컬에 두어 오프라인에서 읽는다(ADR-014).
 * docs/ARCHITECTURE.md "앱 아키텍처"·"에러 처리(네트워크 오프라인)".
 * 캐시는 읽기 전용 뷰다. 변경(등록/삭제)은 온라인에서만 — 오프라인 쓰기 큐 없음(ADR-014).
 * 목록의 비개인 필드(Shipment)만 저장 — 수령인 이름/연락처/주소 비영속(ADR-005),
 * 상세 타임라인은 실시간 조회·미저장이므로 캐시하지 않는다(ADR-011).
 * now 주입(Date.now 직접 호출 금지 — 결정적 테스트).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NotificationRecord, Shipment } from "./api";

/** 키-값 저장소 추상화(테스트 주입용). 운영 구현은 AsyncStorage(cacheStore). */
export interface KeyValueStore {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
  removeItem(k: string): Promise<void>;
}

const CACHE_KEY = "unboxing.shipments_cache";
// 알림 기록 오프라인 캐시(GET /notifications 의 마지막 성공 응답) — 서버 SOT·앱은 캐시 읽기만(ADR-014·023).
const NOTIF_CACHE_KEY = "unboxing.notifications_cache";

/** 저장 형태: 목록 + 캐시 시각. Shipment 는 비개인 필드만 가지므로 그대로 저장해도 안전(ADR-005). */
interface CachedShipments {
  list: Shipment[];
  cachedAt: number;
}

/** 송장 목록 + 캐시 시각(now)을 저장. 타임라인은 받지 않으므로 구조적으로 미캐시(ADR-011). */
export async function cacheShipments(
  list: Shipment[],
  deps: { store: KeyValueStore; now: number },
): Promise<void> {
  const payload: CachedShipments = { list, cachedAt: deps.now };
  await deps.store.setItem(CACHE_KEY, JSON.stringify(payload));
}

/** 캐시된 목록 + 캐시 시각을 반환. 캐시 없으면 null. */
export async function readCachedShipments(deps: {
  store: KeyValueStore;
}): Promise<{ list: Shipment[]; cachedAt: number } | null> {
  const raw = await deps.store.getItem(CACHE_KEY);
  if (raw === null) return null;
  return JSON.parse(raw) as CachedShipments;
}

/** 캐시 폐기 — 오프라인 읽기 캐시(송장 + 알림 기록) 전부. wipeAllData 가 호출(ADR-017). */
export async function clearCache(deps: { store: KeyValueStore }): Promise<void> {
  await deps.store.removeItem(CACHE_KEY);
  await deps.store.removeItem(NOTIF_CACHE_KEY);
}

/**
 * 알림 기록 목록 + 캐시 시각(now)을 저장(오프라인 표시용, ADR-023). 비-PII(택배사·끝4자리·상태)라 저장 안전.
 * GET /notifications 성공 시 호출 — 다음 오프라인/구버전 서버(404) 진입 때 readCachedNotifications 가 폴백.
 */
export async function cacheNotifications(
  list: NotificationRecord[],
  deps: { store: KeyValueStore; now: number },
): Promise<void> {
  await deps.store.setItem(NOTIF_CACHE_KEY, JSON.stringify({ list, cachedAt: deps.now }));
}

/** 캐시된 알림 목록. 없거나 손상 JSON 이면 null(graceful — 화면이 빈 목록 폴백). */
export async function readCachedNotifications(deps: {
  store: KeyValueStore;
}): Promise<NotificationRecord[] | null> {
  const raw = await deps.store.getItem(NOTIF_CACHE_KEY);
  if (raw === null) return null;
  try {
    return (JSON.parse(raw) as { list: NotificationRecord[] }).list;
  } catch {
    return null;
  }
}

/** 운영용 기본 저장소 인스턴스(AsyncStorage — 비암호화 영속 KV). */
export const cacheStore: KeyValueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};
