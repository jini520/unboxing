import { describe, it, expect, beforeEach } from "@jest/globals";
import { ensureDeviceRegistered, resetDeviceRegistered } from "./bootstrap";

/**
 * 기기 부트스트랩(QA-001) — 성공 1회 캐시 + 실패 시 재시도 + wipe 리셋.
 * createShipment 전 ensure 보장은 register 화면이 ensureDeviceRegistered 를 선행 호출해 충족(주입 ensure 로 검증).
 */
describe("ensureDeviceRegistered", () => {
  beforeEach(() => resetDeviceRegistered());

  it("성공 후엔 재호출해도 ensure 를 다시 부르지 않는다(세션 캐시 — 중복 /devices 방지)", async () => {
    let calls = 0;
    const ensure = async () => {
      calls++;
    };
    await ensureDeviceRegistered(ensure);
    await ensureDeviceRegistered(ensure);
    expect(calls).toBe(1);
  });

  it("실패는 캐시하지 않아 다음 호출이 재시도된다(데드락 재발 방지)", async () => {
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error("offline");
    };
    await expect(ensureDeviceRegistered(failing)).rejects.toThrow("offline");
    const ok = async () => {
      calls++;
    };
    await ensureDeviceRegistered(ok); // 재시도 → 성공.
    expect(calls).toBe(2);
  });

  it("resetDeviceRegistered() 후엔 다시 ensure 한다(wipe 로 device_id 가 바뀐 경우)", async () => {
    let calls = 0;
    const ensure = async () => {
      calls++;
    };
    await ensureDeviceRegistered(ensure);
    resetDeviceRegistered();
    await ensureDeviceRegistered(ensure);
    expect(calls).toBe(2);
  });
});
