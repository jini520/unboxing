/**
 * 송장 카드 — 좌측정렬(위→아래): 단계배지+상대시간 · **메모(중단)** · 택배사·운송장번호(하단·작게).
 *  - 현재 상태는 **StageBadge(색+글리프+라벨)로만** 표시 — 별도 "현재 상태 메세지" 텍스트 줄은 StageBadge 와 역할이 겹쳐 두지 않는다(사용자 요구).
 *  - 메모는 중단·좌측정렬·primary 색(default 문구라도 회색 금지). 택배사·번호는 보조라 하단·작게.
 * 인터랙션(gesture-handler Swipeable, 양방향 reveal — 2단계):
 *  - 1단계: 좌측 스와이프 → **삭제** 버튼 노출 / 우측 스와이프 → **음소거** 버튼 노출(첫 스와이프는 노출만, 실행 X).
 *  - 2단계: 이미 노출된 상태에서 **같은 방향으로 한 번 더 스와이프**하면 버튼 탭과 동일하게 실행(또는 버튼 직접 탭).
 *  실행은 부모에 위임(onDelete=낙관+Undo / onToggleMute=낙관+롤백). reveal 이 의도 확인 게이트라 별도 다이얼로그 없음.
 *  - 선택 모드(부모 롱프레스 진입): 스와이프 비활성·체크박스 표시·탭=선택 토글(상세 이동 아님).
 * 색은 토큰만(하드코딩 금지). 상태는 색 단독 금지 — StageBadge(색+글리프+라벨), 음소거는 아이콘+a11y 라벨.
 * 택배사명은 carrierName(carrier.ts) 로 한글 표기(미상 id 는 그대로 폴백).
 */
