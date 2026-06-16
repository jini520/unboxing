import { describe, it, expect } from "@jest/globals";
import type { SecureStorage } from "./device";
import { generateDeviceId, getDeviceId } from "./device";

/** 결정적 randomBytes(테스트용): seed 기반 가짜 바이트. 호출마다 같은 입력 → 같은 출력. */
function seqRandomBytes(seed: number): (n: number) => Uint8Array {
  return (n) => Uint8Array.from({ length: n }, (_, i) => (seed + i) % 256);
}

/** 인메모리 SecureStorage + 호출 횟수 카운터. */
function memStorage() {
  const store: Record<string, string> = {};
  const calls = { get: 0, set: 0, del: 0 };
  const storage: SecureStorage = {
    getItem: async (k) => {
      calls.get++;
      return k in store ? store[k] : null;
    },
    setItem: async (k, v) => {
      calls.set++;
      store[k] = v;
    },
    deleteItem: async (k) => {
      calls.del++;
      delete store[k];
    },
  };
  return { storage, calls };
}

describe("generateDeviceId", () => {
  it("≥128bit(=16바이트) 이상의 엔트로피를 요청한다", () => {
    let requested = 0;
    generateDeviceId((n) => {
      requested = n;
      return new Uint8Array(n);
    });
    expect(requested).toBeGreaterThanOrEqual(16);
  });

  it("base64url 안전 문자만 포함한다(패딩 없음)", () => {
    const id = generateDeviceId(seqRandomBytes(0));
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("randomBytes가 다르면 다른 id를 만든다", () => {
    const a = generateDeviceId(seqRandomBytes(0));
    const b = generateDeviceId(seqRandomBytes(7));
    expect(a).not.toBe(b);
  });

  it("같은 randomBytes면 같은 id (결정적)", () => {
    expect(generateDeviceId(seqRandomBytes(3))).toBe(generateDeviceId(seqRandomBytes(3)));
  });
});

describe("getDeviceId", () => {
  it("저장소가 비어 있으면 생성해 저장한다", async () => {
    const { storage, calls } = memStorage();
    const id = await getDeviceId({ storage, randomBytes: seqRandomBytes(1) });
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(calls.set).toBe(1); // 새로 저장됨
  });

  it("두 번째 호출은 저장값을 재사용한다(생성 안 함, 멱등)", async () => {
    const { storage, calls } = memStorage();
    let genCalls = 0;
    const randomBytes = (n: number) => {
      genCalls++;
      return seqRandomBytes(2)(n);
    };
    const first = await getDeviceId({ storage, randomBytes });
    const second = await getDeviceId({ storage, randomBytes });
    expect(second).toBe(first);
    expect(genCalls).toBe(1); // 두 번째엔 새 id 생성 안 함
    expect(calls.set).toBe(1); // 두 번째엔 저장 안 함
  });
});
