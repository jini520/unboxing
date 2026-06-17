/**
 * 단계 진행 인디케이터 — happy-path 5단계(등록→집화→이동중→배송출발→배송완료) 가로 스텝퍼.
 * 색 단독 금지(UI_GUIDE): 현재 단계 = 색(stage 토큰) + SVG 글리프 + 굵은 라벨. 지난=채움 점·이후=빈 점.
 * off-track 은 선형 매핑하지 않는다(stageProgress): pre(미등록·기타)=전부 비활성, exception(예외)=예외 배지 + 흐린 바.
 * 위치 계산은 순수 헬퍼 stageProgress(lib/stage). 색·아이콘 소스는 StageBadge 의 STAGE_META(단일 출처).
 */
import { StyleSheet, Text, View } from "react-native";
import type { Stage } from "../lib/api";
import { STAGE_PROGRESS_STEPS, stageProgress } from "../lib/stage";
import { useTheme } from "../theme/ThemeProvider";
import { AlertTriangle } from "./icons";
import { STAGE_META } from "./StageBadge";

export function StageProgress({ stage }: { stage: Stage }) {
  const { tokens } = useTheme();
  const { index, track } = stageProgress(stage);
  const last = STAGE_PROGRESS_STEPS.length - 1;

  // 현재 단계(normal track)의 색·글리프 — STAGE_META 재사용.
  const currentColor = tokens.stage[STAGE_META[stage].color];
  const CurrentIcon = STAGE_META[stage].icon;

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

          return (
            <View key={s} style={styles.step}>
              <View style={styles.nodeRow}>
                <View
                  style={[styles.line, { backgroundColor: i === 0 ? "transparent" : lineColor(leftActive) }]}
                />
                <View style={styles.nodeBox}>
                  {isCurrent ? (
                    <CurrentIcon size={20} color={currentColor} />
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
    marginBottom: 12,
  },
  exceptionLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  steps: {
    flexDirection: "row",
  },
  step: {
    flex: 1,
    alignItems: "center",
  },
  nodeRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    justifyContent: "center",
    height: 24,
  },
  line: {
    flex: 1,
    height: 2,
  },
  nodeBox: {
    width: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotOutline: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
  },
  label: {
    fontSize: 11,
    marginTop: 6,
    textAlign: "center",
  },
  labelCurrent: {
    fontWeight: "700",
  },
});
