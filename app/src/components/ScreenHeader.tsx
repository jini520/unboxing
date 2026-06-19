/**
 * 화면 상단 커스텀 헤더 — 네이티브 헤더 대신(루트 Stack headerShown:false).
 * 뒤로가기는 **배경 없는 아이콘만**(iOS 네이티브 헤더 버튼의 glass capsule 배경 제거 요구).
 * 선택적으로 그 아래 작은 title + 설명을 둔다(등록 화면 등). SafeArea 상단 inset 직접 처리.
 * 색은 토큰만. 뒤로 갈 스택이 없으면(딥링크 직접 진입) 홈으로 — GO_BACK 미처리 경고 방지.
 */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "./icons";
import { useTheme } from "../theme/ThemeProvider";
import { fontSize, fontWeight, spacing } from "../theme/layout";

export function ScreenHeader({
  title,
  description,
  right,
}: {
  title?: string;
  description?: string;
  /** 우상단 액션 슬롯(예: 메모 편집 아이콘). */
  right?: ReactNode;
}) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ paddingTop: insets.top }}>
      <View style={styles.topRow}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={8}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="뒤로"
        >
          <ChevronLeft size={26} color={tokens.text.primary} />
        </Pressable>
        {right ?? null}
      </View>
      {title ? (
        <Text style={[styles.title, { color: tokens.text.primary }]} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
      {description ? (
        <Text style={[styles.description, { color: tokens.text.secondary }]}>{description}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  // 배경 없음 — 아이콘만. 터치 타깃 ≥44(아이콘 26 + 패딩).
  back: { alignSelf: "flex-start", paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  title: { fontSize: fontSize.title1, fontWeight: fontWeight.bold, paddingHorizontal: spacing.lg, marginTop: spacing.xs },
  description: { fontSize: fontSize.footnote, lineHeight: 19, paddingHorizontal: spacing.lg, marginTop: 10 },
});
