/**
 * 대시보드(하단 탭·좌측) — 진행 중·배송완료·예외·오늘 도착·휴지통·새 알림 요약 + 이번 달 등록 금액 teaser.
 * 집계는 **클라이언트**에서(ADR-021, 새 서버 엔드포인트 없음): GET /shipments(또는 오프라인 캐시) + 로컬 휴지통/읽음/금액
 * → dashboardCounts(08 단일 출처)로 계산. 버킷 정의는 stageBucket(08) — 여기서 재정의하지 않는다(드리프트 금지).
 * 카드 탭 → 택배함(필터 프리셋 route param)·휴지통·알림으로 라우팅. 빈/오프라인 상태 처리(ADR-014 캐시 집계).
 * 색은 토큰만(예외>0=stage.exception 강조 + 라벨/아이콘 — 색 단독 아님). 헤더는 택배함과 동일 위치/스타일.
 * docs/UI_GUIDE.md "대시보드", docs/ARCHITECTURE.md "v1.1 네비게이션/데이터 흐름", ADR-021·025.
 */
import { type ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, listNotifications, listShipments, type Shipment } from "../../src/lib/api";
import { apiDeps } from "../../src/lib/deps";
import { cacheShipments, cacheStore, readCachedShipments } from "../../src/lib/cache";
import { dashboardCounts } from "../../src/lib/dashboard";
import { loadTrash, trashStore } from "../../src/lib/trash";
import { infoStore, loadInfo } from "../../src/lib/info";
import { initLastSeen, notifStore, unreadCount } from "../../src/lib/notif";
import { formatAmount } from "../../src/lib/amount";
import type { ListFilter } from "../../src/lib/filter";
import { relativeTime } from "../../src/lib/time";
import { HeaderBell } from "../../src/components/HeaderBell";
import {
  AlertTriangle,
  Bell,
  CheckCircle,
  type IconProps,
  Package,
  Trash,
  Truck,
} from "../../src/components/icons";
import { useTheme } from "../../src/theme/ThemeProvider";
import { fontSize, fontWeight, radius, spacing } from "../../src/theme/layout";

