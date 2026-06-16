/**
 * 단계 배지 — 색(토큰) + 글리프(아이콘) + 한글 라벨. **색 단독 금지**(UI_GUIDE 접근성).
 * 색은 tokens.stage(5색)만 참조 — hex 하드코딩 금지. ARCHITECTURE 표준 7단계(+기타)와 1:1.
 * 아이콘 라이브러리 미사용 → 단색 글리프로 라인 아이콘을 대신(색+모양+텍스트로 구분).
 */
import { StyleSheet, Text, View } from "react-native";
import type { Stage } from "../lib/api";
import { useTheme } from "../theme/ThemeProvider";
import type { ColorTokens } from "../theme/tokens";

type StageColorKey = keyof ColorTokens["stage"];

/** 단계 → 색 키·글리프. 라벨은 단계명 그대로(색에 의존하지 않는 텍스트 구분자). */
const STAGE_META: Record<Stage, { color: StageColorKey; glyph: string }> = {
  미등록: { color: "unregistered", glyph: "○" },
  등록: { color: "neutral", glyph: "•" },
  집화: { color: "neutral", glyph: "•" },
  이동중: { color: "neutral", glyph: "•" },
  배송출발: { color: "outForDelivery", glyph: "▸" },
  배송완료: { color: "delivered", glyph: "✓" },
  예외: { color: "exception", glyph: "!" },
  기타: { color: "neutral", glyph: "•" },
};

export function StageBadge({ stage }: { stage: Stage }) {
  const { tokens } = useTheme();
  const meta = STAGE_META[stage];
  const color = tokens.stage[meta.color];
  return (
    <View
      style={styles.badge}
      accessibilityRole="text"
      accessibilityLabel={`단계: ${stage}`}
    >
      <Text style={[styles.glyph, { color }]}>{meta.glyph}</Text>
      <Text style={[styles.label, { color }]}>{stage}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  glyph: {
    fontSize: 13,
    fontWeight: "600",
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
  },
});
