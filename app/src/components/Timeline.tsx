/**
 * 타임라인 — 세로 단계 점(현재=최신 강조) + 시각(KST 상대+절대) + 설명/허브명.
 * 실시간 조회 결과만 표시(ADR-011 — 로컬 저장/캐시 금지). 최신이 위(시각 내림차순).
 * 색은 토큰만. 허브명(위치)은 비개인정보로 간주(ADR-005).
 */
import { StyleSheet, Text, View } from "react-native";
import type { TimelineEvent } from "../lib/api";
import { absoluteKST, relativeTime } from "../lib/time";
import { useTheme } from "../theme/ThemeProvider";

export function Timeline({ events, now }: { events: TimelineEvent[]; now: number }) {
  const { tokens } = useTheme();
  // 최신이 위 — 서버 정렬에 의존하지 않고 시각 내림차순으로 결정적 표시.
  const ordered = [...events].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));

  if (ordered.length === 0) {
    return <Text style={{ color: tokens.text.secondary }}>표시할 이동 내역이 없어요</Text>;
  }

  return (
    <View>
      {ordered.map((e, i) => {
        const current = i === 0;
        const dotColor = current ? tokens.text.primary : tokens.text.disabled;
        const labelColor = current ? tokens.text.primary : tokens.text.body;
        return (
          <View key={`${e.time}-${i}`} style={styles.row}>
            <View style={styles.rail}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: dotColor },
                  current && styles.dotCurrent,
                ]}
              />
              {i < ordered.length - 1 && (
                <View style={[styles.line, { backgroundColor: tokens.border }]} />
              )}
            </View>
            <View style={styles.body}>
              <Text
                style={[styles.time, { color: tokens.text.secondary }]}
                accessibilityLabel={`${absoluteKST(e.time)} (${relativeTime(e.time, now)})`}
              >
                {relativeTime(e.time, now)} · {absoluteKST(e.time)}
              </Text>
              {e.description ? (
                <Text style={[styles.desc, { color: labelColor }, current && styles.descCurrent]}>
                  {e.description}
                </Text>
              ) : null}
              {e.location ? (
                <Text style={[styles.location, { color: tokens.text.secondary }]}>{e.location}</Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 12,
  },
  rail: {
    alignItems: "center",
    width: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
  dotCurrent: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 3,
  },
  line: {
    width: 1,
    flex: 1,
    marginTop: 2,
    minHeight: 16,
  },
  body: {
    flex: 1,
    paddingBottom: 20,
  },
  time: {
    fontSize: 12,
  },
  desc: {
    fontSize: 14,
    marginTop: 2,
  },
  descCurrent: {
    fontWeight: "600",
  },
  location: {
    fontSize: 13,
    marginTop: 1,
  },
});
