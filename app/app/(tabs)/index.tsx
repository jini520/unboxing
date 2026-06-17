/**
 * 목록 화면(주화면) — 캐시 우선 렌더 후 서버 갱신(ADR-014). 당겨서 새로고침·마지막 업데이트 표기·
 * 빈 상태(가치 제안+등록 CTA)·오프라인 배너·정렬(진행 중 우선).
 * 인터랙션: 상단 ＋ 버튼=등록 / 카드 좌스와이프=삭제(노출→실행, Undo 토스트)·우스와이프=음소거(낙관+롤백) /
 *   롱프레스=멀티선택 모드(체크박스·전체선택·취소·일괄삭제[확인 다이얼로그, Undo 없음·부분실패 복원]).
 * 색은 토큰만. 서버 에러 코드/기술 메시지는 화면에 노출하지 않는다(PRD 톤).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ApiError,
  deleteShipment,
  listShipments,
  muteShipment,
  type Shipment,
} from "../../src/lib/api";
import { apiDeps } from "../../src/lib/deps";
import { cacheShipments, cacheStore, readCachedShipments } from "../../src/lib/cache";
import { sortShipments } from "../../src/lib/sort";
import { allSelected, pruneSelected, selectAll, toggleSelected } from "../../src/lib/selection";
import { relativeTime } from "../../src/lib/time";
import { Plus, Trash } from "../../src/components/icons";
import { ShipmentCard } from "../../src/components/ShipmentCard";
import { useTheme } from "../../src/theme/ThemeProvider";

const UNDO_WINDOW_MS = 4000;
const NOTICE_MS = 2000;

export default function ListScreen() {
  const { tokens } = useTheme();
  const [shipments, setShipments] = useState<Shipment[] | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  // 상대 시간 계산용 현재 시각 — sync 시에만 갱신해 카드 memo 가 매 렌더 깨지지 않게 한다.
  const [now, setNow] = useState(() => Date.now());
  const [reduceMotion, setReduceMotion] = useState(false);

  // 멀티선택: 선택 모드 = size>0 로 파생(별도 플래그 없음). 전부 해제되면 자동 종료.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const selectionMode = selectedIds.size > 0;

  // 삭제 Undo: 낙관적으로 숨기고 창이 지나면 서버 반영(PRD). 한 번에 하나만(단건 스와이프 전용).
  const [pending, setPending] = useState<Shipment | null>(null);
  const pendingRef = useRef<Shipment | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 음소거 등 비차단 안내 토스트(Undo 버튼 없음, 자동 소멸).
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const showNotice = useCallback((msg: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(msg);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const sync = useCallback(async () => {
    try {
      const list = await listShipments(apiDeps);
      // 삭제 대기(undo 창) 중인 항목은 서버에 아직 남아 있으므로 제외 — 새로고침/포커스 복귀가
      // 방금 스와이프한 행을 되살리지 않도록 한다.
      const pendingId = pendingRef.current?.id;
      const visible = pendingId ? list.filter((s) => s.id !== pendingId) : list;
      const sorted = sortShipments(visible);
      const ts = Date.now();
      setShipments(sorted);
      setLastUpdated(ts);
      setNow(ts);
      setOffline(false);
      // 허상 선택 제거 — 갱신으로 사라진 id 는 선택에서 떨군다(선택 모드 중 다른 기기 삭제 등).
      setSelectedIds((prev) => (prev.size ? pruneSelected(prev, sorted.map((s) => s.id)) : prev));
      await cacheShipments(sorted, { store: cacheStore, now: ts });
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
    deleteShipment(s.id, apiDeps).catch((e) => {
      // 404 = 이미 없음(다른 기기 삭제) → 멱등 성공. 그 외는 목록 복원 + 안내.
      if (e instanceof ApiError && e.status === 404) return;
      setShipments((prev) => (prev ? sortShipments([...prev, s]) : prev));
      Alert.alert("삭제하지 못했어요", "잠시 후 다시 시도해 주세요");
    });
  }, []);

  const flushPending = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (pendingRef.current) commitDelete(pendingRef.current);
  }, [commitDelete]);

  // 언마운트 시 대기 중 삭제를 즉시 반영(삭제 유실 방지).
  useEffect(() => flushPending, [flushPending]);

  // 스와이프 삭제 실행(노출→탭/추가 스와이프) — 낙관 삭제 + Undo 토스트. 확인 다이얼로그 없음(reveal 이 게이트).
  const doDelete = useCallback(
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

  // 음소거 토글(스와이프) — 낙관적으로 카드 muted 반영 후 서버, 실패 시 롤백 + 안내.
  const toggleMute = useCallback(
    (s: Shipment) => {
      const next = !s.muted;
      setShipments((prev) => prev?.map((x) => (x.id === s.id ? { ...x, muted: next } : x)) ?? prev);
      showNotice(next ? "알림을 껐어요" : "알림을 켰어요");
      muteShipment(s.id, next, apiDeps).catch(() => {
        setShipments(
          (prev) => prev?.map((x) => (x.id === s.id ? { ...x, muted: s.muted } : x)) ?? prev,
        );
        Alert.alert("알림 설정을 바꾸지 못했어요", "잠시 후 다시 시도해 주세요");
      });
    },
    [showNotice],
  );

  // ── 멀티선택 ─────────────────────────────────────────────
  const enterSelect = useCallback(
    (id: string) => {
      flushPending(); // 대기 삭제 먼저 확정(허상 방지).
      setSelectedIds((prev) => toggleSelected(prev, id));
    },
    [flushPending],
  );
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => toggleSelected(prev, id));
  }, []);
  const cancelSelect = useCallback(() => setSelectedIds(new Set()), []);
  const selectAllVisible = useCallback(() => {
    if (shipments) setSelectedIds(selectAll(shipments.map((s) => s.id)));
  }, [shipments]);

  // 일괄 삭제는 Undo 없음 — N건 복원은 복잡·오작동 위험이라 두지 않는다(단건 스와이프 삭제만 Undo).
  const runBulkDelete = useCallback(async (targets: Shipment[]) => {
    const ids = targets.map((s) => s.id);
    setShipments((prev) => prev?.filter((s) => !ids.includes(s.id)) ?? prev);
    setSelectedIds(new Set());
    const results = await Promise.allSettled(ids.map((id) => deleteShipment(id, apiDeps)));
    // 404 = 이미 없음(다른 기기 삭제) → 멱등 성공. 그 외 실패만 복원.
    const failed = targets.filter((_, i) => {
      const r = results[i];
      return r.status === "rejected" && !(r.reason instanceof ApiError && r.reason.status === 404);
    });
    if (failed.length > 0) {
      setShipments((prev) => (prev ? sortShipments([...prev, ...failed]) : prev));
      Alert.alert("일부를 삭제하지 못했어요", "잠시 후 다시 시도해 주세요");
    }
  }, []);

  const confirmBulkDelete = useCallback(() => {
    const targets = (shipments ?? []).filter((s) => selectedIds.has(s.id));
    if (targets.length === 0) return;
    Alert.alert("삭제할까요?", `선택한 ${targets.length}개를 삭제할까요?`, [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: () => void runBulkDelete(targets) },
    ]);
  }, [shipments, selectedIds, runBulkDelete]);

  // 안정적 renderItem — 변경된 카드만 재렌더(memo와 결합). 선택 상태는 selectedIds 의존으로 반영.
  const renderItem = useCallback(
    ({ item }: { item: Shipment }) => (
      <ShipmentCard
        shipment={item}
        now={now}
        selectionMode={selectionMode}
        selected={selectedIds.has(item.id)}
        reduceMotion={reduceMotion}
        onPress={() => router.push(`/shipment/${item.id}`)}
        onLongPress={() => enterSelect(item.id)}
        onToggleSelect={() => toggleSelect(item.id)}
        onDelete={() => doDelete(item)}
        onToggleMute={() => toggleMute(item)}
      />
    ),
    [now, selectionMode, selectedIds, reduceMotion, enterSelect, toggleSelect, doDelete, toggleMute],
  );

  const allOn = shipments ? allSelected(selectedIds, shipments.map((s) => s.id)) : false;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.bg.page }]} edges={["top"]}>
      <View style={styles.header}>
        {selectionMode ? (
          <View style={styles.headerRow}>
            <Pressable
              onPress={cancelSelect}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="선택 취소"
            >
              <Text style={[styles.headerAction, { color: tokens.text.secondary }]}>취소</Text>
            </Pressable>
            <Text style={[styles.countTitle, { color: tokens.text.primary }]}>
              {selectedIds.size}개 선택
            </Text>
            <View style={styles.headerRight}>
              {!allOn && (
                <Pressable
                  onPress={selectAllVisible}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="전체 선택"
                >
                  <Text style={[styles.headerAction, { color: tokens.text.secondary }]}>
                    전체선택
                  </Text>
                </Pressable>
              )}
              <Pressable
                onPress={confirmBulkDelete}
                hitSlop={8}
                style={styles.iconBtn}
                accessibilityRole="button"
                accessibilityLabel={`선택한 ${selectedIds.size}개 삭제`}
              >
                <Trash size={24} color={tokens.stage.exception} />
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.headerRow}>
              <Text style={[styles.title, { color: tokens.text.primary }]}>택배</Text>
              <Pressable
                onPress={() => router.push("/register")}
                hitSlop={8}
                style={styles.iconBtn}
                accessibilityRole="button"
                accessibilityLabel="운송장 추가"
              >
                <Plus size={24} color={tokens.text.primary} />
              </Pressable>
            </View>
            {lastUpdated !== null && (
              <Text style={[styles.freshness, { color: tokens.text.secondary }]}>
                마지막 업데이트 {relativeTime(lastUpdated, now)}
              </Text>
            )}
          </>
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
              onRefresh={async () => {
                setRefreshing(true);
                await sync();
                setRefreshing(false);
              }}
              tintColor={tokens.text.secondary}
            />
          }
          renderItem={renderItem}
        />
      )}

      {pending ? (
        <View style={[styles.toast, { backgroundColor: tokens.text.primary }]}>
          <Text style={{ color: tokens.bg.page }}>삭제했어요</Text>
          <Pressable onPress={undo} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.undo, { color: tokens.bg.page }]}>실행취소</Text>
          </Pressable>
        </View>
      ) : (
        notice && (
          <View style={[styles.toast, { backgroundColor: tokens.text.primary }]}>
            <Text style={{ color: tokens.bg.page }}>{notice}</Text>
          </View>
        )
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
  headerRight: { flexDirection: "row", alignItems: "center", gap: 16 },
  headerAction: { fontSize: 15 },
  // 터치 타깃 ≥44(아이콘 24 + 패딩 10*2).
  iconBtn: { padding: 10, margin: -10 },
  title: { fontSize: 30, fontWeight: "600" },
  countTitle: { fontSize: 17, fontWeight: "600" },
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
