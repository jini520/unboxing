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
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ApiError,
  deleteShipment,
  getShipment,
  type Contact,
  type Shipment,
  type TimelineEvent,
} from "../../src/lib/api";
import { apiDeps } from "../../src/lib/deps";
import { carrierName } from "../../src/lib/carrier";
import { readCachedShipments, cacheStore } from "../../src/lib/cache";
import { STAGE_SUMMARY } from "../../src/lib/stage";
import { absoluteKSTLong } from "../../src/lib/time";
import { StageBadge } from "../../src/components/StageBadge";
import { StageProgress } from "../../src/components/StageProgress";
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
  // 수취인은 실시간 조회분만 화면 state 로(미저장 — ADR-005). 캐시·로그 금지, 화면 이탈 시 폐기.
  const [recipient, setRecipient] = useState<Contact | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const deleting = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const { shipment: s, timeline: events, recipient: r } = await getShipment(id, apiDeps);
      setShipment(s);
      setRecipient(r);
      setTimeline({ kind: "ok", events });
    } catch (e) {
      setRecipient(null); // 실시간분 없음 → 수취인 숨김(저장된 수취인 없음)
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

  // 현재 상태 문구: 최신 이벤트(시각 내림차순 첫 항목) 기준. 실시간(ok)일 때만 — 오프라인/실패면 생략.
  const latestEvent =
    timeline.kind === "ok" && timeline.events.length > 0
      ? [...timeline.events].sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0]
      : null;
  let statusText: string | null = null;
  if (shipment && timeline.kind === "ok") {
    // 시각: 최신 이벤트 없으면 status_changed_at 으로 폴백. 설명: 이벤트 설명 없으면 단계 요약.
    const timePart = absoluteKSTLong(latestEvent?.time ?? shipment.statusChangedAt);
    const desc = latestEvent?.description?.trim() || STAGE_SUMMARY[shipment.status];
    statusText = timePart ? `${timePart} · ${desc}` : desc;
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.bg.page }]} edges={["bottom"]}>
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
              {carrierName(shipment.carrier)} · {shipment.trackingNo.slice(-4)}
            </Text>
          </View>
        ) : (
          <View style={styles.skeleton}>
            <ActivityIndicator color={tokens.text.secondary} />
          </View>
        )}

        {/* 단계 진행 인디케이터 — 캐시 단계로도 그린다(오프라인 포함). */}
        {shipment && (
          <View style={styles.progressWrap}>
            <StageProgress stage={shipment.status} />
          </View>
        )}

        {/* 현재 상태 한 줄 — 실시간 조회분 있을 때만. */}
        {statusText && (
          <Text style={[styles.statusLine, { color: tokens.text.body }]}>{statusText}</Text>
        )}

        {/* 받는 분 — 화면 전용 패스스루(미저장, ADR-005). null/빈 값이면 섹션 숨김. */}
        {recipient && (recipient.name || recipient.regionName) ? (
          <View style={styles.recipient}>
            <Text style={[styles.recipientLabel, { color: tokens.text.secondary }]}>받는 분</Text>
            {recipient.name ? (
              <Text style={[styles.recipientValue, { color: tokens.text.body }]}>
                {recipient.name}
              </Text>
            ) : null}
            {recipient.regionName ? (
              <Text style={[styles.recipientRegion, { color: tokens.text.secondary }]}>
                {recipient.regionName}
              </Text>
            ) : null}
          </View>
        ) : null}

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
  head: { gap: 8, marginBottom: 20 },
  meta: { fontSize: 14, fontWeight: "500" },
  skeleton: { height: 40, justifyContent: "center", marginBottom: 24 },
  progressWrap: { marginBottom: 20 },
  statusLine: { fontSize: 14, fontWeight: "500", marginBottom: 20 },
  recipient: { gap: 2, marginBottom: 24 },
  recipientLabel: { fontSize: 12, fontWeight: "600" },
  recipientValue: { fontSize: 15 },
  recipientRegion: { fontSize: 13 },
  timelineWrap: { minHeight: 80 },
  retry: { gap: 8, alignItems: "flex-start" },
  retryLabel: { fontSize: 14, fontWeight: "600" },
  deleteBtn: { paddingHorizontal: 16, paddingVertical: 16, alignItems: "center" },
  deleteLabel: { fontSize: 15, fontWeight: "600" },
});
