/**
 * 루트 레이아웃 — expo-router 진입(파일 기반 라우팅·딥링크). SafeAreaProvider + ThemeProvider 로
 * <Stack> 을 감싼다. 개별 화면 옵션/스크린은 각 화면 step에서 추가.
 */
import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "../src/theme/ThemeProvider";
import { usePushNotifications } from "../src/lib/usePushNotifications";
import { ensureDeviceRegistered } from "../src/lib/bootstrap";

export default function RootLayout() {
  usePushNotifications();
  // 푸시와 무관하게 device 를 1회 서버 등록(QA-001) — 실패는 조용히(등록 시점 ensure 가 재시도).
  useEffect(() => {
    void ensureDeviceRegistered().catch(() => {});
  }, []);
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Stack />
        <StatusBar style="auto" />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
