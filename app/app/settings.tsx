/**
 * 설정 화면 — 알림 켜기/끄기 · 테마(시스템/라이트/다크) · 개인정보처리방침 · 모든 데이터 삭제 · 앱 버전.
 * docs/PRD.md "설정 화면", docs/UI_GUIDE.md "설정 / About", docs/ADR.md ADR-016(테마)·ADR-017(데이터 삭제).
 *
 * 핵심 규칙:
 * - "모든 데이터 삭제"는 서버(DELETE /me) + 로컬(캐시·device_id)을 함께 폐기(wipeAllData). 확인 다이얼로그 + 복구 불가 명시.
 * - 테마 기본은 시스템 추종, 사용자가 라이트/다크 고정 가능(useTheme().setPreference).
 * - 알림은 거부해도 앱 계속 동작(강제 금지) — OS 권한은 앱에서 끌 수 없어 시스템 설정으로 안내.
 * - 광고성/마케팅 알림 설정은 두지 않는다(ADR-018 거래성만). 색은 토큰만(삭제=예외 색).
 */
import { useCallback, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as Crypto from "expo-crypto";
import { deleteMe, registerDevice, type ApiDeps } from "../src/lib/api";
import { cacheStore, clearCache } from "../src/lib/cache";
import { deleteDeviceId, deviceStorage, getDeviceId } from "../src/lib/device";
import { pushDeps, registerForPush } from "../src/lib/push";
import { wipeAllData } from "../src/lib/wipe";
import { useTheme } from "../src/theme/ThemeProvider";
import type { ThemePreference } from "../src/theme/tokens";

/** 개인정보처리방침(한글) URL — 스토어 제출 필수. 실제 URL은 배포 시 확정(ARCHITECTURE 스토어 정책). */
const PRIVACY_POLICY_URL = "https://unboxing.app/privacy";

const apiDeps: ApiDeps = {
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  getDeviceId: () =>
    getDeviceId({ storage: deviceStorage, randomBytes: Crypto.getRandomBytes }),
};

const PLATFORM: "ios" | "android" = Platform.OS === "ios" ? "ios" : "android";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "시스템 설정 따름" },
  { value: "light", label: "라이트" },
  { value: "dark", label: "다크" },
];

