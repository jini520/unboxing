/**
 * 송장 카드 — 좌측정렬: 단계배지 · 택배사·끝4자리 · 한 줄 요약 · 상대시간.
 * 탭 → 상세, 좌측 스와이프 → 삭제(부모가 Undo 토스트 처리). RN 코어(PanResponder/Animated)만 사용.
 * 색은 토큰만(하드코딩 금지). 상태는 색 단독 금지 — StageBadge가 색+글리프+라벨로 표시.
 * 택배사 한글명 매핑은 등록(자동인식) step 소관 — 여기선 carrier id 를 그대로 표기.
 */
import { memo, useRef } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { Shipment, Stage } from "../lib/api";
import { relativeTime } from "../lib/time";
import { useTheme } from "../theme/ThemeProvider";
import { StageBadge } from "./StageBadge";

/** 단계별 친근한 한 줄 요약(목록 카드용). 기술 용어·에러 코드 노출 금지(PRD 톤). */
const STAGE_SUMMARY: Record<Stage, string> = {
  미등록: "아직 조회 전이에요",
  등록: "접수가 확인됐어요",
  집화: "택배사가 상품을 수거했어요",
  이동중: "이동 중이에요",
  배송출발: "오늘 도착 예정이에요",
  배송완료: "배송이 완료됐어요",
  예외: "확인이 필요해요",
  기타: "상태를 확인 중이에요",
};

const SWIPE_THRESHOLD = 80;

function ShipmentCardBase({
  shipment,
  now,
  onPress,
  onDelete,
}: {
  shipment: Shipment;
  now: number;
  onPress: () => void;
  onDelete: () => void;
}) {
  const { tokens } = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;

  const pan = useRef(
    PanResponder.create({
      // 수평 좌측 드래그일 때만 제스처를 가로챈다 → 탭은 Pressable로 통과.
      onMoveShouldSetPanResponder: (_e, g) =>
        g.dx < -8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_e, g) => {
        translateX.setValue(Math.min(0, g.dx));
      },
      onPanResponderRelease: (_e, g) => {
        // 임계를 넘으면 제자리로 복귀시키고 삭제를 부모에 위임한다(부모가 확인 다이얼로그 → 확인 시 제거,
        // 취소 시 카드는 이미 원위치라 그대로 유지 — UI_GUIDE "확인 다이얼로그 + Undo").
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        if (g.dx < -SWIPE_THRESHOLD) onDelete();
      },
    }),
  ).current;

  const last4 = shipment.trackingNo.slice(-4);

  return (
    <View style={styles.wrap}>
      {/* 스와이프로 드러나는 삭제 어포던스 — destructive=예외 색 텍스트(UI_GUIDE). 토큰만. */}
      <View style={[styles.deleteBg, { backgroundColor: tokens.bg.secondary }]}>
        <Text style={[styles.deleteText, { color: tokens.stage.exception }]}>삭제</Text>
      </View>
      <Animated.View
        style={[
          styles.card,
          { backgroundColor: tokens.bg.surface, borderColor: tokens.border },
          { transform: [{ translateX }] },
        ]}
        {...pan.panHandlers}
      >
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${shipment.carrier} ${last4}, ${shipment.status}`}
          accessibilityHint="두 번 탭하면 상세를 봐요"
        >
          <View style={styles.topRow}>
            <StageBadge stage={shipment.status} />
            <Text style={[styles.time, { color: tokens.text.secondary }]}>
              {relativeTime(shipment.createdAt, now)}
            </Text>
          </View>
          <Text style={[styles.carrier, { color: tokens.text.secondary }]}>
            {shipment.carrier} · {last4}
          </Text>
          <Text style={[styles.summary, { color: tokens.text.body }]}>
            {STAGE_SUMMARY[shipment.status]}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** memo: 목록 re-render(새로고침·undo 토스트 토글) 시 변경 없는 카드의 재렌더(PanResponder 재설정) 방지. */
export const ShipmentCard = memo(ShipmentCardBase);

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 10,
  },
  deleteBg: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
    alignItems: "flex-end",
    justifyContent: "center",
    paddingRight: 20,
  },
  deleteText: {
    fontWeight: "600",
    fontSize: 14,
  },
  card: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  time: {
    fontSize: 12,
  },
  carrier: {
    fontSize: 14,
    fontWeight: "500",
    marginTop: 8,
  },
  summary: {
    fontSize: 14,
    marginTop: 4,
  },
});
