/**
 * 온보딩 — 푸시 권한 **사전 안내(priming)**. 시스템 권한 팝업 전에 가치를 먼저 설명한다(PRD 권한·스토어 정책).
 * "알림 받기" → registerForPush(요청). 거부해도 앱은 계속 동작(강제 금지 — ADR-018 거래성만).
 * "나중에"로 건너뛸 수 있다(강제 튜토리얼 금지). 광고성/마케팅 안내는 넣지 않는다.
 */
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import { registerDevice, type ApiDeps } from "../src/lib/api";
import { deviceStorage, getDeviceId } from "../src/lib/device";
import { pushDeps, registerForPush } from "../src/lib/push";
import { useTheme } from "../src/theme/ThemeProvider";

const apiDeps: ApiDeps = {
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  getDeviceId: () =>
    getDeviceId({ storage: deviceStorage, randomBytes: Crypto.getRandomBytes }),
};

const PLATFORM: "ios" | "android" = Platform.OS === "ios" ? "ios" : "android";

export default function OnboardingScreen() {
  const { tokens } = useTheme();
  const [busy, setBusy] = useState(false);

  const dismiss = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const enable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await registerForPush(pushDeps);
      // 허용 시에만 토큰을 서버에 등록. 거부(denied)여도 앱은 계속 — 조용히 진행한다.
      if ("token" in result) {
        await registerDevice(result.token, PLATFORM, apiDeps);
      }
    } catch {
      // 토큰 발급/등록 실패는 조용히 — 알림만 비활성, 앱은 계속 동작.
    } finally {
      setBusy(false);
      dismiss();
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.bg.page }]}>
      <Stack.Screen options={{ title: "알림" }} />
      <View style={styles.content}>
        <Text style={[styles.title, { color: tokens.text.primary }]}>
          상태가 바뀌면 알려드릴게요
        </Text>
        <Text style={[styles.body, { color: tokens.text.body }]}>
          운송장만 넣어두면 배송출발·배송완료 같은 변화를 앱을 켜지 않아도 알림으로 보내드려요.
          알림을 허용해 주세요.
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={enable}
          disabled={busy}
          style={[styles.primary, { backgroundColor: tokens.text.primary, opacity: busy ? 0.4 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="알림 받기"
        >
          {busy ? (
            <ActivityIndicator color={tokens.bg.page} />
          ) : (
            <Text style={[styles.primaryLabel, { color: tokens.bg.page }]}>알림 받기</Text>
          )}
        </Pressable>
        <Pressable
          onPress={dismiss}
          disabled={busy}
          style={styles.skip}
          accessibilityRole="button"
          accessibilityLabel="나중에"
        >
          <Text style={{ color: tokens.text.secondary }}>나중에</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 16 },
  title: { fontSize: 28, fontWeight: "600", lineHeight: 36 },
  body: { fontSize: 16, lineHeight: 24 },
  actions: { paddingHorizontal: 24, paddingBottom: 24, gap: 8 },
  primary: { borderRadius: 8, paddingVertical: 14, alignItems: "center" },
  primaryLabel: { fontSize: 15, fontWeight: "600" },
  skip: { paddingVertical: 12, alignItems: "center" },
});
