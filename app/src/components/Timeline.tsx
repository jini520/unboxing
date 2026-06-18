/**
 * 타임라인 — 세로 단계 점(현재=최신 강조) + 시각(KST 상대+절대) + 설명/허브명.
 * 실시간 조회 결과만 표시(ADR-011 — 로컬 저장/캐시 금지). 최신이 위(시각 내림차순).
 * 색은 토큰만. 허브명(위치)은 비개인정보로 간주(ADR-005).
 */
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { TimelineEvent } from "../lib/api";
import { absoluteKST, relativeTime } from "../lib/time";
import { ChevronDown } from "./icons";
import { useTheme } from "../theme/ThemeProvider";

const COLLAPSED_COUNT = 5; // 첫 렌더 시 이만큼만 보이고 나머지는 '더보기'로 펼친다.

export function Timeline({ events, now }: { events: TimelineEvent[]; now: number }) {
  const { tokens } = useTheme();
  const [expanded, setExpanded] = useState(false);
  // 최신이 위 — 서버 정렬에 의존하지 않고 시각 내림차순으로 결정적 표시.
  const ordered = [...events].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));

  if (ordered.length === 0) {
    return <Text style={{ color: tokens.text.secondary }}>표시할 이동 내역이 없어요</Text>;
  }

  // 5개 초과면 접어두고 하단 페이드 + '더보기'(화살표·중립 회색)로 펼친다.
  const collapsed = !expanded && ordered.length > COLLAPSED_COUNT;
  const visible = collapsed ? ordered.slice(0, COLLAPSED_COUNT) : ordered;

  return (
    <View>
      <View>
        {visible.map((e, i) => {
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
                {/* 마지막 보이는 항목이라도 collapsed면 라인을 이어 '아래 더 있음'을 암시. */}
                {(i < visible.length - 1 || collapsed) && (
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
        {/* 더보기 근처 페이드 — 배경색으로 서서히 사라지게(expo-blur 글래스모피즘 금지·UI_GUIDE). */}
        {collapsed && <FadeOverlay color={tokens.bg.page} />}
      </View>
      {collapsed && (
        <Pressable
          onPress={() => setExpanded(true)}
          style={styles.moreBtn}
          accessibilityRole="button"
          accessibilityLabel={`타임라인 더보기, ${ordered.length - COLLAPSED_COUNT}개 더`}
        >
          <ChevronDown size={18} color={tokens.text.secondary} />
          <Text style={[styles.moreLabel, { color: tokens.text.secondary }]}>더보기</Text>
        </Pressable>
      )}
    </View>
  );
}

/** 더보기 직전 영역을 배경색으로 페이드(반투명 레이어 적층 — 새 의존성 없이). */
function FadeOverlay({ color }: { color: string }) {
  const BANDS = 6;
  return (
    <View style={styles.fade} pointerEvents="none">
      {Array.from({ length: BANDS }).map((_, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: color, opacity: (i + 1) / BANDS }} />
      ))}
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
  // 더보기 — 버튼 형태 없이 화살표 + 텍스트(중립 회색).
  moreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },
  moreLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  // 페이드 — 마지막 보이는 항목 위에 깔려 배경색으로 사라지게.
  fade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 96,
  },
});
