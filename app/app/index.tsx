/**
 * 목록 화면 플레이스홀더 — 토대 단계의 최소 화면(step5가 실제 목록으로 교체).
 * 색은 시맨틱 토큰만 사용(하드코딩 금지, UI_GUIDE).
 */
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../src/theme/ThemeProvider";

export default function ListScreen() {
  const { tokens } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: tokens.bg.page }]}>
      <Text style={{ color: tokens.text.primary }}>unboxing</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
