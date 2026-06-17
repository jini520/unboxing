import { describe, it, expect } from "@jest/globals";
import { wipeAllData } from "./wipe";

describe("wipeAllData", () => {
  it("서버(DELETE /me) → 캐시 → device_id 순으로 모두 폐기한다", async () => {
    const calls: string[] = [];
    await wipeAllData({
      deleteMe: async () => {
        calls.push("deleteMe");
      },
      clearCache: async () => {
        calls.push("clearCache");
      },
      clearMemos: async () => {
        calls.push("clearMemos");
      },
      deleteDeviceId: async () => {
        calls.push("deleteDeviceId");
      },
    });
    expect(calls).toEqual(["deleteMe", "clearCache", "clearMemos", "deleteDeviceId"]);
  });

  it("서버 삭제 실패 시 로컬은 보존하고(재시도 가능) 에러를 전파한다", async () => {
    const calls: string[] = [];
    const run = wipeAllData({
      deleteMe: async () => {
        calls.push("deleteMe");
        throw new Error("network");
      },
      clearCache: async () => {
        calls.push("clearCache");
      },
      clearMemos: async () => {
        calls.push("clearMemos");
      },
      deleteDeviceId: async () => {
        calls.push("deleteDeviceId");
      },
    });
    await expect(run).rejects.toThrow("network");
    // 서버가 실패하면 로컬 폐기는 호출되지 않는다.
    expect(calls).toEqual(["deleteMe"]);
  });
});
