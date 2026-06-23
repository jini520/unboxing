/**
 * 휴지통 화면(/trash) — 삭제한 택배를 30일 안에 되살리거나(복구) 완전히 지운다(영구 삭제). **기기 로컬** 소프트 삭제(ADR-022).
 * 복구 = POST /shipments 재등록(멱등 dedupe + 즉시 track) → **반환된 shipment.id** 로 info 라이브 복원 → removeTrash(보강④).
 *   복구의 즉시 track 은 등록 직후 규칙(prev==stored)이라 푸시·알림 기록을 만들지 않는다(중복 알림 없음).
 * 영구 삭제 = removeTrash(엔트리+info 스냅샷 로컬 제거) — **서버 호출 없음**(삭제 시 이미 구독 해제됨).
 * 복구 실패(429 레이트/상한·409 미지원·오프라인 NETWORK)는 **항목 유지 + 안내**(일괄은 실패분만 남김, 순차 처리).
 * 진입 시 pruneTrash(30일·용량 상한) 정리. 색은 토큰만, 에러 코드 비노출(PRD 톤).
 * docs/UI_GUIDE.md "휴지통 화면", docs/ARCHITECTURE.md "v1.1 설계 보강 ④", ADR-022.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, createShipment } from "../src/lib/api";
import { apiDeps } from "../src/lib/deps";
import { infoStore, setInfo } from "../src/lib/info";
import {
  pruneTrash,
  removeTrash,
  trashKey,
  trashStore,
  type TrashEntry,
} from "../src/lib/trash";
import { defaultMemoText } from "../src/lib/memo";
import { carrierName } from "../src/lib/carrier";
import { pruneSelected, selectAll, toggleSelected } from "../src/lib/selection";
import { ScreenHeader } from "../src/components/ScreenHeader";
import { StageBadge } from "../src/components/StageBadge";
import { Check, Restore, Trash } from "../src/components/icons";
import { useTheme } from "../src/theme/ThemeProvider";
import { fontSize, fontWeight, radius, spacing } from "../src/theme/layout";

const DAY_MS = 86_400_000;
const RETENTION_DAYS = 30;
/** D-day 가 이 일수 이하면 임박(예외 색) — 색 단독 아님(캡션 텍스트가 일수를 항상 표기). */
const IMMINENT_DAYS = 3;

/** 휴지통 키(carrier:trackingNo) — 복구 재등록 시 행 id 가 바뀌어도 안정적(선택·식별 단일 출처). */
const keyOf = (e: TrashEntry): string => trashKey(e.carrier, e.trackingNo);

/** deletedAt 으로부터 30일 남은 일수(0 이상, now 주입). 만료 직전은 0. */
function daysLeft(deletedAt: number, now: number): number {
  const expireAt = deletedAt + RETENTION_DAYS * DAY_MS;
  return Math.max(0, Math.ceil((expireAt - now) / DAY_MS));
}

/** 복구 실패 카피(코드 비노출) — 409=택배사 미지원(딥링크 폴백 안내), 그 외(429·NETWORK·5xx)=일시 오류. */
function restoreErrorCopy(e: unknown): string {
  if (e instanceof ApiError && e.code === "CARRIER_UNSUPPORTED") {
    return "지원하지 않는 택배사예요. 택배사 앱에서 직접 조회해 주세요.";
  }
  return "잠시 후 다시 시도해 주세요";
}

