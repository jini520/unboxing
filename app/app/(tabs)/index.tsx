/**
 * 목록 화면(주화면) — 캐시 우선 렌더 후 서버 갱신(ADR-014). 당겨서 새로고침·마지막 업데이트 표기·
 * 빈 상태(가치 제안+등록 CTA)·오프라인 배너·정렬(진행 중 우선).
 * 인터랙션: 상단 ＋ 버튼=등록 / 카드 좌스와이프=삭제(노출→실행, **확인 다이얼로그**)·우스와이프=음소거(낙관+롤백) /
 *   롱프레스=멀티선택 모드(체크박스·전체선택·취소·일괄삭제[확인 다이얼로그·부분실패 복원]).
 * 단건·일괄 삭제 모두 **확인 다이얼로그**로 통일(Undo 토스트 폐기 — 회귀 금지, 사용자 요구). 음소거 안내만 토스트.
 * v1.1(ADR-021~023): 헤더 알림 종+미읽음 배지(HeaderBell) · "완료 숨기기" 필터(filterShipments→sortShipments,
 *   filter→sort 별개. ROADMAP v1.1 Bug Fix A2 로 필터 칩 제거) ·
 *   삭제 시 휴지통 적재(addTrash, 서버 DELETE 전 — 보강④) · sync 시 휴지통 정합(reconcileTrash).
 * 색은 토큰만. 서버 에러 코드/기술 메시지는 화면에 노출하지 않는다(PRD 톤).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useFocusEffect, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ApiError,
  deleteShipment,
  listNotifications,
  listShipments,
  muteShipment,
  type Shipment,
} from "../../src/lib/api";
import { apiDeps } from "../../src/lib/deps";
import { cacheShipments, cacheStore, readCachedShipments } from "../../src/lib/cache";
import { defaultMemoText } from "../../src/lib/memo";
import { sortShipments } from "../../src/lib/sort";
import { filterShipments } from "../../src/lib/filter";
import {
  addTrash,
  reconcileTrash,
  removeTrash,
  trashKey,
  trashStore,
  type TrashSnapshot,
} from "../../src/lib/trash";
import { getInfo, loadInfo, pruneInfo, infoStore, type InfoMap, type ShipmentInfo } from "../../src/lib/info";
import { initLastSeen, notifStore, unreadCount } from "../../src/lib/notif";
import { loadListFilter, prefsStore, saveListFilter } from "../../src/lib/prefs";
import { pruneSelected, selectAll, toggleSelected } from "../../src/lib/selection";
import { relativeTime } from "../../src/lib/time";
import { Plus, Trash } from "../../src/components/icons";
import { HeaderBell } from "../../src/components/HeaderBell";
import { ShipmentCard } from "../../src/components/ShipmentCard";
import { useTheme } from "../../src/theme/ThemeProvider";
import { fontSize, fontWeight, radius, spacing } from "../../src/theme/layout";

const NOTICE_MS = 2000;

/**
 * 삭제 시 휴지통에 적재할 스냅샷 — 송장 + 라이브 택배 정보(info). 보강④: info 는 prune 보다 먼저 읽어 유실 방지.
 * info 가 비면 undefined(빈 객체 저장 안 함). 키는 trash 가 carrier:trackingNo 로 만든다.
 */
function toTrashSnapshot(s: Shipment, info: ShipmentInfo): TrashSnapshot {
  return {
    carrier: s.carrier,
    trackingNo: s.trackingNo,
    status: s.status,
    createdAt: s.createdAt,
    statusChangedAt: s.statusChangedAt,
    info: Object.keys(info).length > 0 ? info : undefined,
  };
}

