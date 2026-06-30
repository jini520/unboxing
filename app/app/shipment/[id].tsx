/**
 * 상세 화면 — 단계 배지(캐시로 즉시) + 타임라인(실시간 조회·ADR-011). 당겨서 새로고침·삭제(확인 다이얼로그).
 * 타임라인은 로컬 저장/캐시하지 않는다(ADR-011) — 오프라인이면 마지막 단계만 보여준다.
 * 색은 토큰만. 서버 에러 코드/기술 메시지는 화면에 노출하지 않는다(친근한 한국어, PRD 톤).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
  createShipment,
  deleteShipment,
  getShipment,
  type Contact,
  type Shipment,
  type TimelineEvent,
} from "../../src/lib/api";
import { apiDeps } from "../../src/lib/deps";
import { autoPickCarrier, carrierName, estimateCarriers } from "../../src/lib/carrier";
import { isValidTrackingNumber, normalizeTrackingNumber } from "../../src/lib/tracking";
import { readCachedShipments, cacheStore } from "../../src/lib/cache";
import { defaultMemoText } from "../../src/lib/memo";
import { displayRecipientName } from "../../src/lib/recipient";
import { CATEGORIES, getInfo, infoStore, setInfo, transferInfo } from "../../src/lib/info";
import { formatAmount, parseAmount } from "../../src/lib/amount";
import { STAGE_STATUS_MESSAGE } from "../../src/lib/stage";
import { absoluteKSTLong } from "../../src/lib/time";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { CarrierSelect } from "../../src/components/CarrierSelect";
import { FileText, Pencil } from "../../src/components/icons";
import { StageProgress } from "../../src/components/StageProgress";
import { Timeline } from "../../src/components/Timeline";
import { useTheme } from "../../src/theme/ThemeProvider";
import { fontSize, fontWeight, radius, spacing } from "../../src/theme/layout";

/** 타임라인 로드 결과 구분 → 화면이 친근한 카피로 매핑(코드 비노출). */
type TimelineState =
  | { kind: "loading" }
  | { kind: "ok"; events: TimelineEvent[] }
  | { kind: "offline" }
  | { kind: "unavailable" } // upstream 실패 — 마지막 단계만
  | { kind: "notfound" };

/** 재등록 실패 카피(코드 비노출) — 409=택배사 미지원(직접 조회 안내), 그 외(429·NETWORK·5xx)=일시 오류. */
function reregisterErrorCopy(e: unknown): string {
  if (e instanceof ApiError && e.code === "CARRIER_UNSUPPORTED") {
    return "지원하지 않는 택배사예요. 택배사 앱에서 직접 조회해 주세요.";
  }
  return "잠시 후 다시 시도해 주세요";
}

