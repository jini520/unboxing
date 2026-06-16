/**
 * 화면 공용 의존성 — apiDeps(인증 wiring)·PLATFORM. 각 화면이 동일 리터럴을 복붙하지 않도록 단일 출처.
 * apiDeps: 모든 API 호출에 device_id(Bearer)를 붙이는 표준 wiring(getDeviceId + SecureStore + expo-crypto).
 */
import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import type { ApiDeps } from "./api";
import { deviceStorage, getDeviceId } from "./device";

export const apiDeps: ApiDeps = {
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  getDeviceId: () => getDeviceId({ storage: deviceStorage, randomBytes: Crypto.getRandomBytes }),
};

export const PLATFORM: "ios" | "android" = Platform.OS === "ios" ? "ios" : "android";
