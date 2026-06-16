/**
 * 상세 화면 — 단계 배지(캐시로 즉시) + 타임라인(실시간 조회·ADR-011). 당겨서 새로고침·삭제(확인 다이얼로그).
 * 타임라인은 로컬 저장/캐시하지 않는다(ADR-011) — 오프라인이면 마지막 단계만 보여준다.
 * 색은 토큰만. 서버 에러 코드/기술 메시지는 화면에 노출하지 않는다(친근한 한국어, PRD 톤).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ApiError,
  deleteShipment,
  getShipment,
  type Shipment,
  type TimelineEvent,
} from "../../src/lib/api";
import { apiDeps } from "../../src/lib/deps";
import { readCachedShipments, cacheStore } from "../../src/lib/cache";
import { StageBadge } from "../../src/components/StageBadge";
import { Timeline } from "../../src/components/Timeline";
import { useTheme } from "../../src/theme/ThemeProvider";

/** 타임라인 로드 결과 구분 → 화면이 친근한 카피로 매핑(코드 비노출). */
type TimelineState =
  | { kind: "loading" }
  | { kind: "ok"; events: TimelineEvent[] }
  | { kind: "offline" }
  | { kind: "unavailable" } // upstream 실패 — 마지막 단계만
  | { kind: "notfound" };

export default function DetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { tokens } = useTheme();
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [timeline, setTimeline] = useState<TimelineState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const deleting = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const { shipment: s, timeline: events } = await getShipment(id, apiDeps);
      setShipment(s);
      setTimeline({ kind: "ok", events });
    } catch (e) {
      if (e instanceof ApiError && e.code === "NETWORK") setTimeline({ kind: "offline" });
      else if (e instanceof ApiError && (e.status === 404 || e.status === 403))
        setTimeline({ kind: "notfound" });
      else setTimeline({ kind: "unavailable" }); // 502 등 upstream — 마지막 단계 유지
    }
  }, [id]);

  // 실시간 조회를 캐시 읽기와 **동시에** 시작(타임라인 요청이 AsyncStorage I/O에 막히지 않게).
  // 캐시 단계 배지는 실시간 조회가 아직 안 채웠을 때만 넣는다(prev ?? hit) — 신선한 값을 덮어쓰지 않음.
  useEffect(() => {
    let active = true;
    const loadPromise = load();
    void (async () => {
      const cached = await readCachedShipments({ store: cacheStore });
      const hit = cached?.list.find((s) => s.id === id);
      if (active && hit) setShipment((prev) => prev ?? hit);
      await loadPromise;
    })();
    return () => {
      active = false;
    };
  }, [id, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const confirmDelete = useCallback(() => {
    Alert.alert("이 송장을 삭제할까요?", "추적이 중단되고 목록에서 사라져요.", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: () => {
          if (deleting.current || !id) return;
          deleting.current = true;
          deleteShipment(id, apiDeps)
            .then(() => router.back())
            .catch(() => {
              deleting.current = false;
              Alert.alert("삭제하지 못했어요", "잠시 후 다시 시도해 주세요.");
            });
        },
      },
    ]);
  }, [id]);

  const now = Date.now();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.bg.page }]} edges={["bottom"]}>
      <Stack.Screen options={{ title: "배송 상세" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={tokens.text.secondary}
          />
        }
      >
        {shipment ? (
          <View style={styles.head}>
            <StageBadge stage={shipment.status} />
            <Text style={[styles.meta, { color: tokens.text.secondary }]}>
              {shipment.carrier} · {shipment.trackingNo.slice(-4)}
            </Text>
          </View>
        ) : (
          <View style={styles.skeleton}>
            <ActivityIndicator color={tokens.text.secondary} />
          </View>
        )}

        <View style={styles.timelineWrap}>
          {timeline.kind === "loading" ? (
            <ActivityIndicator color={tokens.text.secondary} />
          ) : timeline.kind === "ok" ? (
            <Timeline events={timeline.events} now={now} />
          ) : timeline.kind === "notfound" ? (
            <Text style={{ color: tokens.text.secondary }}>송장을 찾을 수 없어요</Text>
          ) : (
            <Retry
              message={
                timeline.kind === "offline"
                  ? "오프라인이에요 — 마지막 상태만 보여드려요"
                  : "타임라인을 못 불러왔어요"
              }
              onRetry={load}
            />
          )}
        </View>
      </ScrollView>

      {shipment && (
        <Pressable
          onPress={confirmDelete}
          style={styles.deleteBtn}
          accessibilityRole="button"
          accessibilityLabel="이 송장 삭제"
        >
          <Text style={[styles.deleteLabel, { color: tokens.stage.exception }]}>삭제</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

function Retry({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { tokens } = useTheme();
  return (
    <View style={styles.retry}>
      <Text style={{ color: tokens.text.secondary }}>{message}</Text>
      <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button">
        <Text style={[styles.retryLabel, { color: tokens.text.body }]}>다시 시도</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16 },
  head: { gap: 8, marginBottom: 24 },
  meta: { fontSize: 14, fontWeight: "500" },
  skeleton: { height: 40, justifyContent: "center", marginBottom: 24 },
  timelineWrap: { minHeight: 80 },
  retry: { gap: 8, alignItems: "flex-start" },
  retryLabel: { fontSize: 14, fontWeight: "600" },
  deleteBtn: { paddingHorizontal: 16, paddingVertical: 16, alignItems: "center" },
  deleteLabel: { fontSize: 15, fontWeight: "600" },
});