import { memo, useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import type { Shipment } from "../lib/api";
import { carrierName } from "../lib/carrier";
import { defaultMemoText } from "../lib/memo";
import { relativeTime } from "../lib/time";
import { useTheme } from "../theme/ThemeProvider";
import { fontSize, fontWeight, radius, spacing } from "../theme/layout";
import { BellFill, BellOff, BellOffFill, Check, TrashFill } from "./icons";
import { StageBadge } from "./StageBadge";

/**
 * 2단계(한 번 더 스와이프) 실행 **민감도** 임계 — 버튼이 노출된 뒤 같은 방향으로 **추가로 밀어야 하는 손가락 거리(px)**.
 * dragX(제스처 raw translationX)는 제스처마다 0에서 시작하므로 이 값이 곧 "두 번째 스와이프 거리"다.
 * **클수록 둔감**(덜 민감) — 너무 민감하면 올리고, 트리거가 어려우면 내린다. (사용자 피드백으로 조절하는 지점)
 */
const SWIPE_AGAIN_PX = 80;

/**
 * 스와이프 액션 **컬러 배경 폭**(px). 버튼 콘텐츠 폭(`actionBtn`=96) + 카드 둥근 모서리(노출 끝의 코너 노치)를
 * 메우는 버퍼. **풀폭(absoluteFill) 금지** — RNGH 패널은 컨테이너 전폭(`absoluteFill`)이라, 풀폭 배경 + 컨테이너
 * `overflow:visible`(카드가 거터 넘어 끝까지 밀리게 한 설정)이 만나면 **카드 복귀 전환 때 반대편 모서리로 컬러가 샌다**.
 * `transX` 는 `leftWidth(≈버튼폭)+overshoot(~1px)` 로 클램프돼 노출 폭이 버튼 폭을 넘지 않으므로, 이 정도면
 * 과스와이프 틈도 없고(노출 전부 덮음) **far edge 가 항상 카드 아래**라 절대 새지 않는다(카드 폭보다 작게 유지).
 */
const ACTION_BG_WIDTH = 120;

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
  // 2단계 실행(한 번 더 스와이프). **1단계(첫 스와이프)는 노출만** — openedRef 는 정착(onSwipeableOpen) 후에야
  // 세팅돼 첫 스와이프 중엔 트리거가 막힌다. 노출되어 열린 뒤 같은 방향으로 **추가로 SWIPE_AGAIN_PX 만큼 더 밀면**
  // 버튼 탭과 동일 실행.
  //
  // ⚠️ 거리 측정은 **base AnimatedValue 인 dragX**(제스처 raw translationX)에 리스너를 건다 — render 콜백이 주는
  // transX/progress 는 *interpolation* 이라 RN Animated 가 리스너를 **발화시키지 않는다**(base Value 만 __callListeners).
  // 게다가 Swipeable 기본 useNativeAnimations:true(native driver)면 JS 리스너가 아예 안 와서, dragX 리스너가 울리도록
  // **useNativeAnimations={false}** 로 JS 구동시킨다(아래 Swipeable). dragX 는 생성자에서 1회 생성돼 안정적.
  const openedRef = useRef<"left" | "right" | null>(null);
  const firedRef = useRef(false); // 한 제스처에서 1회만 예약. 열림/닫힘(onSwipeable*)에서 해제.
  // 임계 도달 시 **즉시 실행/close 하면 진행 중 제스처와 충돌**해 카드가 떨리고, 손을 떼면 handleRelease 가 다시 열어
  // 1단계에 머문다. 그래서 여기선 "실행 예약"만 하고, 제스처가 끝나 정착할 때(아래 onSwipeableWillOpen)에서 실행+close 한다.
  const pendingFireRef = useRef<"left" | "right" | null>(null);

  // dragX 리스너: 그 방향으로 **이미 열린 상태**에서 두 번째 스와이프가 임계를 넘으면 **예약만** 한다(첫 스와이프·닫힘·반대 제외).
  // dragX 는 animateRow 가 정착 때 0 으로 리셋하므로, 두 번째 제스처의 dragX 는 그 제스처의 손가락 이동량이다.
  // selectionMode 면 Swipeable 이 언마운트되므로 토글 시 재부착.
  useEffect(() => {
    const dragX = (
      swipeRef.current as unknown as { state?: { dragX?: Animated.Value } } | null
    )?.state?.dragX;
    if (!dragX) return;
    const id = dragX.addListener(({ value }) => {
      if (!openedRef.current || firedRef.current) return;
      if (openedRef.current === "right" && value <= -SWIPE_AGAIN_PX) {
        firedRef.current = true;
        pendingFireRef.current = "right";
      } else if (openedRef.current === "left" && value >= SWIPE_AGAIN_PX) {
        firedRef.current = true;
        pendingFireRef.current = "left";
      }
    });
    return () => dragX.removeListener(id);
  }, [selectionMode]);

  const a11yLabel =
    `${carrierName(shipment.carrier)} ${shipment.trackingNo}, ${shipment.status}` +
    (shipment.muted ? ", 알림 꺼짐" : "");

  const content = (
    <View
      style={[
        styles.card,
        {
          backgroundColor: tokens.bg.surface,
          borderColor: selected ? tokens.accent : tokens.border,
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
                borderColor: selected ? tokens.accent : tokens.border,
                backgroundColor: selected ? tokens.accent : "transparent",
              },
            ]}
          >
            {selected && (
              <Check
                size={14}
                color={tokens.onAccent}
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
          {/* 현재 상태는 위 StageBadge 가 표시 — 별도 상태 메세지 텍스트 줄은 역할이 겹쳐 두지 않는다(사용자 요구). */}
          {/* 메모(중단·로컬) — 무엇인지 식별. **좌측정렬**(가운데 정렬 금지). default 문구라도 회색 아닌 primary 색. */}
          <Text style={[styles.memo, { color: tokens.text.primary }]} numberOfLines={1}>
            {memo || defaultMemoText(shipment.createdAt)}
          </Text>
          {/* 택배사·운송장 전체번호(하단·작게) — 본인 데이터라 끝4자리로 줄이지 않고, 길면 잘림 없이 줄바꿈 허용. */}
          <Text style={[styles.carrier, { color: tokens.text.secondary }]}>
            {carrierName(shipment.carrier)} · {shipment.trackingNo}
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

  // 액션은 **fragment** 로 반환한다 — 컬러 배경은 노출 가장자리에 앵커한 **한정 폭**(actionBgRight/Left, `ACTION_BG_WIDTH`)
  // 으로 깐다. 풀폭(absoluteFill)으로 되돌리지 말 것 — overflow:visible 와 만나 카드 복귀 시 반대편 모서리로 샌다(상수 주석 참고).
  // 콘텐츠(아이콘+라벨)는 **고정 폭**(actionBtn)이라 스냅 폭이 그 폭으로 측정된다(폭 회귀 금지 — docs UI_GUIDE).
  const renderDelete = () => (
    <>
        <View
          style={[
            styles.actionBgRight,
            { backgroundColor: tokens.stage.exception, borderTopRightRadius: radius.md, borderBottomRightRadius: radius.md },
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
          <TrashFill size={22} color={tokens.onAccent} accessibilityElementsHidden importantForAccessibility="no" />
          <Text style={[styles.actionText, { color: tokens.onAccent }]}>삭제</Text>
        </Pressable>
      </>
  );

  const renderMute = () => (
      <>
        <View
          style={[
            styles.actionBgLeft,
            { backgroundColor: tokens.accent, borderTopLeftRadius: radius.md, borderBottomLeftRadius: radius.md },
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
            <BellFill size={22} color={tokens.onAccent} accessibilityElementsHidden importantForAccessibility="no" />
          ) : (
            <BellOffFill size={22} color={tokens.onAccent} accessibilityElementsHidden importantForAccessibility="no" />
          )}
          <Text style={[styles.actionText, { color: tokens.onAccent }]}>
            {shipment.muted ? "알림 켜기" : "알림 끄기"}
          </Text>
        </Pressable>
      </>
  );

  return (
    <View style={styles.wrap}>
      <Swipeable
        ref={swipeRef}
        // 컨테이너 overflow:hidden(기본)이 카드를 리스트 padding 경계에서 자른다 → visible 로 풀어
        // **카드만** 경계 넘어 끝까지 밀리게 한다(버튼 패널·인셋·패딩은 그대로). 사용자 요구.
        containerStyle={styles.swipeContainer}
        // dragX 리스너(2단계 거리 측정)가 JS 에서 울리도록 native driver 비활성 — 기본 true 면 JS addListener 안 옴.
        useNativeAnimations={false}
        friction={2}
        leftThreshold={28}
        rightThreshold={28}
        // overshoot 활성 — rest 노출(1단계) 후 **한 번 더 스와이프(2단계)** 가능. 배경 absoluteFill 이 깔려
        // 과스와이프해도 카드-버튼 사이 틈이 없다(고정폭+overshoot 비활성으로 회귀시키지 말 것 — 사용자 요구).
        overshootLeft
        overshootRight
        // 1단계(첫 스와이프) 정착 시 열린 방향 기록 → 2단계(같은 방향으로 더 밀기) 판정 게이트. 열림/닫힘에서 상태 해제.
        onSwipeableOpen={(direction) => {
          openedRef.current = direction; // "left"=음소거 노출 / "right"=삭제 노출
          firedRef.current = false;
          pendingFireRef.current = null;
        }}
        onSwipeableClose={() => {
          openedRef.current = null;
          firedRef.current = false;
          pendingFireRef.current = null;
        }}
        // 2단계 실행 — dragX 리스너가 예약(pendingFireRef)해 두면 **제스처가 끝나 정착하는 이 시점**에 실행+close.
        // 진행 중이 아니라 release 후라 떨림/되돌아감 없이 깔끔히 닫힌다(닫기 스와이프는 willClose 라 여기 안 옴).
        onSwipeableWillOpen={(direction) => {
          if (pendingFireRef.current !== direction) return;
          pendingFireRef.current = null;
          swipeRef.current?.close();
          if (direction === "right") onDelete();
          else onToggleMute();
        }}
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
  // 카드가 리스트 padding 경계에서 잘리지 않고 끝까지 밀리도록 컨테이너 클립 해제(버튼 패널엔 영향 없음).
  swipeContainer: {
    overflow: "visible",
  },
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  // 선택 체크박스 — 터치는 카드 전체(≥44)가 받는다.
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
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
    fontSize: fontSize.caption,
  },
  // 메모(중단) — 식별 정보. **좌측정렬**(가운데 정렬 금지). default 라도 primary 색(회색 금지).
  memo: {
    fontSize: fontSize.callout,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.sm,
  },
  // 택배사·운송장 전체번호(하단·보조) — 더 작게(12). 줄바꿈 허용(끝4자리 축약 금지).
  carrier: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
    marginTop: spacing.sm,
  },
  // 스와이프 액션 콘텐츠 — **고정 폭 96**(스냅 폭·터치 타깃 ≥44). 배경은 별도 한정폭 레이어(actionBg*)라
  // 여기엔 배경/라운드를 두지 않는다. 색은 토큰만(아이콘·라벨=onAccent 흰색).
  actionBtn: {
    width: 96,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  // 컬러 배경 — 노출 가장자리에 앵커한 **한정 폭**(`ACTION_BG_WIDTH`, 풀폭 금지). far edge 가 카드 폭보다 작아
  // 항상 카드 아래라 반대편으로 새지 않는다. 음소거=왼쪽 패널(우스와이프), 삭제=오른쪽 패널(좌스와이프).
  actionBgLeft: { position: "absolute", top: 0, bottom: 0, left: 0, width: ACTION_BG_WIDTH },
  actionBgRight: { position: "absolute", top: 0, bottom: 0, right: 0, width: ACTION_BG_WIDTH },
  actionText: {
    fontSize: fontSize.footnote,
    fontWeight: fontWeight.semibold,
  },
});