export default function ListScreen() {
  const { tokens } = useTheme();
  const [shipments, setShipments] = useState<Shipment[] | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  // 상대 시간 계산용 현재 시각 — sync 시에만 갱신해 카드 memo 가 매 렌더 깨지지 않게 한다.
  const [now, setNow] = useState(() => Date.now());
  const [reduceMotion, setReduceMotion] = useState(false);
  // 운송장별 택배 정보(메모·카테고리·금액, 로컬 전용 — info 스토어) — 카드에 메모·카테고리 칩 표시.
  // 메모는 step5 마이그레이션으로 구 memos→info 통합 후 여기(info)에서 읽는다(단일 출처). 상세 편집 → 포커스 복귀 시 재로드.
  const [infoMap, setInfoMap] = useState<InfoMap>({});

  // 필터: ROADMAP v1.1 Bug Fix A2 로 칩(전체/진행중/임박/완료/예외)을 제거 — "완료 숨기기" 지속 토글(prefs)만 남는다.
  const [hideCompleted, setHideCompleted] = useState(false);
  // 헤더 알림 종 미읽음 수 — GET /notifications + 로컬 lastSeen 으로 계산(보강⑤·ADR-023).
  const [unread, setUnread] = useState(0);

  // 멀티선택: 선택 모드는 명시적 플래그(롱프레스로 진입). **0개 선택이어도** 취소/뒤로 전까진 유지된다.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  // 음소거 등 비차단 안내 토스트(자동 소멸). 삭제는 확인 다이얼로그라 토스트 없음.
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

  // 헤더 종 미읽음 갱신 — 첫 fetch 면 lastSeen=now 로 초기화(기존 기록 미읽음 폭주 방지, 보강⑤).
  // 구버전 서버(404)·오프라인은 조용히 미갱신(코드 비노출).
  const refreshUnread = useCallback(async () => {
    try {
      const notifs = await listNotifications(apiDeps);
      const baseline = await initLastSeen({ store: notifStore, now: Date.now() });
      setUnread(unreadCount(notifs, baseline));
    } catch {
      // 알림 기록 조회 실패 → 배지 미갱신.
    }
  }, []);

  const sync = useCallback(async () => {
    void refreshUnread();
    try {
      const list = await listShipments(apiDeps);
      const sorted = sortShipments(list);
      const ts = Date.now();
      setShipments(sorted);
      setLastUpdated(ts);
      setNow(ts);
      setOffline(false);
      // 허상 선택 제거 — 갱신으로 사라진 id 는 선택에서 떨군다(선택 모드 중 다른 기기 삭제 등).
      setSelectedIds((prev) => (prev.size ? pruneSelected(prev, sorted.map((s) => s.id)) : prev));
      // 삭제된 송장(서버 목록에 없음)의 택배 정보 정리. 서버 목록(list)이 권위 — 미동기화분은 안 지운다.
      setInfoMap(await pruneInfo(list.map((s) => s.id), { store: infoStore }));
      await cacheShipments(sorted, { store: cacheStore, now: ts });
      // 휴지통 정합(E4·보강④) — 서버에 (다시) 존재하는 키는 휴지통서 제거(수동 재등록·타 기기 복구로 중복 표시 방지).
      await reconcileTrash(
        new Set(list.map((s) => trashKey(s.carrier, s.trackingNo))),
        { store: trashStore },
      );
    } catch (e) {
      // NETWORK(오프라인)는 캐시 유지 + 배너. 그 외도 캐시를 유지하고 조용히(코드 비노출).
      if (e instanceof ApiError && e.code === "NETWORK") setOffline(true);
    }
  }, [refreshUnread]);

  // 최초: 캐시 우선 렌더 → 서버 갱신.
  useEffect(() => {
    let active = true;
    void (async () => {
      const cached = await readCachedShipments({ store: cacheStore });
      if (active && cached) {
        setShipments(sortShipments(cached.list));
        setLastUpdated(cached.cachedAt);
      }
      const loaded = await loadInfo({ store: infoStore });
      if (active) setInfoMap(loaded);
      // "완료 숨기기" 지속 토글(택배함 상단, A2 로 설정에서 이동)을 읽어 적용. 미설정/손상 → off 폴백.
      const filterPref = await loadListFilter({ store: prefsStore });
      if (active) setHideCompleted(filterPref.hideCompleted);
      await sync();
    })();
    return () => {
      active = false;
    };
  }, [sync]);

  // 포커스 복귀 시 새로고침(상세에서 삭제하고 돌아온 경우 등) + 택배 정보/필터 설정 재로드(상세·설정에서 변경 반영).
  useFocusEffect(
    useCallback(() => {
      void sync();
      void loadInfo({ store: infoStore }).then(setInfoMap);
      void loadListFilter({ store: prefsStore }).then((p) => setHideCompleted(p.hideCompleted));
    }, [sync]),
  );

  // 표시 목록 — filter→sort 순서(별개 단계). filterShipments(08)로 완료숨김 적용 후 기존 sortShipments.
  const visible = useMemo(
    () => sortShipments(filterShipments(shipments ?? [], { hideCompleted })),
    [shipments, hideCompleted],
  );

  // 완료된 항목 숨기기 토글(택배함 상단, A2 로 설정에서 이동) — 로컬 저장(prefs). 즉시 반영.
  const onHideCompleted = useCallback((value: boolean) => {
    setHideCompleted(value);
    void saveListFilter({ hideCompleted: value }, { store: prefsStore });
  }, []);

  // 서버 반영 — 낙관적으로 목록에서 제거 + **휴지통 적재(서버 DELETE 전, 보강④)** 후 DELETE.
  // 실패(404=이미 없음 제외)면 휴지통 항목 되돌리고 목록 복원 + 안내.
  const removeWithServer = useCallback((s: Shipment) => {
    setShipments((prev) => prev?.filter((x) => x.id !== s.id) ?? prev);
    void (async () => {
      // 보강④: info 스냅샷을 prune 보다 **먼저** 휴지통에 기록(info 유실 방지).
      const info = await getInfo(s.id, { store: infoStore });
      await addTrash(toTrashSnapshot(s, info), { store: trashStore, now: Date.now() });
      try {
        await deleteShipment(s.id, apiDeps);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return; // 이미 없음 → 멱등 성공.
        await removeTrash(trashKey(s.carrier, s.trackingNo), { store: trashStore });
        setShipments((prev) => (prev ? sortShipments([...prev, s]) : prev));
        Alert.alert("삭제하지 못했어요", "잠시 후 다시 시도해 주세요");
      }
    })();
  }, []);

  // 단건 삭제(스와이프 2단계/버튼 탭) — **확인 다이얼로그**로 통일(Undo 폐기, 사용자 요구). 확인 시 즉시 반영.
  // 본문에 식별 문구(메모/대체문구)를 보여 무엇을 지우는지 명확히 한다(일괄삭제는 개수 표기).
  const doDelete = useCallback(
    (s: Shipment) => {
      Alert.alert("삭제할까요?", infoMap[s.id]?.memo || defaultMemoText(s.createdAt), [
        { text: "취소", style: "cancel" },
        { text: "삭제", style: "destructive", onPress: () => removeWithServer(s) },
      ]);
    },
    [infoMap, removeWithServer],
  );

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
  const enterSelect = useCallback((id: string) => {
    setSelectionMode(true);
    setSelectedIds((prev) => toggleSelected(prev, id));
  }, []);
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => toggleSelected(prev, id));
  }, []);
  // 명시적 종료만 — 취소 버튼 / Android 뒤로 / 일괄삭제 완료. 0개 선택으로는 종료되지 않는다.
  const cancelSelect = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  // Android 하드웨어 뒤로 → 선택 모드면 종료(앱/화면 이탈 대신). iOS 는 무영향.
  useEffect(() => {
    if (!selectionMode) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      cancelSelect();
      return true;
    });
    return () => sub.remove();
  }, [selectionMode, cancelSelect]);
  // 전체 선택은 **필터된 목록 기준**(멀티선택과 필터 공존) — 화면에 보이는 visible 만 선택한다.
  const selectAllVisible = useCallback(() => {
    setSelectedIds(selectAll(visible.map((s) => s.id)));
  }, [visible]);
  // 전체 해제 — 선택만 비우고 선택 모드는 유지(취소와 다름).
  const deselectAll = useCallback(() => setSelectedIds(new Set()), []);

  // 일괄 삭제는 Undo 없음(확인 다이얼로그로 통일) — 각 항목을 **서버 삭제 전 휴지통 적재**(보강④) 후 DELETE.
  // 실패분(404 제외)은 휴지통서 되돌리고 목록 복원 + 안내.
  const runBulkDelete = useCallback(async (targets: Shipment[]) => {
    const ids = targets.map((s) => s.id);
    setShipments((prev) => prev?.filter((s) => !ids.includes(s.id)) ?? prev);
    setSelectionMode(false);
    setSelectedIds(new Set());
    const now = Date.now();
    // 보강④: info 스냅샷을 서버 삭제보다 먼저 휴지통에 적재(유실 방지).
    await Promise.all(
      targets.map(async (s) =>
        addTrash(toTrashSnapshot(s, await getInfo(s.id, { store: infoStore })), {
          store: trashStore,
          now,
        }),
      ),
    );
    const results = await Promise.allSettled(ids.map((id) => deleteShipment(id, apiDeps)));
    // 404 = 이미 없음(다른 기기 삭제) → 멱등 성공. 그 외 실패만 복원.
    const failed = targets.filter((_, i) => {
      const r = results[i];
      return r.status === "rejected" && !(r.reason instanceof ApiError && r.reason.status === 404);
    });
    if (failed.length > 0) {
      await Promise.all(
        failed.map((s) => removeTrash(trashKey(s.carrier, s.trackingNo), { store: trashStore })),
      );
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

  // 안정적 renderItem — 변경된 카드만 재렌더(택배 정보와 결합). 선택 상태는 selectedIds 의존으로 반영.
  const renderItem = useCallback(
    ({ item }: { item: Shipment }) => (
      <ShipmentCard
        shipment={item}
        now={now}
        memo={infoMap[item.id]?.memo}
        category={infoMap[item.id]?.category}
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
    [now, infoMap, selectionMode, selectedIds, reduceMotion, enterSelect, toggleSelect, doDelete, toggleMute],
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.bg.page }]} edges={["top"]}>
      <View style={styles.header}>
        {selectionMode ? (
          <>
            <View style={styles.headerRow}>
              <Pressable
                onPress={cancelSelect}
                hitSlop={8}
                style={styles.headerSide}
                accessibilityRole="button"
                accessibilityLabel="선택 취소"
              >
                <Text style={[styles.headerAction, { color: tokens.text.secondary }]}>취소</Text>
              </Pressable>
              <Text style={[styles.countTitle, { color: tokens.text.primary }]}>
                {selectedIds.size}개 선택
              </Text>
              <Pressable
                onPress={confirmBulkDelete}
                hitSlop={8}
                style={[styles.headerSide, styles.headerSideEnd]}
                accessibilityRole="button"
                accessibilityLabel={`선택한 ${selectedIds.size}개 삭제`}
              >
                <Trash size={24} color={tokens.stage.exception} />
              </Pressable>
            </View>
            {/* 전체 선택 / 전체 해제 — 헤더 아래 별도 행(카운트 가운데 유지). */}
            <View style={styles.selectAllRow}>
              <Pressable onPress={selectAllVisible} hitSlop={8} accessibilityRole="button" accessibilityLabel="전체 선택">
                <Text style={[styles.headerAction, { color: tokens.text.secondary }]}>전체 선택</Text>
              </Pressable>
              <Pressable onPress={deselectAll} hitSlop={8} accessibilityRole="button" accessibilityLabel="전체 해제">
                <Text style={[styles.headerAction, { color: tokens.text.secondary }]}>전체 해제</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <View style={styles.headerRow}>
              <Text style={[styles.title, { color: tokens.text.primary }]}>택배함</Text>
              <View style={styles.headerActions}>
                <HeaderBell unread={unread} />
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
            </View>
            <Text style={[styles.pageDesc, { color: tokens.text.secondary }]}>
              등록한 택배의 배송 상태를 모아 봐요
            </Text>
          </>
        )}
      </View>

      {offline && (
        <View style={[styles.banner, { backgroundColor: tokens.bg.secondary }]}>
          <Text style={{ color: tokens.text.body }}>오프라인 — 마지막으로 받은 상태예요</Text>
        </View>
      )}

      {/* 완료 숨기기 토글(A2 로 설정에서 이동) — 송장이 있고 비선택 모드일 때만(빈 상태선 의미 없음). */}
      {!selectionMode && shipments !== null && shipments.length > 0 && (
        <View
          style={[styles.filterToggle, { backgroundColor: tokens.bg.surface, borderColor: tokens.border }]}
        >
          <Text style={[styles.filterToggleLabel, { color: tokens.text.body }]}>
            배송 완료된 항목 감추기
          </Text>
          <Switch
            value={hideCompleted}
            onValueChange={onHideCompleted}
            trackColor={{ false: tokens.bg.secondary, true: tokens.accent }}
            ios_backgroundColor={tokens.bg.secondary}
            accessibilityLabel="배송 완료된 항목 감추기"
          />
        </View>
      )}

      {shipments === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.text.secondary} />
        </View>
      ) : shipments.length === 0 ? (
        <EmptyState />
      ) : visible.length === 0 ? (
        // 필터 결과 0건 — 입력 0건(빈 상태)과 **구분**한다(필터를 바꾸도록 안내).
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: tokens.text.secondary }]}>
            조건에 맞는 택배가 없어요
          </Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          // 마지막 업데이트(신선도) — 첫 카드 위 오른쪽.
          ListHeaderComponent={
            lastUpdated !== null && !selectionMode ? (
              <Text style={[styles.listFresh, { color: tokens.text.secondary }]}>
                {relativeTime(lastUpdated, now)} 업데이트
              </Text>
            ) : null
          }
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

      {notice && (
        <View style={[styles.toast, { backgroundColor: tokens.text.primary }]}>
          <Text style={{ color: tokens.bg.page }}>{notice}</Text>
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
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  // 헤더 우측 액션 묶음(알림 종 + 등록 ＋).
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  headerAction: { fontSize: fontSize.callout },
  // 양 끝 동일 폭 → 가운데 카운트가 화면 중앙에 온다.
  headerSide: { minWidth: 56 },
  headerSideEnd: { alignItems: "flex-end" },
  selectAllRow: { flexDirection: "row", justifyContent: "flex-end", gap: 20, marginTop: 10 },
  // 터치 타깃 ≥44(아이콘 24 + 패딩 10*2).
  iconBtn: { padding: 10, margin: -10 },
  title: { fontSize: fontSize.display1, fontWeight: fontWeight.semibold },
  countTitle: { flex: 1, textAlign: "center", fontSize: fontSize.title3, fontWeight: fontWeight.semibold },
  pageDesc: { fontSize: fontSize.footnote, lineHeight: 19, marginTop: 10 },
  listFresh: { fontSize: fontSize.caption, textAlign: "right", marginBottom: spacing.sm },
  banner: { marginHorizontal: spacing.lg, marginVertical: spacing.sm, padding: spacing.md, borderRadius: radius.md },
  filterToggle: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  filterToggleLabel: { fontSize: fontSize.callout },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xxl, gap: 20 },
  list: { padding: spacing.lg },
  emptyTitle: { fontSize: fontSize.base, textAlign: "center", lineHeight: 24 },
  cta: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md },
  ctaLabel: { fontSize: fontSize.callout, fontWeight: fontWeight.semibold },
  toast: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderRadius: radius.md,
  },
});
