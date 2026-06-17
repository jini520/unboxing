/**
 * 송장 카드 — 좌측정렬: 단계배지 · 택배사·운송장 전체번호 · 한 줄 요약 · 상대시간(상태 변경 기준).
 * 인터랙션(gesture-handler Swipeable, 양방향 reveal):
 *  - 좌측 스와이프 → 오른쪽에 **삭제** 버튼 노출(첫 스와이프는 노출만). 버튼 탭 또는 같은 방향 추가 스와이프 시 실행.
 *  - 우측 스와이프 → 왼쪽에 **음소거** 버튼 노출(켜기/끄기). 동일하게 탭 또는 추가 스와이프로 실행.
 *  실행은 부모에 위임(onDelete=낙관+Undo / onToggleMute=낙관+롤백). reveal 이 의도 확인 게이트라 별도 다이얼로그 없음.
 *  - 선택 모드(부모 롱프레스 진입): 스와이프 비활성·체크박스 표시·탭=선택 토글(상세 이동 아님).
 * 색은 토큰만(하드코딩 금지). 상태는 색 단독 금지 — StageBadge(색+글리프+라벨), 음소거는 아이콘+a11y 라벨.
 * 택배사명은 carrierName(carrier.ts) 로 한글 표기(미상 id 는 그대로 폴백).
 */
