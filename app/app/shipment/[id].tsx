/**
 * 상세 화면 — 단계 배지(캐시로 즉시) + 타임라인(실시간 조회·ADR-011). 당겨서 새로고침·삭제(확인 다이얼로그).
 * 타임라인은 로컬 저장/캐시하지 않는다(ADR-011) — 오프라인이면 마지막 단계만 보여준다.
 * 색은 토큰만. 서버 에러 코드/기술 메시지는 화면에 노출하지 않는다(친근한 한국어, PRD 톤).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { loadMemos, memoStore, setMemo } from "../../src/lib/memo";
import { STAGE_STATUS_MESSAGE } from "../../src/lib/stage";
import { absoluteKSTLong } from "../../src/lib/time";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { Pencil } from "../../src/components/icons";
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
  // 메모(로컬 전용) — 이 택배가 무엇인지. 진입 시 로드, 헤더 연필 → 모달에서 편집·저장.
  const [memo, setMemoState] = useState("");
  const [memoModal, setMemoModal] = useState(false);
  const [memoDraft, setMemoDraft] = useState("");
  const deleting = useRef(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    void loadMemos({ store: memoStore }).then((m) => {
      if (active) setMemoState(m[id] ?? "");
    });
    return () => {
      active = false;
    };
  }, [id]);

  const openMemo = useCallback(() => {
    setMemoDraft(memo);
    setMemoModal(true);
  }, [memo]);

  const saveMemo = useCallback(() => {
    setMemoState(memoDraft);
    if (id) void setMemo(id, memoDraft, { store: memoStore });
    setMemoModal(false);
  }, [id, memoDraft]);

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
  if (shipment) {
    // 시각: 최신 이벤트 없으면 status_changed_at 으로 폴백(오프라인에서도 표시).
    // 문구: 택배사 원문(description)을 쓰지 않고 단계별로 친절히 교정. 이동중은 위치(허브명)를 덧붙인다.
    const timePart = absoluteKSTLong(latestEvent?.time ?? shipment.statusChangedAt);
    const msg =
      shipment.status === "이동중" && latestEvent?.location
        ? `이동 중 (${latestEvent.location})`
        : STAGE_STATUS_MESSAGE[shipment.status];
    statusText = timePart ? `${timePart} · ${msg}` : msg;
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.bg.page }]} edges={["bottom"]}>
      <ScreenHeader
        right={
          <Pressable
            onPress={openMemo}
            hitSlop={8}
            style={styles.headerEdit}
            accessibilityRole="button"
            accessibilityLabel="메모 편집"
          >
            <Pencil size={22} color={tokens.text.primary} />
          </Pressable>
        }
      />
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
          <>
            {/* 택배사·운송장번호(좌) + 받는 분(우) — 가장 상단 한 줄. 받는분은 화면 전용·미저장(ADR-005). */}
            <View style={styles.topRow}>
              <Text style={[styles.meta, { color: tokens.text.secondary }]} numberOfLines={1}>
                {carrierName(shipment.carrier)} · {shipment.trackingNo}
              </Text>
              {recipient?.name ? (
                <Text
                  style={[styles.recipientInline, { color: tokens.text.secondary }]}
                  numberOfLines={1}
                >
                  받는 분 {recipient.name}
                </Text>
              ) : null}
            </View>

            {/* 현재 상태 — 중앙에 크게(택배사 원문 대신 친절 교정 문구). */}
            <Text style={[styles.statusLine, { color: tokens.text.primary }]}>{statusText}</Text>

            {/* 단계 진행 인디케이터 — 캐시 단계로도 그린다(오프라인 포함). */}
            <View style={styles.progressWrap}>
              <StageProgress stage={shipment.status} />
            </View>
          </>
        ) : (
          <View style={styles.skeleton}>
            <ActivityIndicator color={tokens.text.secondary} />
          </View>
        )}

        {/* 메모(로컬 전용·미전송) — 읽기 전용 표시. 탭 또는 헤더 연필 → 모달 편집. */}
        <Pressable
          onPress={openMemo}
          style={[styles.memoSection, { backgroundColor: tokens.bg.secondary, borderColor: tokens.border }]}
          accessibilityRole="button"
          accessibilityLabel="메모 편집"
        >
          <Text style={[styles.memoLabel, { color: tokens.text.secondary }]}>메모</Text>
          <Text style={[styles.memoText, { color: memo ? tokens.text.body : tokens.text.disabled }]}>
            {memo || "이 택배가 무엇인지 적어두세요"}
          </Text>
        </Pressable>

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

      {/* 메모 편집 모달 — 헤더 연필/메모 카드 탭으로 진입. */}
      <Modal visible={memoModal} transparent animationType="fade" onRequestClose={() => setMemoModal(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setMemoModal(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: tokens.bg.surface }]} onPress={() => {}}>
            <Text style={[styles.modalTitle, { color: tokens.text.primary }]}>메모</Text>
            <TextInput
              value={memoDraft}
              onChangeText={setMemoDraft}
              placeholder="이 택배가 무엇인지 적어두세요"
              placeholderTextColor={tokens.text.disabled}
              style={[
                styles.memoInput,
                { backgroundColor: tokens.bg.secondary, borderColor: tokens.border, color: tokens.text.primary },
              ]}
              multiline
              maxLength={100}
              autoFocus
              accessibilityLabel="메모 입력"
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setMemoModal(false)} hitSlop={8} accessibilityRole="button">
                <Text style={[styles.modalCancel, { color: tokens.text.secondary }]}>취소</Text>
              </Pressable>
              <Pressable onPress={saveMemo} hitSlop={8} accessibilityRole="button">
                <Text style={[styles.modalSave, { color: tokens.text.primary }]}>저장</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  content: { padding: 16, paddingTop: 8 },
  // 상단 한 줄: 택배사·번호(좌, 늘어남) + 받는분(우, 고정).
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 4 },
  meta: { flexShrink: 1, fontSize: 14, fontWeight: "500" },
  recipientInline: { flexShrink: 0, fontSize: 13 },
  // 현재 상태 — 가장 크고 중앙.
  statusLine: { fontSize: 19, fontWeight: "700", lineHeight: 27, textAlign: "center", marginTop: 16, marginBottom: 24 },
  skeleton: { height: 40, justifyContent: "center", marginBottom: 24 },
  progressWrap: { marginBottom: 20 },
  // 메모 — 로컬 전용. 상세는 읽기 전용 박스(탭→모달), 편집은 모달 입력.
  headerEdit: { paddingVertical: 8, paddingHorizontal: 16 },
  memoSection: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 24, gap: 4 },
  memoLabel: { fontSize: 12, fontWeight: "600" },
  memoText: { fontSize: 15, lineHeight: 21 },
  memoInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, minHeight: 80 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", paddingHorizontal: 24 },
  modalCard: { borderRadius: 12, padding: 16, gap: 12 },
  modalTitle: { fontSize: 16, fontWeight: "700" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 24 },
  modalCancel: { fontSize: 15 },
  modalSave: { fontSize: 15, fontWeight: "700" },
  // 타임라인 — 좌우 패딩 약간 추가(요청).
  timelineWrap: { minHeight: 80, paddingHorizontal: 8 },
  retry: { gap: 8, alignItems: "flex-start" },
  retryLabel: { fontSize: 14, fontWeight: "600" },
  deleteBtn: { paddingHorizontal: 16, paddingVertical: 16, alignItems: "center" },
  deleteLabel: { fontSize: 15, fontWeight: "600" },
});