export default function DashboardScreen() {
  const { tokens } = useTheme();
  const [shipments, setShipments] = useState<Shipment[] | null>(null);
  // 로컬 스토어 집계 입력 — 휴지통 수·미읽음 수·송장별 금액(로컬 정보 스토어).
  const [trashCount, setTrashCount] = useState(0);
  const [unread, setUnread] = useState(0);
  const [amounts, setAmounts] = useState<Record<string, number | undefined>>({});
  const [now, setNow] = useState(() => Date.now());
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const sync = useCallback(async () => {
    // 로컬 스토어는 항상 가용 — 오프라인이어도 집계에 반영(ADR-014).
    const trash = await loadTrash({ store: trashStore });
    setTrashCount(Object.keys(trash).length);
    const info = await loadInfo({ store: infoStore });
    // dashboardCounts 는 amounts[id]=number 를 기대 — 정보 맵에서 금액만 추린다(객체 통째 주입 금지).
    const amountMap: Record<string, number | undefined> = {};
    for (const [id, i] of Object.entries(info)) amountMap[id] = i.amount;
    setAmounts(amountMap);

    // 미읽음 — 첫 fetch 면 lastSeen=now 로 초기화(기존 기록 폭주 방지, 보강⑤). 실패는 조용히 미갱신.
    try {
      const notifs = await listNotifications(apiDeps);
      const baseline = await initLastSeen({ store: notifStore, now: Date.now() });
      setUnread(unreadCount(notifs, baseline));
    } catch {
      // 알림 기록 조회 실패 → 배지 미갱신(코드 비노출).
    }

    // 송장 목록 — 온라인이면 서버 갱신 + 캐시(어느 탭이 갱신했든 오프라인 읽기 유지). NETWORK 면 캐시 유지 + 배너.
    try {
      const list = await listShipments(apiDeps);
      const ts = Date.now();
      setShipments(list);
      setLastUpdated(ts);
      setNow(ts);
      setOffline(false);
      await cacheShipments(list, { store: cacheStore, now: ts });
    } catch (e) {
      if (e instanceof ApiError && e.code === "NETWORK") setOffline(true);
    }
  }, []);

  // 최초: 캐시 우선 렌더 → 서버 갱신(ADR-014).
  useEffect(() => {
    let active = true;
    void (async () => {
      const cached = await readCachedShipments({ store: cacheStore });
      if (active && cached) {
        setShipments(cached.list);
        setLastUpdated(cached.cachedAt);
      }
      await sync();
    })();
    return () => {
      active = false;
    };
  }, [sync]);

  // 포커스 복귀 시 재집계 — 다른 탭/기기에서 삭제·등록·읽음 변화를 반영(목록 기준 재집계).
  useFocusEffect(
    useCallback(() => {
      void sync();
    }, [sync]),
  );

  const counts = useMemo(
    () =>
      shipments === null
        ? null
        : dashboardCounts(shipments, { trashCount, unreadCount: unread, now, amounts }),
    [shipments, trashCount, unread, now, amounts],
  );

  // 카드 → 택배함 라우팅(필터 프리셋을 route param 으로 전달, 택배함이 칩 초기 선택에 반영).
  const goList = useCallback((filter: ListFilter) => {
    router.navigate({ pathname: "/", params: { filter } });
  }, []);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.bg.page }]} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: tokens.text.primary }]}>대시보드</Text>
          <HeaderBell unread={unread} />
        </View>
        <Text style={[styles.pageDesc, { color: tokens.text.secondary }]}>
          진행 상황을 한눈에 봐요
        </Text>
      </View>

      {offline && (
        <View style={[styles.banner, { backgroundColor: tokens.bg.secondary }]}>
          <Text style={{ color: tokens.text.body }}>오프라인 — 마지막으로 받은 상태예요</Text>
        </View>
      )}

      {counts === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.text.secondary} />
        </View>
      ) : shipments !== null && shipments.length === 0 ? (
        <EmptyState />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await sync();
                setRefreshing(false);
              }}
              tintColor={tokens.text.secondary}
            />
          }
        >
          {lastUpdated !== null && (
            <Text style={[styles.fresh, { color: tokens.text.secondary }]}>
              {relativeTime(lastUpdated, now)} 업데이트
            </Text>
          )}

          <View style={styles.grid}>
            <SummaryCard
              count={counts.inProgress}
              label="진행 중"
              Icon={Package}
              onPress={() => goList("진행중")}
            />
            <SummaryCard
              count={counts.completed}
              label="배송완료"
              Icon={CheckCircle}
              onPress={() => goList("완료")}
            />
            <SummaryCard
              count={counts.exception}
              label="확인 필요"
              Icon={AlertTriangle}
              emphasize
              onPress={() => goList("예외")}
            />
            {/* 오늘 도착(배송출발 ∩ KST 당일)은 임박(배송출발)의 부분집합 — 08 filter 에 별도 '오늘도착' 칩이
                없으므로 가장 가까운 상위 필터 임박으로 진입(당일 정밀 집계는 대시보드 카드 전용). */}
            <SummaryCard
              count={counts.arrivingToday}
              label="오늘 도착"
              Icon={Truck}
              onPress={() => goList("임박")}
            />
            <SummaryCard
              count={counts.trash}
              label="휴지통"
              Icon={Trash}
              onPress={() => router.push("/trash")}
            />
            <SummaryCard
              count={counts.unread}
              label="새 알림"
              Icon={Bell}
              onPress={() => router.push("/notifications")}
            />
          </View>

          {/* 이번 달 등록 금액 teaser — 전부 미입력(total 0·partial 아님)이면 숨김(가계부 예고라 ₩0 노출 무의미). */}
          {(counts.amountTeaser.total > 0 || counts.amountTeaser.partial) && (
            <AmountTeaser total={counts.amountTeaser.total} partial={counts.amountTeaser.partial} />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/**
 * 요약 카드 — 큰 숫자 + 아이콘 + 라벨. 숫자 0=중립(text.secondary), >0=text.primary.
 * emphasize(예외 전용): >0 이면 숫자·아이콘을 stage.exception 으로(색 + 라벨/아이콘 동반 — 색 단독 아님).
 */
function SummaryCard({
  count,
  label,
  Icon,
  emphasize = false,
  onPress,
}: {
  count: number;
  label: string;
  Icon: ComponentType<IconProps>;
  emphasize?: boolean;
  onPress: () => void;
}) {
  const { tokens } = useTheme();
  const active = count > 0;
  const valueColor =
    emphasize && active
      ? tokens.stage.exception
      : active
        ? tokens.text.primary
        : tokens.text.secondary;
  const iconColor = emphasize && active ? tokens.stage.exception : tokens.text.secondary;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, { backgroundColor: tokens.bg.surface, borderColor: tokens.border }]}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${count}건`}
    >
      <View style={styles.cardTop}>
        <Icon
          size={20}
          color={iconColor}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <Text style={[styles.cardLabel, { color: tokens.text.secondary }]}>{label}</Text>
      </View>
      <Text style={[styles.cardValue, { color: valueColor }]}>{count}</Text>
    </Pressable>
  );
}

/** 이번 달 등록 금액 합계(₩) teaser — 가계부 예고. partial=일부만 입력됨 캡션. */
function AmountTeaser({ total, partial }: { total: number; partial: boolean }) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.teaser, { backgroundColor: tokens.bg.surface, borderColor: tokens.border }]}>
      <Text style={[styles.cardLabel, { color: tokens.text.secondary }]}>이번 달 등록 금액</Text>
      <Text style={[styles.teaserValue, { color: tokens.text.primary }]}>{formatAmount(total)}</Text>
      {partial && (
        <Text style={[styles.teaserCaption, { color: tokens.text.secondary }]}>일부 미입력</Text>
      )}
    </View>
  );
}

/** 빈 상태(송장 0) — 택배함 빈 상태와 일관(가치 제안 + 등록 CTA). */
function EmptyState() {
  const { tokens } = useTheme();
  return (
    <View style={styles.center}>
      <Text style={[styles.emptyTitle, { color: tokens.text.primary }]}>
        운송장만 넣어두면 상태가 바뀔 때 알려드려요
      </Text>
      <Pressable
        onPress={() => router.push("/register")}
        style={[styles.cta, { backgroundColor: tokens.accent }]}
        accessibilityRole="button"
      >
        <Text style={[styles.ctaLabel, { color: tokens.onAccent }]}>운송장 등록</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  // 택배함 헤더와 동일 위치(paddingTop 8) — 제목/설명/종 위치 일치.
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: fontSize.display1, fontWeight: fontWeight.semibold },
  pageDesc: { fontSize: fontSize.footnote, lineHeight: 19, marginTop: 10 },
  content: { padding: spacing.lg },
  fresh: { fontSize: fontSize.caption, textAlign: "right", marginBottom: spacing.sm },
  banner: { marginHorizontal: spacing.lg, marginVertical: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  // 2열 그리드 — 카드 48%, 행 사이 rowGap.
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing.md },
  card: {
    width: "48%",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  cardLabel: { fontSize: fontSize.footnote },
  cardValue: { fontSize: fontSize.display2, fontWeight: fontWeight.bold },
  teaser: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  teaserValue: { fontSize: fontSize.display3, fontWeight: fontWeight.bold },
  teaserCaption: { fontSize: fontSize.caption },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xxl, gap: 20 },
  emptyTitle: { fontSize: fontSize.base, textAlign: "center", lineHeight: 24 },
  cta: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md },
  ctaLabel: { fontSize: fontSize.callout, fontWeight: fontWeight.semibold },
});
