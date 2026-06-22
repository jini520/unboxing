/**
 * 단계 배지 — 색(토큰) + SVG 아이콘 + 한글 라벨. **색 단독 금지**(UI_GUIDE 접근성).
 * 색은 tokens.stage(6색)만 참조 — hex 하드코딩 금지. ARCHITECTURE 표준 7단계(+기타)와 1:1.
 * 아이콘은 SVG 라인 아이콘(components/icons) — OS 이모지/유니코드 글리프 전면 금지(사용자 요구).
 */
import type { ComponentType } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Stage } from "../lib/api";
import { useTheme } from "../theme/ThemeProvider";
import { fontSize, fontWeight, spacing } from "../theme/layout";
import type { ColorTokens } from "../theme/tokens";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  DotSmall,
  MapPin,
  Package,
  Truck,
  type IconProps,
} from "./icons";

export type StageColorKey = keyof ColorTokens["stage"];

/** 단계 → 색 키·SVG 아이콘. 라벨은 단계명 그대로(색에 의존하지 않는 텍스트 구분자). StageProgress 도 재사용. */
export const STAGE_META: Record<Stage, { color: StageColorKey; icon: ComponentType<IconProps> }> = {
  미등록: { color: "unregistered", icon: Clock },
  등록: { color: "neutral", icon: DotSmall },
  집화: { color: "neutral", icon: Package }, // 아이콘만 차별화(상자), 색은 중립 유지
  이동중: { color: "inTransit", icon: MapPin }, // 노란색 + 경로(MapPin) — 배송출발 Truck 과 구분
  배송출발: { color: "outForDelivery", icon: Truck },
  배송완료: { color: "delivered", icon: CheckCircle },
  예외: { color: "exception", icon: AlertTriangle },
  기타: { color: "neutral", icon: DotSmall },
};

export function StageBadge({ stage }: { stage: Stage }) {
  const { tokens } = useTheme();
  const meta = STAGE_META[stage];
  const color = tokens.stage[meta.color];
  const Icon = meta.icon;
  return (
    <View
      style={styles.badge}
      accessibilityRole="text"
      accessibilityLabel={`단계: ${stage}`}
    >
      {/* 아이콘은 장식 — 배지 컨테이너가 라벨 제공(a11y 중복 방지). */}
      <Icon
        size={14}
        color={color}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Text style={[styles.label, { color }]}>{stage}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  label: {
    fontSize: fontSize.footnote,
    fontWeight: fontWeight.semibold,
  },
});
