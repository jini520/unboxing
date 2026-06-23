/**
 * 알림 기록 화면(/notifications) — 서버가 발송한 배송 알림을 시간 역순으로 표시(ADR-023).
 * **앱이 꺼져 있을 때 받은 알림까지** 포함 — 서버 SOT(GET /notifications) + 로컬 캐시(오프라인 읽기, ADR-014).
 * 항목 탭 → 해당 상세 딥링크(/shipment/:id). 대상 정리됨(shipmentId null)이면 비활성 + "정리된 택배예요" 토스트(E9).
 * 미읽음/읽음은 로컬(notif.ts) — 열람·"모두 읽음" 시 markSeen → 헤더 배지 0. 첫 실행은 now 초기화라 폭주 없음(보강⑤).
 * 택배사 한글명 변환은 앱 책임(carrierName) — 서버는 carrierId 저장(이슈 #9 원칙). 색은 토큰만, 에러 코드 비노출.
 * docs/UI_GUIDE.md "알림 기록 화면", docs/ARCHITECTURE.md "v1.1 …", ADR-023.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { listNotifications, type NotificationRecord } from "../src/lib/api";
import { apiDeps } from "../src/lib/deps";
import { cacheNotifications, cacheStore, readCachedNotifications } from "../src/lib/cache";
import { loadLastSeen, markSeen, notifStore } from "../src/lib/notif";
import { carrierName } from "../src/lib/carrier";
import { dateKST, relativeTime } from "../src/lib/time";
import { pushDeps } from "../src/lib/push";
import { ScreenHeader } from "../src/components/ScreenHeader";
import { STAGE_META } from "../src/components/StageBadge";
import { useTheme } from "../src/theme/ThemeProvider";
import { fontSize, fontWeight, radius, spacing } from "../src/theme/layout";

const NOTICE_MS = 2000;
const DAY_MS = 86_400_000;

interface Section {
  title: string;
  data: NotificationRecord[];
}

/** sentAt(KST) → 날짜 그룹 라벨(오늘/어제/M월 D일). now 기준 상대 판정. */
function dayLabel(sentAt: number, now: number): string {
  const key = dateKST(sentAt); // "YYYYMMDD"
  if (!key) return "";
  if (key === dateKST(now)) return "오늘";
  if (key === dateKST(now - DAY_MS)) return "어제";
  return `${Number(key.slice(4, 6))}월 ${Number(key.slice(6, 8))}일`;
}

/** 시간 역순(서버 정렬) 목록을 날짜 그룹 섹션으로 — 연속 같은 날을 한 섹션으로 묶는다(순서 보존). */
function buildSections(list: NotificationRecord[], now: number): Section[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  for (const item of list) {
    const title = dayLabel(item.sentAt, now);
    if (!cur || cur.title !== title) {
      cur = { title, data: [] };
      sections.push(cur);
    }
    cur.data.push(item);
  }
  return sections;
}