export default function DetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { tokens } = useTheme();
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [timeline, setTimeline] = useState<TimelineState>({ kind: "loading" });
  // 수취인은 실시간 조회분만 화면 state 로(미저장 — ADR-005). 캐시·로그 금지, 화면 이탈 시 폐기.
  const [recipient, setRecipient] = useState<Contact | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // 택배 정보(메모·카테고리·금액, 로컬 전용 — ADR-024). 진입 시 로드, 헤더 연필 → "택배 정보" 모달에서 편집·저장.
  // 메모는 헤더 타이틀·식별에 쓰여 별도 state 로 둔다(표시 규칙 불변). 카테고리·금액은 모달 안에서만.
  const [memo, setMemoState] = useState("");
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [infoModal, setInfoModal] = useState(false);
  // 모달 드래프트 — 저장 전까지 라이브 값과 분리. 금액은 입력 문자열(빈/오류 판정용), 저장 시 parseAmount.
  const [memoDraft, setMemoDraft] = useState("");
  const [categoryDraft, setCategoryDraft] = useState<string | undefined>(undefined);
  const [amountDraft, setAmountDraft] = useState("");
  const deleting = useRef(false);
  // 운송장 "수정"(택배사·번호) 모달 — 택배 정보 모달과 별개(헤더 연필 진입). 저장 = 재등록(ADR-027).
  // carrierDraft = 명시 선택(picked) — 번호 변경 시 null 로 비워 autoPickCarrier 정책(ADR-026)이 다시 적용되게 한다.
  const [editModal, setEditModal] = useState(false);
  const [carrierDraft, setCarrierDraft] = useState<string | null>(null);
  const [trackingDraft, setTrackingDraft] = useState("");
  const [carrierListOpen, setCarrierListOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false); // 저장 버튼 비활성·중복탭 표시(시각)
  const saving = useRef(false); // 동기 재진입 가드(setState 전파 전 빠른 더블탭 방지 — deleting 패턴)

  useEffect(() => {
    if (!id) return;
    let active = true;
    void getInfo(id, { store: infoStore }).then((info) => {
      if (!active) return;
      setMemoState(info.memo ?? "");
      setCategory(info.category);
      setAmount(info.amount);
    });
    return () => {
      active = false;
    };
  }, [id]);

  const openInfo = useCallback(() => {
    setMemoDraft(memo);
    setCategoryDraft(category);
    // 금액 드래프트는 순수 숫자 문자열(미설정이면 빈 문자열). ₩·천단위는 표시 전용이라 입력엔 두지 않는다.
    setAmountDraft(amount === undefined ? "" : String(amount));
    setInfoModal(true);
  }, [memo, category, amount]);

  // 금액 입력 오류(비어있지 않은데 0 이상 정수가 아님) — 인라인 안내 + 저장 차단.
  const amountInvalid = amountDraft.trim() !== "" && parseAmount(amountDraft) === undefined;

  const saveInfo = useCallback(() => {
    if (amountInvalid) return; // 잘못된 금액이면 저장하지 않는다(모달 유지·인라인 안내).
    const parsedAmount = amountDraft.trim() === "" ? undefined : parseAmount(amountDraft);
    setMemoState(memoDraft);
    setCategory(categoryDraft);
    setAmount(parsedAmount);
    if (id)
      void setInfo(
        id,
        { memo: memoDraft, category: categoryDraft, amount: parsedAmount },
        { store: infoStore },
      );
    setInfoModal(false);
  }, [id, memoDraft, categoryDraft, amountDraft, amountInvalid]);

  // ── 운송장 수정(택배사·번호) = 재등록(ADR-027) ────────────────
  const openEdit = useCallback(() => {
    if (!shipment) return;
    setCarrierDraft(shipment.carrier); // 현재 송장으로 프리필
    setTrackingDraft(shipment.trackingNo);
    setCarrierListOpen(false);
    setEditModal(true);
  }, [shipment]);

  // 택배사 선택은 등록 화면과 동일 정책(ADR-026): carrierDraft(명시 선택) 우선, 없으면 후보 1개일 때만 자동.
  const editCandidates = estimateCarriers(trackingDraft);
  const editCarrierId = carrierDraft ?? autoPickCarrier(editCandidates);
  const editTrackingValid = isValidTrackingNumber(trackingDraft);
  // 번호 형식이 잘못됐는데 비어있지 않으면 인라인 안내(저장은 비활성).
  const editTrackingInvalid = trackingDraft.trim() !== "" && !editTrackingValid;
  const editDisabled = !editTrackingValid || !editCarrierId || savingEdit;

  // 저장 = 등록-먼저·삭제-나중(ADR-027). render-scope 값을 그대로 닫는 평범한 함수(useCallback X — 드래프트 의존 과다).
  const saveEdit = async () => {
    if (!shipment || !id || editDisabled || saving.current) return;
    const newCarrier = editCarrierId;
    if (!newCarrier) return; // editDisabled 가드와 동일 — TS 좁히기용(string)
    const newNo = normalizeTrackingNumber(trackingDraft);
    const oldId = id;

    // no-op: 택배사·정규화 번호가 현재와 동일 → 호출 없이 닫기.
    if (newCarrier === shipment.carrier && newNo === shipment.trackingNo) {
      setEditModal(false);
      return;
    }

    saving.current = true;
    setSavingEdit(true);
    try {
      // 등록 먼저(실패하면 기존 구독 유지·삭제 안 함).
      const { shipment: created, created: isNew } = await createShipment(newCarrier, newNo, apiDeps);

      // 서버가 같은 행으로 멱등 처리(반환 id == 현재) → 자기 자신 삭제 금지. 닫고 새로고침만.
      if (created.id === oldId) {
        saving.current = false;
        setSavingEdit(false);
        setEditModal(false);
        await load();
        return;
      }

      // 이미 추적 중인 다른 송장(dedupe hit) → 새 구독 안 만듦·old 자동삭제·info 이관 안 함, 그 상세로 이동.
      if (!isNew) {
        saving.current = false;
        setSavingEdit(false);
        setEditModal(false);
        Alert.alert("이미 추적 중인 운송장이에요", "해당 운송장으로 이동할게요.");
        router.replace(`/shipment/${created.id}`);
        return;
      }

      // 정상 재등록: info(메모·카테고리·금액) old→new 이관 → old 구독 해제 → 새 상세로 교체.
      await transferInfo(oldId, created.id, { store: infoStore });
      try {
        await deleteShipment(oldId, apiDeps);
      } catch {
        // old 잔류 — 이미 새 구독 성공. 다음 sync/reconcile 에서 정리(진행은 계속).
      }
      saving.current = false;
      setSavingEdit(false);
      setEditModal(false);
      router.replace(`/shipment/${created.id}`);
    } catch (e) {
      // 등록 실패(429/409/422/NETWORK 등): 기존 송장·구독 그대로, 모달 유지·값 보존, DELETE 안 함.
      saving.current = false;
      setSavingEdit(false);
      Alert.alert("수정하지 못했어요", reregisterErrorCopy(e));
    }
  };

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

  // 헤더 타이틀 = 메모(없으면 등록일 기반 default). 일반 페이지 제목처럼 택배사·번호 줄 위에 보여준다(사용자 요구).
  const headerTitle = memo || (shipment ? defaultMemoText(shipment.createdAt) : undefined);

  // 수취인 표시 게이트(ADR-032): 식별 가능한 이름만 표시(라벨·완전마스킹은 숨김). 미저장 패스스루(ADR-005) — 표시 전용.
  const recipientName = displayRecipientName(recipient?.name);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.bg.page }]} edges={["bottom"]}>
      <ScreenHeader
        title={headerTitle}
        right={
          // 헤더 우측 아이콘 2개(#2 분리): 수정(택배사·번호) / 택배 정보(메모·카테고리·금액).
          <View style={styles.headerActions}>
            <Pressable
              onPress={openEdit}
              hitSlop={8}
              style={styles.headerEdit}
              accessibilityRole="button"
              accessibilityLabel="운송장 수정"
            >
              <Pencil size={22} color={tokens.text.primary} />
            </Pressable>
            <Pressable
              onPress={openInfo}
              hitSlop={8}
              style={styles.headerEdit}
              accessibilityRole="button"
              accessibilityLabel="택배 정보"
            >
              <FileText size={22} color={tokens.text.primary} />
            </Pressable>
          </View>
        }
      />
      {/* 상단 섹션 — 고정(스크롤 X). 타임라인만 이 아래 영역에서 내부 스크롤(요청). */}
      <View style={styles.topSection}>
        {shipment ? (
          <>
            {/* 택배사·운송장번호(좌) + 받는 분(우) — 가장 상단 한 줄. 받는분은 화면 전용·미저장(ADR-005). */}
            <View style={styles.topRow}>
              <Text style={[styles.meta, { color: tokens.text.secondary }]} numberOfLines={1}>
                {carrierName(shipment.carrier)} · {shipment.trackingNo}
              </Text>
              {recipientName ? (
                <Text
                  style={[styles.recipientInline, { color: tokens.text.secondary }]}
                  numberOfLines={1}
                >
                  받는 분 {recipientName}
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
      </View>

      {/* 타임라인 — 페이지 전체가 아니라 이 영역(flex:1) 안에서만 스크롤. 당겨서 새로고침은 여기. */}
      {/* 메모는 상세 본문에 인라인 박스로 두지 않는다 — **헤더 연필 → 모달**에서만 편집(사용자 요구). */}
      <ScrollView
        style={styles.timelineRegion}
        contentContainerStyle={styles.timelineContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={tokens.text.secondary}
          />
        }
      >
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

      {/* 택배 정보 편집 모달 — 헤더 연필로만 진입(본문 인라인 박스 없음·회귀 락). 메모+카테고리+금액(모두 로컬 전용·ADR-024). */}
      <Modal visible={infoModal} transparent animationType="fade" onRequestClose={() => setInfoModal(false)}>
        {/* 바깥 탭 = 키보드만 접기(닫기 아님 — ADR-034 회귀 락). 카드는 KeyboardAvoidingView 로 키보드 회피(P-9). */}
        <Pressable style={styles.modalBackdrop} onPress={() => Keyboard.dismiss()}>
          <KeyboardAvoidingView
            behavior={Platform.select({ ios: "padding", android: "height" })}
            style={styles.modalAvoider}
          >
          <Pressable style={[styles.modalCard, { backgroundColor: tokens.bg.surface }]} onPress={() => {}}>
            <Text style={[styles.modalTitle, { color: tokens.text.primary }]}>택배 정보</Text>
            <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
              {/* 메모 — 기존 textarea 동작 보존. 빈 메모는 저장 시 memo 필드 삭제(setInfo 계약). */}
              <Text style={[styles.fieldLabel, { color: tokens.text.secondary }]}>메모</Text>
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

              {/* 카테고리 — 선택(미설정 기본). 선택된 칩을 다시 탭하면 해제(미설정=값 없음·칩 강조 없음, 보강⑥). */}
              <Text style={[styles.fieldLabel, styles.fieldLabelGap, { color: tokens.text.secondary }]}>
                카테고리
              </Text>
              <View style={styles.chipsWrap}>
                {CATEGORIES.map((c) => {
                  const active = categoryDraft === c;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => setCategoryDraft(active ? undefined : c)}
                      style={[
                        styles.catChip,
                        {
                          borderColor: active ? tokens.accent : tokens.border,
                          backgroundColor: active ? tokens.accent : tokens.bg.surface,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`카테고리 ${c}`}
                    >
                      <Text
                        style={[
                          styles.catChipText,
                          {
                            color: active ? tokens.onAccent : tokens.text.body,
                            fontWeight: active ? fontWeight.semibold : fontWeight.medium,
                          },
                        ]}
                      >
                        {c}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* 금액 — 선택·0 이상 정수(원). ₩ 접두 표시·숫자 키패드. 잘못된 값은 인라인 안내 + 저장 차단(미저장). */}
              <Text style={[styles.fieldLabel, styles.fieldLabelGap, { color: tokens.text.secondary }]}>
                금액
              </Text>
              <View
                style={[
                  styles.amountRow,
                  {
                    backgroundColor: tokens.bg.secondary,
                    borderColor: amountInvalid ? tokens.stage.exception : tokens.border,
                  },
                ]}
              >
                <Text style={[styles.amountPrefix, { color: tokens.text.secondary }]}>₩</Text>
                <TextInput
                  value={amountDraft}
                  onChangeText={setAmountDraft}
                  placeholder="0"
                  placeholderTextColor={tokens.text.disabled}
                  keyboardType="number-pad"
                  style={[styles.amountInput, { color: tokens.text.primary }]}
                  accessibilityLabel="금액 입력"
                />
              </View>
              {amountInvalid ? (
                <Text style={[styles.errorText, { color: tokens.stage.exception }]}>
                  0 이상 정수(원)만 입력할 수 있어요
                </Text>
              ) : null}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setInfoModal(false)} hitSlop={8} accessibilityRole="button">
                <Text style={[styles.modalCancel, { color: tokens.text.secondary }]}>취소</Text>
              </Pressable>
              <Pressable
                onPress={saveInfo}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityState={{ disabled: amountInvalid }}
              >
                <Text
                  style={[
                    styles.modalSave,
                    { color: amountInvalid ? tokens.text.disabled : tokens.text.primary },
                  ]}
                >
                  저장
                </Text>
              </Pressable>
            </View>
          </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* 운송장 수정 모달 — 택배사·번호 편집(헤더 연필 진입). 저장 = 재등록(ADR-027, 새 서버 엔드포인트 없음). */}
      <Modal visible={editModal} transparent animationType="fade" onRequestClose={() => setEditModal(false)}>
        {/* 바깥 탭 = 키보드만 접기(닫기 아님 — ADR-034 회귀 락). 카드는 KeyboardAvoidingView 로 키보드 회피(P-9). */}
        <Pressable style={styles.modalBackdrop} onPress={() => Keyboard.dismiss()}>
          <KeyboardAvoidingView
            behavior={Platform.select({ ios: "padding", android: "height" })}
            style={styles.modalAvoider}
          >
          <Pressable style={[styles.modalCard, { backgroundColor: tokens.bg.surface }]} onPress={() => {}}>
            <Text style={[styles.modalTitle, { color: tokens.text.primary }]}>운송장 수정</Text>
            <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
              {/* 운송장 번호 — 변경 시 carrierDraft 초기화(번호 바뀌면 택배사 자동선택 정책 재적용·ADR-026). */}
              <Text style={[styles.fieldLabel, { color: tokens.text.secondary }]}>운송장 번호</Text>
              <TextInput
                value={trackingDraft}
                onChangeText={(t) => {
                  setTrackingDraft(t);
                  setCarrierDraft(null);
                }}
                placeholder="번호를 입력하세요"
                placeholderTextColor={tokens.text.disabled}
                keyboardType="number-pad"
                style={[
                  styles.editInput,
                  {
                    backgroundColor: tokens.bg.secondary,
                    borderColor: editTrackingInvalid ? tokens.stage.exception : tokens.border,
                    color: tokens.text.primary,
                  },
                ]}
                accessibilityLabel="운송장 번호 입력"
              />
              {editTrackingInvalid ? (
                <Text style={[styles.errorText, { color: tokens.stage.exception }]}>
                  운송장 번호를 다시 확인해 주세요
                </Text>
              ) : null}

              {/* 택배사 — 등록 화면과 동일 컴포넌트·정책 재사용(ADR-026). 후보 ≥2 면 명시 선택 유도. */}
              <Text style={[styles.fieldLabel, styles.fieldLabelGap, { color: tokens.text.secondary }]}>
                택배사
              </Text>
              <CarrierSelect
                candidates={editCandidates}
                value={editCarrierId}
                onChange={setCarrierDraft}
                open={carrierListOpen}
                onToggleOpen={() => setCarrierListOpen((v) => !v)}
              />

              {/* 식별자 변경 = "사실 다른 택배" → 새 번호로 새로 추적(이전 타임라인 교체) 고지(PRD 톤·코드 비노출). */}
              <Text style={[styles.editNotice, { color: tokens.text.secondary }]}>
                번호를 바꾸면 새 운송장으로 다시 추적해요.
              </Text>
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setEditModal(false)} hitSlop={8} accessibilityRole="button">
                <Text style={[styles.modalCancel, { color: tokens.text.secondary }]}>취소</Text>
              </Pressable>
              <Pressable
                onPress={() => void saveEdit()}
                hitSlop={8}
                disabled={editDisabled}
                accessibilityRole="button"
                accessibilityState={{ disabled: editDisabled }}
              >
                <Text
                  style={[
                    styles.modalSave,
                    { color: editDisabled ? tokens.text.disabled : tokens.text.primary },
                  ]}
                >
                  저장
                </Text>
              </Pressable>
            </View>
          </Pressable>
          </KeyboardAvoidingView>
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
  // 상단 고정 섹션 — 헤더 타이틀(메모)과 송장번호 줄 사이 간격은 다른 페이지의 제목→본문 간격에 맞춘다(좁게).
  topSection: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  // 타임라인 영역 — flex:1 로 남은 공간 차지 → 페이지 전체가 아니라 이 안에서만 스크롤.
  timelineRegion: { flex: 1 },
  timelineContent: { paddingHorizontal: spacing.xl, paddingTop: 36, paddingBottom: 36 },
  // 상단 한 줄: 택배사·번호(좌, 늘어남) + 받는분(우, 고정).
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, marginTop: spacing.xs },
  meta: { flexShrink: 1, fontSize: fontSize.body, fontWeight: fontWeight.medium },
  recipientInline: { flexShrink: 0, fontSize: fontSize.footnote },
  // 현재 상태 — 가장 크고 중앙.
  statusLine: { fontSize: fontSize.title2, fontWeight: fontWeight.bold, lineHeight: 27, textAlign: "center", marginTop: spacing.xxl, marginBottom: spacing.xl },
  skeleton: { height: 40, justifyContent: "center", marginBottom: spacing.xl },
  progressWrap: { marginBottom: 28 },
  // 헤더 우측 아이콘 2개(수정·택배 정보) — 우측 정렬 행. 마지막 아이콘이 페이지 거터(16)에 맞도록 컨테이너 paddingRight xs.
  headerActions: { flexDirection: "row", alignItems: "center", paddingRight: spacing.xs },
  // 메모/수정 — 편집은 **헤더 아이콘 → 모달 입력**만(상세 본문에 인라인 박스 없음). 아이콘당 터치 타깃(패딩).
  headerEdit: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  // 수정 모달 운송장 번호 입력(단일 행) — 등록 화면 field 스타일과 동형.
  editInput: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: fontSize.base },
  editNotice: { fontSize: fontSize.footnote, marginTop: spacing.lg },
  memoInput: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: fontSize.callout, minHeight: 80 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  // 카드 래퍼 — 중앙 정렬·좌우 패딩을 여기에 두어, KeyboardAvoidingView 가 키보드 높이만큼 줄인 영역 안에서 카드가 위로 재중앙된다(P-9).
  modalAvoider: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.xl },
  modalCard: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  modalTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold },
  // 필드가 길어질 수 있어(메모+카테고리 칩+금액) 내부 스크롤 — 작은 화면·키보드에서도 액션 버튼이 가려지지 않게.
  modalScroll: { maxHeight: 360 },
  fieldLabel: { fontSize: fontSize.footnote, fontWeight: fontWeight.medium, marginBottom: spacing.sm },
  fieldLabelGap: { marginTop: spacing.lg },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  catChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.md, borderWidth: 1 },
  catChipText: { fontSize: fontSize.footnote },
  amountRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md },
  amountPrefix: { fontSize: fontSize.base, marginRight: spacing.sm },
  amountInput: { flex: 1, paddingVertical: 10, fontSize: fontSize.base },
  errorText: { fontSize: fontSize.footnote, marginTop: spacing.xs },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.xl },
  modalCancel: { fontSize: fontSize.callout },
  modalSave: { fontSize: fontSize.callout, fontWeight: fontWeight.bold },
  retry: { gap: spacing.sm, alignItems: "flex-start" },
  retryLabel: { fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  deleteBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, alignItems: "center" },
  deleteLabel: { fontSize: fontSize.callout, fontWeight: fontWeight.semibold },
});
