/**
 * 모든 데이터 삭제 오케스트레이션 — 서버(DELETE /me) + 로컬(캐시·device_id)를 함께 폐기한다.
 * docs/ADR.md ADR-017(데이터 삭제 경로·스토어 정책)·ADR-005(개인정보 비영속). 복구 불가.
 *
 * 서버 삭제를 **먼저** 한다 — 실패(네트워크 등)하면 로컬을 보존해 재시도를 가능케 한다.
 * (device_id 를 먼저 지우면 같은 기기의 서버 데이터를 다시 지울 자격이 사라진다 — ADR-007.)
 * 외부 의존(api·cache·device)은 주입 — 순수 오케스트레이션만(테스트는 스파이로 검증).
 */
export interface WipeDeps {
  /** 서버측 모든 데이터 삭제(DELETE /me). */
  deleteMe: () => Promise<void>;
  /** 로컬 오프라인 캐시 폐기. */
  clearCache: () => Promise<void>;
  /** 저장된 device_id 폐기. */
  deleteDeviceId: () => Promise<void>;
}

export async function wipeAllData(deps: WipeDeps): Promise<void> {
  await deps.deleteMe();
  await deps.clearCache();
  await deps.deleteDeviceId();
}
