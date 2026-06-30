/**
 * 운송장 등록 바로가기 FAB(공용) — 대시보드·택배함 우하단 원형(ADR-042, UI_GUIDE "v1.1.3 송장 등록 FAB").
 * accent 원형 + onAccent Plus 글리프. 라이트만 옅은 그림자(다크는 그림자 금지 — 카드 규칙 일관).
 * 위치는 호출부 SafeAreaView 기준 절대배치(right/bottom = 하단 inset + spacing.lg). 색은 토큰만(hex 금지).
 * 노출 조건(빈 상태·멀티선택 숨김)은 **호출부**가 판단 — 이 컴포넌트는 렌더만(중복 구현 금지).
 */
import { Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Plus } from "./icons";
import { useTheme } from "../theme/ThemeProvider";
import { spacing } from "../theme/layout";

const SIZE = 56;

export function Fab({ onPress, label }: { onPress: () => void; label: string }) {
  const { tokens, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.fab,
        // 라이트 전용 옅은 그림자(다크 미적용 — 카드 규칙 일관, ADR-042).
        scheme === "light" && styles.shadow,
        {
          backgroundColor: tokens.accent,
          right: spacing.lg,
          bottom: insets.bottom + spacing.lg,
        },
      ]}
    >
      <Plus size={28} color={tokens.onAccent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 지름 56 원형(터치 타깃 ≥44 충족). 절대배치 — 위치 토큰은 인라인(inset 의존).
  fab: {
    position: "absolute",
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  // iOS shadow* + Android elevation — 옅게(라이트만 적용).
  shadow: {
    shadowColor: "black",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
});
