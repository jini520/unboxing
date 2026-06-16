/**
 * 목록 화면(주화면) — 캐시 우선 렌더 후 서버 갱신(ADR-014). 당겨서 새로고침·마지막 업데이트 표기·
 * 빈 상태(가치 제안+등록 CTA)·오프라인 배너·정렬(진행 중 우선). 스와이프 삭제는 Undo 토스트로 되돌림(PRD).
 * 색은 토큰만. 서버 에러 코드/기술 메시지는 화면에 노출하지 않는다(PRD 톤).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import {
  ApiError,
  deleteShipment,
  listShipments,
  type ApiDeps,
  type Shipment,
} from "../src/lib/api";
import { cacheShipments, cacheStore, readCachedShipments } from "../src/lib/cache";
import { deviceStorage, getDeviceId } from "../src/lib/device";
import { sortShipments } from "../src/lib/sort";
import { relativeTime } from "../src/lib/time";
import { ShipmentCard } from "../src/components/ShipmentCard";
import { useTheme } from "../src/theme/ThemeProvider";

const UNDO_WINDOW_MS = 4000;

const apiDeps: ApiDeps = {
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  getDeviceId: () =>
    getDeviceId({ storage: deviceStorage, randomBytes: Crypto.getRandomBytes }),
};

export default function ListScreen() {
  const { tokens } = useTheme();
  const [shipments, setShipments] = useState<Shipment[] | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);

  // 삭제 Undo: 낙관적으로 숨기고 창이 지나면 서버 반영(PRD). 한 번에 하나만.
  const [pending, setPending] = useState<Shipment | null>(null);
  const pendingRef = useRef<Shipment | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sync = useCallback(async () => {
    try {
      const list = await listShipments(apiDeps);
      const sorted = sortShipments(list);
      setShipments(sorted);
      setLastUpdated(Date.now());
      setOffline(false);
      await cacheShipments(sorted, { store: cacheStore, now: Date.now() });
    } catch (e) {
      // NETWORK(오프라인)는 캐시 유지 + 배너. 그 외도 캐시를 유지하고 조용히(코드 비노출).
      if (e instanceof ApiError && e.code === "NETWORK") setOffline(true);
    }
  }, []);

  // 최초: 캐시 우선 렌더 → 서버 갱신.
  useEffect(() => {
    let active = true;
    void (async () => {
      const cached = await readCachedShipments({ store: cacheStore });
      if (active && cached) {
        setShipments(sortShipments(cached.list));
        setLastUpdated(cached.cachedAt);
      }
      await sync();
    })();
    return () => {
      active = false;
    };
  }, [sync]);

  // 포커스 복귀 시 새로고침(상세에서 삭제하고 돌아온 경우 등).
  useFocusEffect(
    useCallback(() => {
      void sync();
    }, [sync]),
  );

  const commitDelete = useCallback((s: Shipment) => {
    timerRef.current = null;
    pendingRef.current = null;
    setPending(null);
    deleteShipment(s.id, apiDeps).catch(() => {
      // 서버 삭제 실패 → 목록 복원(다음 새로고침이 서버 기준으로 재동기화).
      setShipments((prev) => (prev ? sortShipments([...prev, s]) : prev));
    });
  }, []);

  const flushPending = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (pendingRef.current) commitDelete(pendingRef.current);
  }, [commitDelete]);

  // 언마운트 시 대기 중 삭제를 즉시 반영(삭제 유실 방지).
  useEffect(() => flushPending, [flushPending]);

  const requestDelete = useCallback(
    (s: Shipment) => {
      flushPending(); // 이전 대기분 먼저 확정.
      setShipments((prev) => prev?.filter((x) => x.id !== s.id) ?? prev);
      pendingRef.current = s;
      setPending(s);
      timerRef.current = setTimeout(() => commitDelete(s), UNDO_WINDOW_MS);
    },
    [commitDelete, flushPending],
  );

  const undo = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const s = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (s) setShipments((prev) => (prev ? sortShipments([...prev, s]) : prev));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await sync();
    setRefreshing(false);
  }, [sync]);

  const now = Date.now();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.bg.page }]} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: tokens.text.primary }]}>택배</Text>
          <Pressable
            onPress={() => router.push("/settings")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="설정"
          >
            <Text style={[styles.settings, { color: tokens.text.secondary }]}>설정</Text>
          </Pressable>
        </View>
        {lastUpdated !== null && (
          <Text style={[styles.freshness, { color: tokens.text.secondary }]}>
            마지막 업데이트 {relativeTime(new Date(lastUpdated).toISOString(), now)}
          </Text>
        )}
      </View>

      {offline && (
        <View style={[styles.banner, { backgroundColor: tokens.bg.secondary }]}>
          <Text style={{ color: tokens.text.body }}>오프라인 — 마지막으로 받은 상태예요</Text>
        </View>
      )}

      {shipments === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.text.secondary} />
        </View>
      ) : shipments.length === 0 ? (
        <EmptyState />
      ) : (
        <FlatList
          data={shipments}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={tokens.text.secondary}
            />
          }
          renderItem={({ item }) => (
            <ShipmentCard
              shipment={item}
              now={now}
              onPress={() => router.push(`/shipment/${item.id}`)}
              onDelete={() => requestDelete(item)}
            />
          )}
        />
      )}

      {pending && (
        <View style={[styles.toast, { backgroundColor: tokens.text.primary }]}>
          <Text style={{ color: tokens.bg.page }}>삭제했어요</Text>
          <Pressable onPress={undo} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.undo, { color: tokens.bg.page }]}>실행취소</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

function EmptyState() {
  const { tokens } = useTheme();
  return (
    <View style={styles.center}>
      <Text style={[styles.emptyTitle, { color: tokens.text.primary }]}>
        운송장만 넣어두면 상태가 바뀔 때 알려드려요
      </Text>
      <Pressable
        onPress={() => router.push("/register")}
        style={[styles.cta, { backgroundColor: tokens.text.primary }]}
        accessibilityRole="button"
      >
        <Text style={[styles.ctaLabel, { color: tokens.bg.page }]}>운송장 등록</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  settings: { fontSize: 15 },
  title: { fontSize: 30, fontWeight: "600" },
  freshness: { fontSize: 12, marginTop: 4 },
  banner: { marginHorizontal: 16, marginVertical: 8, padding: 12, borderRadius: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 20 },
  list: { padding: 16 },
  emptyTitle: { fontSize: 16, textAlign: "center", lineHeight: 24 },
  cta: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  ctaLabel: { fontSize: 15, fontWeight: "600" },
  toast: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 8,
  },
  undo: { fontWeight: "600" },
});
