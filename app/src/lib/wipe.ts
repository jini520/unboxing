/**
 * 모든 데이터 삭제 오케스트레이션 — 서버(DELETE /me) + 로컬(캐시·device_id·v1.1 로컬 스토어)를 함께 폐기한다.
 * docs/ADR.md ADR-017(데이터 삭제 경로·스토어 정책)·ADR-005(개인정보 비영속)·"v1.1 설계 보강 ⑦". 복구 불가.
 *
 * 서버 삭제를 **먼저** 한다 — 실패(네트워크 등)하면 로컬을 보존해 재시도를 가능케 한다.
 * (device_id 를 먼저 지우면 같은 기기의 서버 데이터를 다시 지울 자격이 사라진다 — ADR-007.)
 * 외부 의존(api·cache·device·로컬 스토어)은 주입 — 순수 오케스트레이션만(테스트는 스파이로 검증).
 */
import { type KeyValueStore } from "./cache";
import { clearInfo } from "./info";
import { clearTrash } from "./trash";
import { clearLastSeen } from "./notif";
import { clearHomePref, clearListFilter } from "./prefs";

export interface WipeDeps {
  /** 서버측 모든 데이터 삭제(DELETE /me). */
  deleteMe: () => Promise<void>;
  /** 로컬 오프라인 캐시 폐기. */
  clearCache: () => Promise<void>;
  /** 로컬 메모(레거시 잔여) 폐기. */
  clearMemos: () => Promise<void>;
  /** v1.1 신규 로컬 스토어 전부 폐기(info·trash·읽음·시작화면·필터) — clearLocalStores(보강⑦·E19). */
  clearLocal: () => Promise<void>;
  /** 저장된 device_id 폐기. */
  deleteDeviceId: () => Promise<void>;
}

export async function wipeAllData(deps: WipeDeps): Promise<void> {
  await deps.deleteMe();
  await deps.clearCache();
  await deps.clearMemos();
  await deps.clearLocal();
  await deps.deleteDeviceId();
}

/**
 * v1.1 신규 로컬 스토어를 한 곳에서 폐기 — "무엇이 로컬 스토어인가"의 **단일 출처**(키 누락=회귀, E19 방지).
 * settings.doWipe(운영)와 wipe.test(E19)가 이 함수를 공유해 폐기 대상이 드리프트하지 않게 한다.
 * 모두 같은 AsyncStorage(cacheStore) 키라 store 하나로 충분.
 */
export async function clearLocalStores(store: KeyValueStore): Promise<void> {
  await clearInfo({ store });
  await clearTrash({ store });
  await clearLastSeen({ store });
  await clearHomePref({ store });
  await clearListFilter({ store });
}
