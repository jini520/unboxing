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
import { memo, useCallback, useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import type { Shipment } from "../lib/api";
import { carrierName } from "../lib/carrier";
import { dateKST, relativeTime } from "../lib/time";
import { useTheme } from "../theme/ThemeProvider";
import { Bell, BellOff, Check, Trash } from "./icons";
import { StageBadge } from "./StageBadge";

/** 풀스와이프(2단계) 실행 임계(px) — dragX 가 이 이상이면 dom 이 넘어가며 실행. rest 노출 폭보다 충분히 크다. */
const FULL_SWIPE = 200;

function ShipmentCardBase({
  shipment,
  now,
  memo,
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
  memo?: string;
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
  // 2단계 풀스와이프 감지: dragX(=transX)가 임계 FULL_SWIPE 를 넘으면 즉시 실행(이 제스처에서 1회).
  // 1단계(가벼운 스와이프)는 버튼 노출만(rest), 2단계(끝까지 더 스와이프)는 dom 이 넘어가며 실행.
  const firedRef = useRef(false);
  const dragXRef = useRef<Animated.AnimatedInterpolation<number> | null>(null);

  // 액션 render 콜백의 dragX 에 리스너 1회 등록 → 풀스와이프 감지.
  // 좌측 스와이프(우측 패널=삭제)는 음수, 우측 스와이프(좌측 패널=음소거)는 양수.
  const attachDrag = useCallback(
    (dragX: Animated.AnimatedInterpolation<number>) => {
      if (dragXRef.current) return;
      dragXRef.current = dragX;
      dragX.addListener(({ value }) => {
        if (firedRef.current) {
          // 닫혀 원위치(≈0)로 돌아오면 다음 제스처 허용 — 닫힘 애니메이션 중 재발동 방지.
          if (Math.abs(value) < 8) firedRef.current = false;
          return;
        }
        if (value <= -FULL_SWIPE) {
          firedRef.current = true;
          swipeRef.current?.close();
          onDelete();
        } else if (value >= FULL_SWIPE) {
          firedRef.current = true;
          swipeRef.current?.close();
          onToggleMute();
        }
      });
    },
    [onDelete, onToggleMute],
  );

  useEffect(() => () => dragXRef.current?.removeAllListeners(), []);

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
          {/* 메모(로컬) — 있으면 메모, 없으면 등록일 기반 기본 문구(통일감 위해 항상 한 줄). */}
          <Text
            style={[styles.summary, { color: memo ? tokens.text.body : tokens.text.disabled }]}
            numberOfLines={1}
          >
            {memo || `${dateKST(shipment.createdAt)}에 등록한 상품`}
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

  // 액션은 **fragment** 로 반환한다 — 배경(absoluteFill)을 Swipeable 의 액션 컨테이너(카드 폭 전체)에
  // 직접 깔아야 과스와이프 시 빈 틈이 없다(컨테이너 overflow:hidden 으로 카드에 클립). 콘텐츠(아이콘+라벨)는
  // **고정 폭**(actionBtn)이라 스냅 폭이 그 폭으로 측정된다(폭 회귀 금지 — DO NOT shrink/clip, docs UI_GUIDE).
  const renderDelete = (_progress: unknown, dragX: Animated.AnimatedInterpolation<number>) => {
    attachDrag(dragX);
    return (
      <>
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: tokens.bg.secondary, borderTopRightRadius: 8, borderBottomRightRadius: 8 },
          ]}
          pointerEvents="none"
        />
        <Pressable
          style={styles.actionBtn}
          onPress={() => {
            swipeRef.current?.close();
            onDelete();
          }}
          accessibilityRole="button"
          accessibilityLabel="삭제"
        >
          <Trash size={22} color={tokens.stage.exception} accessibilityElementsHidden importantForAccessibility="no" />
          <Text style={[styles.actionText, { color: tokens.stage.exception }]}>삭제</Text>
        </Pressable>
      </>
    );
  };

  const renderMute = (_progress: unknown, dragX: Animated.AnimatedInterpolation<number>) => {
    attachDrag(dragX);
    return (
      <>
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: tokens.bg.secondary, borderTopLeftRadius: 8, borderBottomLeftRadius: 8 },
          ]}
          pointerEvents="none"
        />
        <Pressable
          style={styles.actionBtn}
          onPress={() => {
            swipeRef.current?.close();
            onToggleMute();
          }}
          accessibilityRole="button"
          accessibilityLabel={shipment.muted ? "알림 켜기" : "알림 끄기"}
        >
          {shipment.muted ? (
            <Bell size={22} color={tokens.text.secondary} accessibilityElementsHidden importantForAccessibility="no" />
          ) : (
            <BellOff size={22} color={tokens.text.secondary} accessibilityElementsHidden importantForAccessibility="no" />
          )}
          <Text style={[styles.actionText, { color: tokens.text.secondary }]}>
            {shipment.muted ? "알림 켜기" : "알림 끄기"}
          </Text>
        </Pressable>
      </>
    );
  };

  return (
    <View style={styles.wrap}>
      <Swipeable
        ref={swipeRef}
        friction={2}
        leftThreshold={28}
        rightThreshold={28}
        // overshoot 활성 — rest 노출(1단계) 후 **끝까지 더 스와이프(2단계)** 가능. 배경 absoluteFill 이 깔려
        // 과스와이프해도 카드-버튼 사이 틈이 없다(고정폭+overshoot 비활성으로 회귀시키지 말 것 — 사용자 요구).
        overshootLeft
        overshootRight
        renderLeftActions={renderMute} // 우측 스와이프 → 왼쪽 패널 = 음소거
        renderRightActions={renderDelete} // 좌측 스와이프 → 오른쪽 패널 = 삭제
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
  // 메모(또는 등록일 기반 default) — 택배사·번호보다 중요한 식별 정보라 **중앙·강조** typography.
  summary: {
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 8,
  },
  // 스와이프 액션 콘텐츠 — **고정 폭 96**(스냅 폭·터치 타깃 ≥44). 배경은 별도 absoluteFill 로 카드 폭 전체를
  // 채우므로(틈 없음) 여기엔 배경/라운드를 두지 않는다. 색은 토큰만(destructive=예외 색).
  actionBtn: {
    width: 96,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  actionText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