export default function NotificationsScreen() {
  const { tokens } = useTheme();
  const [list, setList] = useState<NotificationRecord[] | null>(null); // null = 로딩
  // 열람 시점의 lastSeen(미읽음 하이라이트 기준) — markSeen 으로 덮어쓰기 전 값을 보존한다.
  const [baseline, setBaseline] = useState<number | null>(null);
  const [granted, setGranted] = useState(true); // 빈 상태 카피 분기(불확실 시 true → "받은 알림 없음")
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = useCallback((msg: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(msg);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  // 로드: 권한(빈 상태 카피) → lastSeen(하이라이트 기준) → 서버 fetch(성공=캐시, 실패=캐시 폴백) → markSeen(열람=읽음).
  const load = useCallback(async () => {
    const ts = Date.now();
    try {
      const p = await pushDeps.getPermissions();
      setGranted(p.granted);
    } catch {
      // 권한 조회 실패 → granted 기본 true 유지(잘못 "꺼짐" 안내하지 않음).
    }
    const seen = await loadLastSeen({ store: notifStore });
    let items: NotificationRecord[];
    try {
      items = await listNotifications(apiDeps);
      await cacheNotifications(items, { store: cacheStore, now: ts });
    } catch {
      // 404(구버전 서버)·5xx·오프라인 → 캐시 폴백(없으면 빈 목록), 코드 비노출(E20).
      items = (await readCachedNotifications({ store: cacheStore })) ?? [];
    }
    setBaseline(seen);
    setList(items);
    setNow(ts);
    // 열람 = 읽음: lastSeen = max(now, 최신 sentAt) → 다음 배지 0(보강⑤). 하이라이트는 baseline(이전 값) 기준 유지.
    const latest = items.reduce((m, x) => Math.max(m, x.sentAt), 0);
    await markSeen({ store: notifStore, now: ts }, latest);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // "모두 읽음" — markSeen + 현재 화면 하이라이트도 즉시 제거(baseline 을 최신 이상으로).
  const markAllRead = useCallback(async () => {
    const ts = Date.now();
    const latest = (list ?? []).reduce((m, x) => Math.max(m, x.sentAt), 0);
    await markSeen({ store: notifStore, now: ts }, latest);
    setBaseline(Math.max(ts, latest));
  }, [list]);

  const open = useCallback(
    (item: NotificationRecord) => {
      // 가리키던 송장이 정리됨(shipmentId null) → 딥링크 비활성, 안내만(목록 표시는 유지, E9).
      if (item.shipmentId === null) {
        showNotice("정리된 택배예요");
        return;
      }
      router.push(`/shipment/${item.shipmentId}`);
    },
    [showNotice],
  );

  const sections = useMemo(() => (list === null ? null : buildSections(list, now)), [list, now]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.bg.page }]} edges={["bottom"]}>
      <ScreenHeader
        title="알림"
        right={
          list !== null && list.length > 0 ? (
            <Pressable
              onPress={() => void markAllRead()}
              hitSlop={8}
              style={styles.headerAction}
              accessibilityRole="button"
              accessibilityLabel="모두 읽음"
            >
              <Text style={[styles.headerActionText, { color: tokens.accent }]}>모두 읽음</Text>
            </Pressable>
          ) : undefined
        }
      />

      {sections === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.text.secondary} />
        </View>
      ) : sections.length === 0 ? (
        <EmptyState granted={granted} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
              tintColor={tokens.text.secondary}
            />
          }
          renderSectionHeader={({ section }) => (
            <Text style={[styles.sectionHeader, { color: tokens.text.secondary }]}>
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => (
            <NotifRow
              item={item}
              now={now}
              unread={baseline !== null && item.sentAt > baseline}
              onPress={() => open(item)}
            />
          )}
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

/**
 * 알림 1행 — 좌측 단계 글리프(StageBadge 의미색 재사용) + 택배사 한글명·상태 문구 + 우측 상대시간.
 * 미읽음 = 선두 점(accent) + 굵은 본문(색 단독 아님). 정리된 항목(shipmentId null)은 흐리게.
 */
function NotifRow({
  item,
  now,
  unread,
  onPress,
}: {
  item: NotificationRecord;
  now: number;
  unread: boolean;
  onPress: () => void;
}) {
  const { tokens } = useTheme();
  const meta = STAGE_META[item.stage];
  const Icon = meta.icon;
  const orphan = item.shipmentId === null;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, orphan && styles.rowOrphan]}
      accessibilityRole="button"
      accessibilityLabel={`${carrierName(item.carrier)} ${item.body}${unread ? ", 안 읽음" : ""}`}
      accessibilityHint={orphan ? "정리된 택배" : undefined}
    >
      {/* 미읽음 점 — 굵은 본문과 함께(색 단독 금지). 자리 차지로 정렬 유지. */}
      <View style={styles.dotCol}>
        {unread && <View style={[styles.dot, { backgroundColor: tokens.accent }]} />}
      </View>
      <Icon
        size={20}
        color={tokens.stage[meta.color]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <View style={styles.rowBody}>
        <Text style={[styles.meta, { color: tokens.text.secondary }]} numberOfLines={1}>
          {carrierName(item.carrier)} · …{item.last4}
        </Text>
        <Text
          style={[
            styles.body,
            { color: tokens.text.primary, fontWeight: unread ? fontWeight.semibold : fontWeight.medium },
          ]}
          numberOfLines={2}
        >
          {item.body}
        </Text>
      </View>
      <Text style={[styles.time, { color: tokens.text.secondary }]}>
        {relativeTime(item.sentAt, now)}
      </Text>
    </Pressable>
  );
}

/** 빈 상태 — 권한 꺼짐이면 켜기 유도(설정), 켜짐인데 없으면 안내. */
function EmptyState({ granted }: { granted: boolean }) {
  const { tokens } = useTheme();
  if (!granted) {
    return (
      <View style={styles.center}>
        <Text style={[styles.emptyTitle, { color: tokens.text.primary }]}>
          알림이 꺼져 있어요
        </Text>
        <Text style={[styles.emptyDesc, { color: tokens.text.secondary }]}>
          켜면 배송 알림이 여기 쌓여요
        </Text>
        <Pressable
          onPress={() => void Linking.openSettings()}
          style={[styles.cta, { backgroundColor: tokens.accent }]}
          accessibilityRole="button"
        >
          <Text style={[styles.ctaLabel, { color: tokens.onAccent }]}>설정에서 켜기</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.center}>
      <Text style={[styles.emptyTitle, { color: tokens.text.secondary }]}>받은 알림이 없어요</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerAction: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  headerActionText: { fontSize: fontSize.callout },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  sectionHeader: {
    fontSize: fontSize.footnote,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  rowOrphan: { opacity: 0.5 },
  dotCol: { width: 8, alignItems: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowBody: { flex: 1, gap: 2 },
  meta: { fontSize: fontSize.caption },
  body: { fontSize: fontSize.body, lineHeight: 20 },
  time: { fontSize: fontSize.caption },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xxl, gap: spacing.md },
  emptyTitle: { fontSize: fontSize.base, textAlign: "center" },
  emptyDesc: { fontSize: fontSize.footnote, textAlign: "center" },
  cta: { marginTop: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md },
  ctaLabel: { fontSize: fontSize.callout, fontWeight: fontWeight.semibold },
  // 비차단 안내 토스트(정리된 택배 등) — 목록 화면과 동일 스타일(text.primary 배경, 사용자 요구).
  toast: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderRadius: radius.md,
  },
});
