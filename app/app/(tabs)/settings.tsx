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
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { deleteMe, registerDevice } from "../../src/lib/api";
import { resetDeviceRegistered } from "../../src/lib/bootstrap";
import { apiDeps, PLATFORM } from "../../src/lib/deps";
import { cacheStore, clearCache } from "../../src/lib/cache";
import { clearMemos, memoStore } from "../../src/lib/memo";
import { deleteDeviceId, deviceStorage } from "../../src/lib/device";
import { pushDeps, registerForPush, registerPushIfGranted } from "../../src/lib/push";
import { clearLocalStores, wipeAllData } from "../../src/lib/wipe";
import { Check, ChevronRight } from "../../src/components/icons";
import { useTheme } from "../../src/theme/ThemeProvider";
import { fontSize, fontWeight, radius, spacing } from "../../src/theme/layout";
import type { ThemePreference } from "../../src/theme/tokens";

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
  // notifGranted state(비동기 로딩, 첫 탭 시 null 가능)에 의존하지 않고 **항상 최신 권한을 직접 확인**한다.
  const onNotif = () => {
    void (async () => {
      try {
        const perm = await pushDeps.getPermissions();
        if (perm.granted) {
          setNotifGranted(true);
          void Linking.openSettings();
          return;
        }
        const result = await registerForPush(pushDeps);
        if ("token" in result) {
          await registerDevice(result.token, PLATFORM, apiDeps);
          setNotifGranted(true);
        } else {
          setNotifGranted(false);
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
        clearMemos: () => clearMemos({ store: memoStore }),
        clearLocal: () => clearLocalStores(cacheStore),
        deleteDeviceId: () => deleteDeviceId({ storage: deviceStorage }),
      });
      // device_id 가 폐기됐다 — 다음 api 호출이 새 device_id 를 생성한다(getDeviceId 멱등).
      // 부트스트랩 캐시를 비워 새 device_id 가 다음 등록 시 재등록되게 한다(QA-001 데드락 재발 방지).
      resetDeviceRegistered();
      // OS 권한이 남아 있으면 새 device_id 에 push_token 을 즉시 재등록한다(앱 재시작 전까지 푸시 누락 방지).
      try {
        await registerPushIfGranted(pushDeps, (token) => registerDevice(token, PLATFORM, apiDeps));
      } catch {
        // 재등록 실패는 조용히 — 다음 앱 재시작 시 usePushNotifications 가 재시도.
      }
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
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.bg.page }]} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* 페이지 제목 + 설명 — 택배함과 동일한 스타일. */}
        <Text style={[styles.title, { color: tokens.text.primary }]}>설정</Text>
        <Text style={[styles.pageDesc, { color: tokens.text.secondary }]}>
          알림과 테마를 관리해요
        </Text>

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
          <View style={styles.rowEnd}>
            <Text style={{ color: tokens.text.secondary }}>
              {notifGranted ? "시스템 설정" : "켜기"}
            </Text>
            <ChevronRight
              size={18}
              color={tokens.text.secondary}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </View>
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
                <Text style={{ color: selected ? tokens.accent : tokens.text.body }}>
                  {opt.label}
                </Text>
                {selected && (
                  <Check
                    size={18}
                    color={tokens.accent}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                )}
              </Pressable>
            );
          })}
        </View>

        {/* 개인정보처리방침 — 인앱 화면으로 이동(웹에서 보기 링크는 화면 내 제공) */}
        <Pressable
          onPress={() => router.push("/privacy")}
          style={[styles.card, styles.cardSpaced, { backgroundColor: tokens.bg.surface, borderColor: tokens.border }]}
          accessibilityRole="button"
          accessibilityLabel="개인정보처리방침 열기"
        >
          <Text style={[styles.rowTitle, { color: tokens.text.primary }]}>개인정보처리방침</Text>
          <ChevronRight
            size={18}
            color={tokens.text.secondary}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </Pressable>

        {/* 모든 데이터 삭제 */}
        <Pressable
          onPress={onWipe}
          style={[styles.card, styles.cardSpaced, { backgroundColor: tokens.bg.surface, borderColor: tokens.border }]}
          accessibilityRole="button"
          accessibilityLabel="모든 데이터 삭제"
        >
          <Text style={[styles.rowTitle, { color: tokens.stage.exception, fontWeight: fontWeight.semibold }]}>
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
  // 택배함 헤더와 동일한 상단 위치(paddingTop 8) — 제목/설명 위치 일치.
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  // 페이지 제목 + 설명 — 택배함 헤더와 동일.
  title: { fontSize: fontSize.display1, fontWeight: fontWeight.semibold },
  pageDesc: { fontSize: fontSize.footnote, lineHeight: 19, marginTop: 10 },
  section: { fontSize: fontSize.footnote, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  cardSpaced: { marginTop: spacing.xl },
  rowText: { flex: 1, gap: spacing.xs, paddingRight: spacing.md },
  rowEnd: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  rowTitle: { fontSize: fontSize.base },
  rowSub: { fontSize: fontSize.footnote },
  group: { borderWidth: 1, borderRadius: radius.md, overflow: "hidden" },
  groupRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  caption: { fontSize: fontSize.footnote, marginTop: spacing.sm, lineHeight: 18 },
  version: { fontSize: fontSize.footnote, marginTop: spacing.xxl, textAlign: "center" },
});
