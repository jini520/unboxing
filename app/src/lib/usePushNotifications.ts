/**
 * 푸시 배선 훅 — 루트 레이아웃에서 1회 호출(docs/ARCHITECTURE.md "앱 아키텍처").
 * - 포그라운드 표시 핸들러 + Android "배송 상태" 채널(콜드스타트 안전 — 권한 팝업 없음).
 * - 알림 탭 → routeForNotification → 해당 상세로 딥링크(router.push).
 * - 콜드스타트엔 "이미 허용된" 경우에만 토큰 갱신·서버 등록(registerDevice).
 *   priming 후의 최초 권한 요청은 온보딩(가치 시점)에서 registerForPush 로 한다 — 여기선 팝업 금지.
 */
import { useEffect } from "react";
import { router } from "expo-router";
import { registerDevice } from "./api";
import { apiDeps, PLATFORM } from "./deps";
import {
  addNotificationResponseListener,
  configureForegroundHandler,
  ensureAndroidChannel,
  pushDeps,
  registerPushIfGranted,
  routeForNotification,
} from "./push";

export function usePushNotifications(): void {
  useEffect(() => {
    configureForegroundHandler();
    void ensureAndroidChannel();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        // 이미 허용된 경우에만 토큰 갱신·서버 등록(팝업 금지 — priming 후 최초 요청은 온보딩에서).
        await registerPushIfGranted(pushDeps, (token) => registerDevice(token, PLATFORM, apiDeps));
      } catch {
        // 오프라인/401/5xx 등 토큰 갱신·등록 실패는 조용히 무시(미처리 rejection 방지). 알림만 비활성.
      }
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
