/**
 * 익명 디바이스 식별 — 고엔트로피 secret device_id 생성·보관(재사용).
 * docs/ADR.md ADR-007(secret device_id Bearer), ADR-002(익명). docs/ARCHITECTURE.md "디바이스 식별".
 * device_id 는 추측 불가한 비밀이 곧 자격이므로 ≥128bit, Keychain/Keystore-backed SecureStore 보관, 로그 금지.
 */
import * as SecureStore from "expo-secure-store";

/** 보안 저장소 추상화(테스트 주입용). 운영 구현은 expo-secure-store(deviceStorage). */
export interface SecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

const STORAGE_KEY = "unboxing.device_id";
const DEVICE_ID_BYTES = 32; // 256bit — ADR-007의 ≥128bit 요구를 넉넉히 충족.

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Uint8Array → base64url(패딩 없음). btoa/Buffer 비의존 — RN·Node 어디서나 결정적. */
function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += B64URL[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += B64URL[b2 & 0x3f];
  }
  return out;
}

/** ≥128bit 랜덤 → base64url 문자열. randomBytes 주입(expo-crypto Crypto.getRandomBytes). */
export function generateDeviceId(randomBytes: (n: number) => Uint8Array): string {
  return toBase64Url(randomBytes(DEVICE_ID_BYTES));
}

/** 저장소에 있으면 반환, 없으면 생성·저장 후 반환(멱등 — 같은 기기는 같은 id 재사용). */
export async function getDeviceId(deps: {
  storage: SecureStorage;
  randomBytes: (n: number) => Uint8Array;
}): Promise<string> {
  const existing = await deps.storage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const id = generateDeviceId(deps.randomBytes);
  await deps.storage.setItem(STORAGE_KEY, id);
  return id;
}

/** 운영용 기본 저장소 인스턴스(expo-secure-store, Keychain/Keystore-backed). */
export const deviceStorage: SecureStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItem: (key) => SecureStore.deleteItemAsync(key),
};
