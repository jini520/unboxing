/**
 * 기기 부트스트랩 — 푸시와 무관하게 device 를 서버에 1회 등록(ensureDevice).
 * QA-001(푸시 거부 시 등록 데드락) 해소: 송장 등록 전 device 가 서버에 존재함을 보장한다.
 * docs/ADR.md ADR-007(device_id 자격) · docs/QA_FINDINGS.md QA-001.
 *
 * - 성공은 모듈 플래그로 캐시 — 매 등록마다 /devices 를 재호출하지 않는다(중복 호출·IP rate-limit 소모 방지, ADR-008).
 * - 실패(오프라인/5xx)는 캐시하지 않으므로 다음 호출이 자연 재시도된다.
 * - wipe(DELETE /me)로 device_id 가 바뀌면 resetDeviceRegistered() 로 캐시를 비워 새 id 를 재등록한다.
 */
import { ensureDevice } from "./api";
import { apiDeps, PLATFORM } from "./deps";

let registered = false;

/**
 * 기기를 서버에 1회 등록(푸시 무관). 성공 시 캐시 — 재호출은 no-op. 실패는 throw(호출처가 처리·재시도).
 * ensure 는 테스트 주입용(기본은 실제 POST /devices {platform}).
 */
export async function ensureDeviceRegistered(
  ensure: () => Promise<void> = () => ensureDevice(PLATFORM, apiDeps),
): Promise<void> {
  if (registered) return;
  await ensure();
  registered = true;
}

/** wipe 후 device_id 가 폐기됐을 때 호출 — 다음 ensureDeviceRegistered 가 새 id 로 재등록(데드락 재발 방지). */
export function resetDeviceRegistered(): void {
  registered = false;
}
