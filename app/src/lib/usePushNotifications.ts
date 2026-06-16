/**
 * 푸시 배선 훅 — 루트 레이아웃에서 1회 호출(docs/ARCHITECTURE.md "앱 아키텍처").
 * - 포그라운드 표시 핸들러 + Android "배송 상태" 채널(콜드스타트 안전 — 권한 팝업 없음).
 * - 알림 탭 → routeForNotification → 해당 상세로 딥링크(router.push).
 * - 콜드스타트엔 "이미 허용된" 경우에만 토큰 갱신·서버 등록(registerDevice).
 *   priming 후의 최초 권한 요청은 온보딩(가치 시점)에서 registerForPush 로 한다 — 여기선 팝업 금지.
 */
import { useEffect } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { registerDevice, type ApiDeps } from "./api";
import { deviceStorage, getDeviceId } from "./device";
import {
  addNotificationResponseListener,
  configureForegroundHandler,
  ensureAndroidChannel,
  pushDeps,
  registerForPush,
  routeForNotification,
} from "./push";

const apiDeps: ApiDeps = {
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  getDeviceId: () => getDeviceId({ storage: deviceStorage, randomBytes: Crypto.getRandomBytes }),
};

const PLATFORM: "ios" | "android" = Platform.OS === "ios" ? "ios" : "android";

export function usePushNotifications(): void {
  useEffect(() => {
    configureForegroundHandler();
    void ensureAndroidChannel();
  }, []);

  useEffect(() => {
    void (async () => {
      const perm = await pushDeps.getPermissions();
      if (!perm.granted) return; // 미허용이면 팝업 없이 종료(온보딩에서 priming 후 요청).
      const result = await registerForPush(pushDeps);
      if ("denied" in result) return;
      await registerDevice(result.token, PLATFORM, apiDeps);
    })();
  }, []);

  useEffect(() => {
    const sub = addNotificationResponseListener((data) => {
      const path = routeForNotification(data);
      if (path) router.push(path);
    });
    return () => sub.remove();
  }, []);
}