export default function SettingsScreen() {
  const { tokens, preference, setPreference } = useTheme();
  const [notifGranted, setNotifGranted] = useState<boolean | null>(null);

  // 포커스 복귀 시 권한 재확인(시스템 설정에서 바꾸고 돌아온 경우 반영).
  useFocusEffect(
    useCallback(() => {
      void pushDeps.getPermissions().then((p) => setNotifGranted(p.granted));
    }, []),
  );

  // 알림: 허용이면 시스템 설정으로(앱에서 OS 권한 끌 수 없음), 미허용이면 요청(priming은 온보딩에서 선행).
  const onNotif = () => {
    if (notifGranted) {
      void Linking.openSettings();
      return;
    }
    void (async () => {
      try {
        const result = await registerForPush(pushDeps);
        if ("token" in result) {
          await registerDevice(result.token, PLATFORM, apiDeps);
          setNotifGranted(true);
        } else {
          void Linking.openSettings(); // 거부 — 시스템 설정에서만 켤 수 있음.
        }
      } catch {
        // 토큰/등록 실패는 조용히 — 알림만 비활성, 앱은 계속 동작.
      }
    })();
  };

  const doWipe = async () => {
    try {
      await wipeAllData({
        deleteMe: () => deleteMe(apiDeps),
        clearCache: () => clearCache({ store: cacheStore }),
        deleteDeviceId: () => deleteDeviceId({ storage: deviceStorage }),
      });
      router.replace("/"); // 복구 불가 — 빈 상태로 복귀.
    } catch {
      Alert.alert("삭제하지 못했어요", "잠시 후 다시 시도해 주세요");
    }
  };

  const onWipe = () => {
    Alert.alert(
      "모든 데이터 삭제",
      "등록한 운송장과 알림 설정이 모두 삭제돼요. 되돌릴 수 없어요.",
      [
        { text: "취소", style: "cancel" },
        { text: "삭제", style: "destructive", onPress: doWipe },
      ],
    );
  };

  const version = Constants.expoConfig?.version ?? "—";

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.bg.page }]} edges={["bottom"]}>
      <Stack.Screen options={{ title: "설정" }} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* 알림 */}
        <Text style={[styles.section, { color: tokens.text.secondary }]}>알림</Text>
        <Pressable
          onPress={onNotif}
          style={[styles.card, { backgroundColor: tokens.bg.surface, borderColor: tokens.border }]}
          accessibilityRole="button"
          accessibilityLabel={notifGranted ? "알림 설정 열기" : "알림 켜기"}
        >
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, { color: tokens.text.primary }]}>배송 상태 알림</Text>
            <Text style={[styles.rowSub, { color: tokens.text.secondary }]}>
              {notifGranted
                ? "켜짐 — 배송 상태가 바뀌면 알려드려요"
                : "꺼짐 — 배송 상태가 바뀌면 알려드려요"}
            </Text>
          </View>
          <Text style={{ color: tokens.text.secondary }}>
            {notifGranted ? "시스템 설정 ›" : "켜기 ›"}
          </Text>
        </Pressable>

        {/* 테마 */}
        <Text style={[styles.section, { color: tokens.text.secondary }]}>테마</Text>
        <View style={[styles.group, { backgroundColor: tokens.bg.surface, borderColor: tokens.border }]}>
          {THEME_OPTIONS.map((opt, i) => {
            const selected = preference === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setPreference(opt.value)}
                style={[styles.groupRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.border }]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={{ color: selected ? tokens.stage.outForDelivery : tokens.text.body }}>
                  {opt.label}
                </Text>
                {selected && <Text style={{ color: tokens.stage.outForDelivery }}>✓</Text>}
              </Pressable>
            );
          })}
        </View>

        {/* 개인정보처리방침 */}
        <Pressable
          onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
          style={[styles.card, styles.cardSpaced, { backgroundColor: tokens.bg.surface, borderColor: tokens.border }]}
          accessibilityRole="link"
          accessibilityLabel="개인정보처리방침 열기"
        >
          <Text style={[styles.rowTitle, { color: tokens.text.primary }]}>개인정보처리방침</Text>
          <Text style={{ color: tokens.text.secondary }}>›</Text>
        </Pressable>

        {/* 모든 데이터 삭제 */}
        <Pressable
          onPress={onWipe}
          style={[styles.card, styles.cardSpaced, { backgroundColor: tokens.bg.surface, borderColor: tokens.border }]}
          accessibilityRole="button"
          accessibilityLabel="모든 데이터 삭제"
        >
          <Text style={[styles.rowTitle, { color: tokens.stage.exception, fontWeight: "600" }]}>
            모든 데이터 삭제
          </Text>
        </Pressable>
        <Text style={[styles.caption, { color: tokens.text.secondary }]}>
          등록한 운송장과 설정이 모두 사라지고 되돌릴 수 없어요.
        </Text>

        {/* 버전 */}
        <Text style={[styles.version, { color: tokens.text.disabled }]}>버전 {version}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16 },
  section: { fontSize: 13, marginTop: 16, marginBottom: 8 },
  card: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  cardSpaced: { marginTop: 24 },
  rowText: { flex: 1, gap: 4, paddingRight: 12 },
  rowTitle: { fontSize: 16 },
  rowSub: { fontSize: 13 },
  group: { borderWidth: 1, borderRadius: 8, overflow: "hidden" },
  groupRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  caption: { fontSize: 13, marginTop: 8, lineHeight: 18 },
  version: { fontSize: 13, marginTop: 32, textAlign: "center" },
});