import { memo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import type { Shipment } from "../lib/api";
import { carrierName } from "../lib/carrier";
import { STAGE_SUMMARY } from "../lib/stage";
import { relativeTime } from "../lib/time";
import { useTheme } from "../theme/ThemeProvider";
import { Bell, BellOff, Check, Trash } from "./icons";
import { StageBadge } from "./StageBadge";

function ShipmentCardBase({
  shipment,
  now,
  selectionMode,
  selected,
  reduceMotion,
  onPress,
  onLongPress,
  onToggleSelect,
  onDelete,
  onToggleMute,
}: {
  shipment: Shipment;
  now: number;
  selectionMode: boolean;
  selected: boolean;
  reduceMotion: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onToggleSelect: () => void;
  onDelete: () => void;
  onToggleMute: () => void;
}) {
  const { tokens } = useTheme();
  const swipeRef = useRef<Swipeable>(null);
  // 첫 스와이프는 노출만, 같은 방향 추가 스와이프(=이미 열린 상태에서 onSwipeableOpen 재발화)에 실행한다.
  const openedRef = useRef<"left" | "right" | null>(null);

  const a11yLabel =
    `${carrierName(shipment.carrier)} ${shipment.trackingNo}, ${shipment.status}` +
    (shipment.muted ? ", 알림 꺼짐" : "");

  const content = (
    <View
      style={[
        styles.card,
        {
          backgroundColor: tokens.bg.surface,
          borderColor: selected ? tokens.text.primary : tokens.border,
        },
      ]}
    >
      <View style={styles.row}>
        {selectionMode && (
          // 체크박스 — 색 단독 아님(선택 시 체크 글리프 표시 + a11y selected 상태).
          <View
            style={[
              styles.checkbox,
              {
                borderColor: selected ? tokens.text.primary : tokens.border,
                backgroundColor: selected ? tokens.text.primary : "transparent",
              },
            ]}
          >
            {selected && (
              <Check
                size={14}
                color={tokens.bg.surface}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
            )}
          </View>
        )}
        <View style={styles.body}>
          <View style={styles.topRow}>
            <StageBadge stage={shipment.status} />
            <View style={styles.topRight}>
              {shipment.muted && (
                <BellOff
                  size={14}
                  color={tokens.text.secondary}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              )}
              <Text style={[styles.time, { color: tokens.text.secondary }]}>
                {relativeTime(shipment.statusChangedAt, now)}
              </Text>
            </View>
          </View>
          {/* 운송장 전체번호 — 본인 데이터라 끝4자리로 줄이지 않는다. 길면 잘림 없이 줄바꿈 허용. */}
          <Text style={[styles.carrier, { color: tokens.text.secondary }]}>
            {carrierName(shipment.carrier)} · {shipment.trackingNo}
          </Text>
          <Text style={[styles.summary, { color: tokens.text.body }]}>
            {STAGE_SUMMARY[shipment.status]}
          </Text>
        </View>
      </View>
    </View>
  );

  const inner = (
    <Pressable
      onPress={selectionMode ? onToggleSelect : onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={selectionMode ? { selected } : undefined}
      accessibilityHint={selectionMode ? "두 번 탭하면 선택을 바꿔요" : "두 번 탭하면 상세를 봐요"}
    >
      {content}
    </Pressable>
  );

  // 선택 모드: 스와이프 비활성(오작동 방지) — Swipeable 없이 바로 렌더.
  if (selectionMode) {
    return <View style={styles.wrap}>{inner}</View>;
  }

  const renderDelete = () => (
    <Pressable
      style={[styles.action, { backgroundColor: tokens.bg.secondary }]}
      onPress={() => {
        swipeRef.current?.close();
        onDelete();
      }}
      accessibilityRole="button"
      accessibilityLabel="삭제"
    >
      <Trash
        size={20}
        color={tokens.stage.exception}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Text style={[styles.actionText, { color: tokens.stage.exception }]}>삭제</Text>
    </Pressable>
  );

  const renderMute = () => (
    <Pressable
      style={[styles.action, { backgroundColor: tokens.bg.secondary }]}
      onPress={() => {
        swipeRef.current?.close();
        onToggleMute();
      }}
      accessibilityRole="button"
      accessibilityLabel={shipment.muted ? "알림 켜기" : "알림 끄기"}
    >
      {shipment.muted ? (
        <Bell
          size={20}
          color={tokens.text.secondary}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      ) : (
        <BellOff
          size={20}
          color={tokens.text.secondary}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      )}
      <Text style={[styles.actionText, { color: tokens.text.secondary }]}>
        {shipment.muted ? "알림 켜기" : "알림 끄기"}
      </Text>
    </Pressable>
  );

  const onOpen = (direction: "left" | "right", swipeable: Swipeable) => {
    if (openedRef.current === direction) {
      // 이미 노출된 상태에서 같은 방향으로 한 번 더(끝까지) 스와이프 → 실행.
      openedRef.current = null;
      swipeable.close();
      if (direction === "right") onDelete(); // 우측 패널(=좌측 스와이프) = 삭제
      else onToggleMute(); // 좌측 패널(=우측 스와이프) = 음소거
    } else {
      // 첫 스와이프: 버튼 노출만(실행 금지 — reveal 게이트).
      openedRef.current = direction;
    }
  };

  return (
    <View style={styles.wrap}>
      <Swipeable
        ref={swipeRef}
        friction={2}
        leftThreshold={28}
        rightThreshold={28}
        // reduce motion: 오버슈트(바운스) 제거로 열림 애니메이션 축소(시스템 설정 존중).
        overshootLeft={!reduceMotion}
        overshootRight={!reduceMotion}
        renderLeftActions={renderMute} // 우측 스와이프 → 왼쪽 패널 = 음소거
        renderRightActions={renderDelete} // 좌측 스와이프 → 오른쪽 패널 = 삭제
        onSwipeableOpen={onOpen}
        onSwipeableClose={() => {
          openedRef.current = null;
        }}
      >
        {inner}
      </Swipeable>
    </View>
  );
}

/** memo: 목록 re-render(새로고침·토스트 토글) 시 변경 없는 카드의 재렌더 방지. */
export const ShipmentCard = memo(ShipmentCardBase);

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 10,
  },
  card: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  // 선택 체크박스 — 터치는 카드 전체(≥44)가 받는다.
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  topRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
  // 스와이프로 드러나는 액션 버튼 — 폭 96(터치 타깃 ≥44). 색은 토큰만(destructive=예외 색).
  action: {
    width: 96,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  actionText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
