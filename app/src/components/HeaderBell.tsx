/**
 * 헤더 알림 종 + 미읽음 배지(공용) — 택배함·대시보드 헤더 우측(ADR-023, UI_GUIDE "헤더 알림 종").
 * 미읽음 수(unread)는 부모가 08 unreadCount 로 계산해 prop 으로 준다 — 여기선 badgeText(99+ 상한)로 표시만.
 * 탭 → /notifications. 색은 토큰만(배지 배경 accent·글자 onAccent). 터치 타깃 ≥44, a11y 라벨에 미읽음 수.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Bell } from "./icons";
import { badgeText } from "../lib/notif";
import { useTheme } from "../theme/ThemeProvider";
import { fontSize, fontWeight } from "../theme/layout";

export function HeaderBell({ unread }: { unread: number }) {
  const { tokens } = useTheme();
  const text = badgeText(unread);
  return (
    <Pressable
      onPress={() => router.push("/notifications")}
      hitSlop={8}
      style={styles.btn}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `알림(미읽음 ${unread}개)` : "알림"}
    >
      <Bell size={24} color={tokens.text.primary} />
      {/* 미읽음 0 이면 배지 없음(색 단독 아님 — 종 아이콘 + 숫자/라벨). */}
      {text !== "" && (
        <View style={[styles.badge, { backgroundColor: tokens.accent }]}>
          <Text style={[styles.badgeText, { color: tokens.onAccent }]}>{text}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 터치 타깃 ≥44(아이콘 24 + 패딩 10*2).
  btn: { padding: 10, margin: -10 },
  // 종 우상단에 얹는 작은 배지(원형, 1~2자리·99+).
  badge: {
    position: "absolute",
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: fontSize.micro, fontWeight: fontWeight.semibold },
});