export default function TrashScreen() {
  const { tokens } = useTheme();
  const [entries, setEntries] = useState<TrashEntry[] | null>(null); // null = 로딩
  const [now, setNow] = useState(() => Date.now());
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  // 진입·갱신마다 pruneTrash(30일·용량 상한) 후 최신 삭제 순으로 표시. 로컬이라 즉시(오프라인 무관).
  const reload = useCallback(async () => {
    const ts = Date.now();
    const map = await pruneTrash({ store: trashStore, now: ts });
    const list = Object.values(map).sort((a, b) => b.deletedAt - a.deletedAt);
    setEntries(list);
    setNow(ts);
    // 사라진 키(복구·만료)는 선택에서 떨군다.
    setSelectedKeys((prev) => (prev.size ? pruneSelected(prev, list.map(keyOf)) : prev));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // Android 하드웨어 뒤로 → 선택 모드면 종료(화면 이탈 대신). iOS 무영향.
  useEffect(() => {
    if (!selectionMode) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      exitSelect();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionMode]);

  // ── 복구(재등록) ─────────────────────────────────────────
  // 1건 — 재등록(멱등) → **반환 id** 로 info 복원(orphan 정리로 행 id 가 바뀔 수 있어 옛 id 금지) → 휴지통서 제거.
  // 실패는 throw(호출부가 항목 유지·안내) — removeTrash 를 부르지 않으므로 휴지통에 그대로 남는다.
  const restoreOne = useCallback(async (entry: TrashEntry) => {
    const { shipment } = await createShipment(entry.carrier, entry.trackingNo, apiDeps);
    if (entry.info && Object.keys(entry.info).length > 0) {
      await setInfo(shipment.id, entry.info, { store: infoStore });
    }
    await removeTrash(keyOf(entry), { store: trashStore });
  }, []);

  const restore = useCallback(
    (entry: TrashEntry) => {
      void (async () => {
        try {
          await restoreOne(entry);
        } catch (e) {
          Alert.alert("복구하지 못했어요", restoreErrorCopy(e)); // 항목 유지 + 안내.
        }
        await reload();
      })();
    },
    [restoreOne, reload],
  );

  // 일괄 복구 — **순차**(레이트/상한 429 에 graceful) · 실패분만 휴지통에 남김(보강④).
  const runBulkRestore = useCallback(
    async (targets: TrashEntry[]) => {
      if (targets.length === 0) return;
      exitSelect();
      let failed = 0;
      for (const entry of targets) {
        try {
          await restoreOne(entry);
        } catch {
          failed++; // removeTrash 미호출 → 휴지통에 잔류.
        }
      }
      await reload();
      if (failed > 0) Alert.alert("일부를 복구하지 못했어요", "잠시 후 다시 시도해 주세요");
    },
    [restoreOne, reload],
  );

  // ── 영구 삭제(로컬 — 서버 호출 없음) ───────────────────────
  // removeTrash 가 엔트리(=info 스냅샷 포함)를 함께 제거. 삭제 시 이미 구독 해제됐으므로 서버를 부르지 않는다.
  const purge = useCallback(
    (entry: TrashEntry) => {
      Alert.alert("영구 삭제할까요?", "되돌릴 수 없어요", [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: () =>
            void (async () => {
              await removeTrash(keyOf(entry), { store: trashStore });
              await reload();
            })(),
        },
      ]);
    },
    [reload],
  );

  const confirmBulkPurge = useCallback(
    (targets: TrashEntry[]) => {
      if (targets.length === 0) return;
      Alert.alert("영구 삭제할까요?", `선택한 ${targets.length}개를 영구 삭제할까요? 되돌릴 수 없어요`, [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: () =>
            void (async () => {
              for (const e of targets) await removeTrash(keyOf(e), { store: trashStore });
              exitSelect();
              await reload();
            })(),
        },
      ]);
    },
    [reload],
  );

  // ── 멀티선택 ─────────────────────────────────────────────
  const enterSelect = useCallback((key: string) => {
    setSelectionMode(true);
    setSelectedKeys((prev) => toggleSelected(prev, key));
  }, []);
  const toggleSelect = useCallback((key: string) => {
    setSelectedKeys((prev) => toggleSelected(prev, key));
  }, []);
  const exitSelect = useCallback(() => {
    setSelectionMode(false);
    setSelectedKeys(new Set());
  }, []);
  const selectAllVisible = useCallback(() => {
    setSelectedKeys(selectAll((entries ?? []).map(keyOf)));
  }, [entries]);
  const deselectAll = useCallback(() => setSelectedKeys(new Set()), []);

  const targets = useMemo(
    () => (entries ?? []).filter((e) => selectedKeys.has(keyOf(e))),
    [entries, selectedKeys],
  );

  const headerRight =
    entries && entries.length > 0 ? (
      <Pressable
        onPress={selectionMode ? exitSelect : () => setSelectionMode(true)}
        hitSlop={8}
        style={styles.headerAction}
        accessibilityRole="button"
        accessibilityLabel={selectionMode ? "선택 취소" : "일괄 선택"}
      >
        <Text style={[styles.headerActionText, { color: tokens.text.secondary }]}>
          {selectionMode ? "취소" : "일괄"}
        </Text>
      </Pressable>
    ) : undefined;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.bg.page }]} edges={["bottom"]}>
      <ScreenHeader
        title="휴지통"
        description={selectionMode ? `${selectedKeys.size}개 선택` : undefined}
        right={headerRight}
      />

      {selectionMode && (
        <View style={styles.actionBar}>
          <View style={styles.actionGroup}>
            <Pressable onPress={selectAllVisible} hitSlop={8} accessibilityRole="button" accessibilityLabel="전체 선택">
              <Text style={[styles.barText, { color: tokens.text.secondary }]}>전체 선택</Text>
            </Pressable>
            <Pressable onPress={deselectAll} hitSlop={8} accessibilityRole="button" accessibilityLabel="전체 해제">
              <Text style={[styles.barText, { color: tokens.text.secondary }]}>전체 해제</Text>
            </Pressable>
          </View>
          <View style={styles.actionGroup}>
            <Pressable
              onPress={() => void runBulkRestore(targets)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`선택한 ${targets.length}개 복구`}
            >
              <Text style={[styles.barText, { color: tokens.accent }]}>복구</Text>
            </Pressable>
            <Pressable
              onPress={() => confirmBulkPurge(targets)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`선택한 ${targets.length}개 영구 삭제`}
            >
              <Text style={[styles.barText, { color: tokens.stage.exception }]}>영구 삭제</Text>
            </Pressable>
          </View>
        </View>
      )}

      {entries === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.text.secondary} />
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: tokens.text.secondary }]}>휴지통이 비었어요</Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={keyOf}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TrashRow
              entry={item}
              now={now}
              selectionMode={selectionMode}
              selected={selectedKeys.has(keyOf(item))}
              onLongPress={() => enterSelect(keyOf(item))}
              onToggleSelect={() => toggleSelect(keyOf(item))}
              onRestore={() => restore(item)}
              onPurge={() => purge(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

/**
 * 휴지통 1행 = 송장 카드 축약(StageBadge + 메모/대체문구 + 택배사·번호) + "N일 후 영구 삭제" 캡션 + 행 액션.
 * 임박(D-3 이하)은 캡션이 예외 색 — **색 단독 아님**(일수 텍스트가 항상 의미를 전달). 선택 모드는 체크박스·탭 토글, 액션 숨김.
 */
function TrashRow({
  entry,
  now,
  selectionMode,
  selected,
  onLongPress,
  onToggleSelect,
  onRestore,
  onPurge,
}: {
  entry: TrashEntry;
  now: number;
  selectionMode: boolean;
  selected: boolean;
  onLongPress: () => void;
  onToggleSelect: () => void;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const { tokens } = useTheme();
  const left = daysLeft(entry.deletedAt, now);
  const imminent = left <= IMMINENT_DAYS;
  const memo = entry.info?.memo || defaultMemoText(entry.createdAt);
  const ddayText = left <= 0 ? "오늘 영구 삭제" : `${left}일 후 영구 삭제`;

  return (
    <Pressable
      onPress={selectionMode ? onToggleSelect : undefined}
      onLongPress={onLongPress}
      delayLongPress={300}
      style={[
        styles.card,
        { backgroundColor: tokens.bg.surface, borderColor: selected ? tokens.accent : tokens.border },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${carrierName(entry.carrier)} ${entry.trackingNo}, ${entry.status}, ${ddayText}`}
      accessibilityState={selectionMode ? { selected } : undefined}
    >
      <View style={styles.row}>
        {selectionMode && (
          // 체크박스 — 색 단독 아님(선택 시 체크 글리프 + a11y selected).
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
          <StageBadge stage={entry.status} />
          <Text style={[styles.memo, { color: tokens.text.primary }]} numberOfLines={1}>
            {memo}
          </Text>
          <Text style={[styles.carrier, { color: tokens.text.secondary }]}>
            {carrierName(entry.carrier)} · {entry.trackingNo}
          </Text>
          <Text style={[styles.dday, { color: imminent ? tokens.stage.exception : tokens.text.secondary }]}>
            {ddayText}
          </Text>
        </View>
        {!selectionMode && (
          <View style={styles.actions}>
            <Pressable
              onPress={onRestore}
              hitSlop={6}
              style={styles.restoreBtn}
              accessibilityRole="button"
              accessibilityLabel="복구"
            >
              <Restore
                size={18}
                color={tokens.accent}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <Text style={[styles.restoreText, { color: tokens.accent }]}>복구</Text>
            </Pressable>
            <Pressable
              onPress={onPurge}
              hitSlop={6}
              style={styles.purgeBtn}
              accessibilityRole="button"
              accessibilityLabel="영구 삭제"
            >
              <Trash
                size={20}
                color={tokens.stage.exception}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
            </Pressable>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerAction: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  headerActionText: { fontSize: fontSize.callout },
  // 선택 모드 액션 바 — 좌(전체 선택/해제)·우(복구/영구삭제).
  actionBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  actionGroup: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  barText: { fontSize: fontSize.callout },
  list: { padding: spacing.lg, gap: spacing.md },
  card: { borderRadius: radius.md, borderWidth: 1, padding: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, gap: spacing.xs },
  memo: { fontSize: fontSize.callout, fontWeight: fontWeight.semibold },
  carrier: { fontSize: fontSize.caption },
  dday: { fontSize: fontSize.caption },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  restoreBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, padding: spacing.xs },
  restoreText: { fontSize: fontSize.footnote, fontWeight: fontWeight.semibold },
  purgeBtn: { padding: spacing.xs },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
    gap: spacing.md,
  },
  emptyTitle: { fontSize: fontSize.base, textAlign: "center" },
});
