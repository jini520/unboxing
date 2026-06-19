/**
 * 단계 진행 인디케이터 — happy-path 5단계(등록→집화→이동중→배송출발→배송완료) 가로 스텝퍼.
 * 색 단독 금지(UI_GUIDE): 현재 단계 = 색(stage 토큰) + SVG 글리프 + 굵은 라벨. 지난=채움 점·이후=빈 점.
 * off-track 은 선형 매핑하지 않는다(stageProgress): pre(미등록·기타)=전부 비활성, exception(예외)=예외 배지 + 흐린 바.
 * 위치 계산은 순수 헬퍼 stageProgress(lib/stage). 색·아이콘 소스는 StageBadge 의 STAGE_META(단일 출처).
 */
import type { ComponentType } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Stage } from "../lib/api";
import { STAGE_PROGRESS_STEPS, stageProgress } from "../lib/stage";
import { useTheme } from "../theme/ThemeProvider";
import { fontSize, fontWeight, spacing } from "../theme/layout";
import {
  AlertTriangle,
  CheckCircle,
  ClipboardCheck,
  MapPin,
  Package,
  Truck,
  type IconProps,
} from "./icons";
import { STAGE_META } from "./StageBadge";

/** 진행 5단계 각각의 아이콘(점 위에 표시) — STAGE_PROGRESS_STEPS 와 1:1 순서. */
const STEP_ICONS: ComponentType<IconProps>[] = [
  ClipboardCheck, // 등록
  Package, // 집화
  Truck, // 이동중
  MapPin, // 배송출발
  CheckCircle, // 배송완료
];

export function StageProgress({ stage }: { stage: Stage }) {
  const { tokens } = useTheme();
  const { index, track } = stageProgress(stage);
  const last = STAGE_PROGRESS_STEPS.length - 1;

  // 현재 단계(normal track)의 색 — STAGE_META 재사용(아이콘은 단계별 STEP_ICONS).
  const currentColor = tokens.stage[STAGE_META[stage].color];

  const a11yLabel =
    track === "normal"
      ? `배송 단계: ${stage}, ${index + 1}/${STAGE_PROGRESS_STEPS.length}`
      : `배송 단계: ${stage}`;

  return (
    <View accessibilityRole="text" accessibilityLabel={a11yLabel}>
      {track === "exception" && (
        <View style={styles.exceptionRow}>
          <AlertTriangle
            size={16}
            color={tokens.stage.exception}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <Text style={[styles.exceptionLabel, { color: tokens.stage.exception }]}>
            예외 — 확인이 필요해요
          </Text>
        </View>
      )}
      {/* 스텝 라벨/점은 시각 보조 — a11y 는 위 컨테이너 라벨로 단일 announce(중복 방지). */}
      <View
        style={styles.steps}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {STAGE_PROGRESS_STEPS.map((s, i) => {
          const isCurrent = track === "normal" && i === index;
          const isPast = track === "normal" && i < index;
          // 연결선: 왼쪽=세그먼트(i-1,i) 도달 = i<=index · 오른쪽=세그먼트(i,i+1) 도달 = i<index.
          const leftActive = track === "normal" && i <= index;
          const rightActive = track === "normal" && i < index;
          const lineColor = (active: boolean) =>
            active ? tokens.text.secondary : tokens.border;

          const labelColor = isCurrent
            ? currentColor
            : isPast
              ? tokens.text.body
              : tokens.text.disabled;

          // 단계별 아이콘을 점 위에 — 현재=강조 색·크게, 지난=중립, 이후=비활성.
          const StepIcon = STEP_ICONS[i];
          const iconColor = isCurrent
            ? currentColor
            : isPast
              ? tokens.text.secondary
              : tokens.text.disabled;

          return (
            <View key={s} style={styles.step}>
              {/* 단계 아이콘 — 점 '위에'(점을 대체하지 않음). 현재=강조 색·크게. */}
              <View style={styles.iconWrap}>
                <StepIcon
                  size={isCurrent ? 32 : 30}
                  color={iconColor}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              </View>
              {/* 진행 트랙: 연결선 — 점 — 연결선 */}
              <View style={styles.nodeRow}>
                <View
                  style={[styles.line, { backgroundColor: i === 0 ? "transparent" : lineColor(leftActive) }]}
                />
                <View style={styles.nodeBox}>
                  {isCurrent ? (
                    <View style={[styles.dotCurrent, { backgroundColor: currentColor }]} />
                  ) : isPast ? (
                    <View style={[styles.dot, { backgroundColor: tokens.text.secondary }]} />
                  ) : (
                    <View style={[styles.dotOutline, { borderColor: tokens.text.disabled }]} />
                  )}
                </View>
                <View
                  style={[styles.line, { backgroundColor: i === last ? "transparent" : lineColor(rightActive) }]}
                />
              </View>
              <Text
                style={[styles.label, { color: labelColor }, isCurrent && styles.labelCurrent]}
                numberOfLines={1}
              >
                {s}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  exceptionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: spacing.md,
  },
  exceptionLabel: {
    fontSize: fontSize.footnote,
    fontWeight: fontWeight.semibold,
  },
  steps: {
    flexDirection: "row",
  },
  step: {
    flex: 1,
    alignItems: "center",
  },
  // 아이콘 — 점 위. 고정 높이로 크기(32/36)가 달라도 점 정렬이 흐트러지지 않게.
  iconWrap: {
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  nodeRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    justifyContent: "center",
    height: 14,
  },
  line: {
    flex: 1,
    height: 2,
  },
  nodeBox: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotCurrent: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  dotOutline: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
  },
  label: {
    fontSize: fontSize.micro,
    marginTop: 6,
    textAlign: "center",
  },
  labelCurrent: {
    fontWeight: fontWeight.bold,
  },
});
