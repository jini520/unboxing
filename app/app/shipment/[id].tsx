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
  classifyPurchase,
  createShipment,
  deleteShipment,
  getShipment,
  type Contact,
  type Shipment,
  type TimelineEvent,
} from "../../src/lib/api";
import { apiDeps } from "../../src/lib/deps";
import { capturePurchaseText } from "../../src/lib/capture";
import { maskPurchaseText } from "../../src/lib/purchaseMask";
import { mapClassificationToInfo } from "../../src/lib/purchase";
import { autoPickCarrier, carrierName, estimateCarriers } from "../../src/lib/carrier";
import { isValidTrackingNumber, normalizeTrackingNumber } from "../../src/lib/tracking";
import { readCachedShipments, cacheStore } from "../../src/lib/cache";
import { defaultMemoText } from "../../src/lib/memo";
import { displayRecipientName } from "../../src/lib/recipient";
import { CATEGORIES, getInfo, infoStore, MEMO_MAX_LENGTH, setInfo, transferInfo } from "../../src/lib/info";
import { formatAmount, parseAmount } from "../../src/lib/amount";
import { STAGE_STATUS_MESSAGE } from "../../src/lib/stage";
import { absoluteKSTLong } from "../../src/lib/time";
import { ScreenHeader } from "../../src/components/ScreenHeader";
import { CarrierSelect } from "../../src/components/CarrierSelect";
import { Camera, Close, FileText, Pencil } from "../../src/components/icons";
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
  // openInfo="1" 이면 mount 시 "택배 정보" 모달을 1회 자동오픈한다(등록 후 정보입력 — ADR-043).
  // 별칭(openInfoParam)으로 받는다 — 아래 openInfo 콜백과 이름 충돌 회피.
  const { id, openInfo: openInfoParam } = useLocalSearchParams<{ id: string; openInfo?: string }>();
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
  // 캡처로 채우기 단계(이미지 선택→OCR→분류) — null=비진행. 모달 오버레이가 단계별 진행을 표시(ADR-045).
  // 단계는 실제 두 함수 경계(OCR/분류)로만 — 가짜 중간 단계 금지(ADR-045·ADR-037 1콜 반환). 캡처는 보조(ADR-039).
  const [captureStage, setCaptureStage] = useState<null | "ocr" | "classify">(null);
  const capturing = captureStage !== null;
  // 추정 진행률 %(ADR-045 개정) — OCR/분류는 원자적 호출이라 세밀 진행이 없어 시간 기반 추정.
  // OCR 0→45 / 분류 45→90 천장으로 이징 점근(완료 전 100% 금지), 성공 시 100 스냅. % 는 추정치(정확도 보장 아님).
  const [captureProgress, setCaptureProgress] = useState(0);
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null); // 램프 setInterval 핸들
  const captureHoldRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 성공 100% 유지(250ms) 핸들
  const deleting = useRef(false);
  // 운송장 "수정"(택배사·번호) 모달 — 택배 정보 모달과 별개(헤더 연필 진입). 저장 = 재등록(ADR-027).
  // carrierDraft = 명시 선택(picked) — 번호 변경 시 null 로 비워 autoPickCarrier 정책(ADR-026)이 다시 적용되게 한다.
  const [editModal, setEditModal] = useState(false);
  const [carrierDraft, setCarrierDraft] = useState<string | null>(null);
  const [trackingDraft, setTrackingDraft] = useState("");
  const [carrierListOpen, setCarrierListOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false); // 저장 버튼 비활성·중복탭 표시(시각)
  const saving = useRef(false); // 동기 재진입 가드(setState 전파 전 빠른 더블탭 방지 — deleting 패턴)

  // 저장값 로드 — live state(memo/category/amount)만 채운다. **드래프트는 여기서 미러하지 않는다**:
  // 자동오픈 모달에 사용자가 타이핑하는 중 늦게 resolve 된 getInfo() 결과가 입력을 덮는 레이스를 막기 위함(ADR-046 개정·P-12 F4).
  // 드래프트는 모달을 여는 시점(openInfo·자동오픈)에만 prefillDrafts 로 채운다.
  const [infoLoaded, setInfoLoaded] = useState(false);
  useEffect(() => {
    if (!id) return;
    let active = true;
    void getInfo(id, { store: infoStore }).then((info) => {
      if (!active) return;
      setMemoState(info.memo ?? "");
      setCategory(info.category);
      setAmount(info.amount);
      setInfoLoaded(true); // 로드 완료 — 자동오픈은 이 시점 이후에만 열린다(아래 effect).
    });
    return () => {
      active = false;
    };
  }, [id]);

  // 저장값(또는 live 값) → 모달 드래프트 단일 매핑(헤더·자동오픈 공유). 금액은 순수 숫자 문자열(미설정=빈 문자열).
  const prefillDrafts = useCallback(
    (info: { memo?: string; category?: string; amount?: number }) => {
      setMemoDraft(info.memo ?? "");
      setCategoryDraft(info.category);
      setAmountDraft(info.amount === undefined ? "" : String(info.amount));
    },
    [],
  );

  // openInfo="1" 딥링크(등록 후 정보입력 — ADR-043)면 mount 시 "택배 정보" 모달을 1회만 자동오픈한다.
  // **로드 완료(infoLoaded)까지 지연** 후 prefill 하고 연다 — 열린 모달의 사용자 입력을 비동기 로드가 덮지 않게(ADR-046 개정).
  // consumed ref 로 1회 가드(재오픈 루프 방지). 신규 송장은 빈 값으로 열린다(정상 — #4 등록 직후).
  const openInfoConsumed = useRef(false);
  useEffect(() => {
    if (openInfoConsumed.current || openInfoParam !== "1" || !infoLoaded) return;
    openInfoConsumed.current = true;
    prefillDrafts({ memo, category, amount });
    setInfoModal(true);
  }, [openInfoParam, infoLoaded, memo, category, amount, prefillDrafts]);

  const openInfo = useCallback(() => {
    // 헤더 진입 — 현재 live 값으로 재-prefill(재오픈 시 미저장 편집 폐기 유지 — ADR-046 회귀 락).
    prefillDrafts({ memo, category, amount });
    setInfoModal(true);
  }, [memo, category, amount, prefillDrafts]);

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

  // ── 캡처로 채우기(v1.1.2) — 직접 입력의 **보조**(ADR-039). 모달 드래프트를 자동 채움(편집 가능). ──
  // 파이프라인: ① 이미지 선택+OCR(기기 내) → ② 마스킹(PII 제거) → ③ 분류(마스킹 텍스트만 전송) → ④ 매핑.
  // 어느 단계가 실패해도 직접 입력·저장 흐름은 안 멈춘다(폴백 안내만). 이미지·원문 PII 는 기기를 안 떠난다(ADR-036).

  // 진행률 추정 램프(ADR-045) — captureStage 동안 ceiling(OCR 45·분류 90)으로 이징 점근(완료 전 100% 금지).
  // 단계 전환 시 cleanup→재시작(progress 유지·새 ceiling 으로 계속), stage null·언마운트 시 clearInterval(누수 방지).
  useEffect(() => {
    if (captureStage === null) return;
    const ceiling = captureStage === "ocr" ? 45 : 90;
    captureTimerRef.current = setInterval(() => {
      setCaptureProgress((p) => (p >= ceiling ? p : p + Math.max(1, Math.round((ceiling - p) * 0.08))));
    }, 120);
    return () => {
      if (captureTimerRef.current) {
        clearInterval(captureTimerRef.current);
        captureTimerRef.current = null;
      }
    };
  }, [captureStage]);

  // 성공 100% 유지(250ms) setTimeout 의 언마운트 정리 — 램프 interval 은 위 effect cleanup 이 정리.
  useEffect(
    () => () => {
      if (captureHoldRef.current) clearTimeout(captureHoldRef.current);
    },
    [],
  );

  // 즉시 클리어(취소·empty·실패) — 오버레이 제거·% 0·타이머 전부 정리. setCaptureStage(null) 이 램프 effect cleanup 도 발동.
  const clearCapture = useCallback(() => {
    if (captureTimerRef.current) {
      clearInterval(captureTimerRef.current);
      captureTimerRef.current = null;
    }
    if (captureHoldRef.current) {
      clearTimeout(captureHoldRef.current);
      captureHoldRef.current = null;
    }
    setCaptureStage(null);
    setCaptureProgress(0);
  }, []);

  const onCaptureFill = useCallback(async () => {
    if (capturing) return;
    try {
      // 진행률·오버레이는 picker 가 사진을 반환한 직후(onImagePicked·OCR 시작)부터 — picker 여는 동안엔
      // 안 뜬다(ADR-045 개정 2: 사진 고르는 시간에 램프가 미리 돌던 버그 수정). 취소 시 onImagePicked 미발화 → 오버레이 안 뜸.
      const cap = await capturePurchaseText({
        onImagePicked: () => {
          setCaptureProgress(0);
          setCaptureStage("ocr"); // ① OCR 구간 — 오버레이 "이미지 인식 중…"·램프 0→45
        },
      }); // ① 이미지 선택 + 온디바이스 OCR
      if (cap.kind === "canceled") {
        clearCapture(); // 사용자 취소 — 조용히(% 0·오버레이 제거)
        return;
      }
      if (cap.kind === "empty") {
        clearCapture();
        Alert.alert("글자를 인식하지 못했어요", "주문 상세가 잘 보이게 다시 촬영해 주세요.");
        return;
      }
      const masked = maskPurchaseText(cap.text); // ② PII 마스킹 — 외부엔 마스킹 텍스트만(ADR-038·005)
      setCaptureStage("classify"); // ② 분류 구간 — 오버레이 "상품 분석 중…"·램프 45→90(classifyPurchase 전, ADR-045)
      const result = await classifyPurchase(masked, apiDeps); // ③ 분류(Worker, 요청 시)
      const mapped = mapClassificationToInfo(result); // ④ 검증 통과 필드만 매핑(CATEGORIES 강제·금액 검증)
      // 드래프트 자동 채움 — 매핑된 필드만 덮어쓴다(미분류/미인식 필드는 사용자 입력 보존). 확정 아닌 편집 초안.
      if (mapped.memo !== undefined) setMemoDraft(mapped.memo);
      if (mapped.amount !== undefined) setAmountDraft(String(mapped.amount));
      if (mapped.category !== undefined) setCategoryDraft(mapped.category);
      // 성공 — 100% 스냅 후 ~250ms 유지하고 종료(완료 신호). 램프 천장 90<100 이라 그동안 100 유지.
      setCaptureProgress(100);
      captureHoldRef.current = setTimeout(() => {
        captureHoldRef.current = null;
        setCaptureStage(null);
        setCaptureProgress(0);
      }, 250);
    } catch {
      // OCR 실패·분류 503(한도초과·타임아웃)·네트워크 등 — 직접 입력 폴백(흐름 유지). 원문·에러 미로그(ADR-005).
      clearCapture();
      Alert.alert("지금은 캡처로 채울 수 없어요", "직접 입력해 주세요.");
    }
  }, [capturing, clearCapture]);

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
            {/* 제목 + 닫기(✕) 헤더 + 구분선(ADR-040 ①②). ✕ = 취소와 동일하게 모달 닫기(바깥 탭의 Keyboard.dismiss 와 구분 — ADR-034). */}
            <ModalHeader title="택배 정보" onClose={() => setInfoModal(false)} />
            {/* 캡처로 채우기 — 직접 입력의 보조(ADR-039). 주문 상세 스크린샷 → OCR·마스킹·분류 → 아래 필드 자동 채움(편집 가능). */}
            <Pressable
              onPress={() => void onCaptureFill()}
              disabled={capturing}
              style={[styles.captureBtn, { borderColor: tokens.accent, opacity: capturing ? 0.6 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="캡처로 채우기"
              accessibilityState={{ disabled: capturing, busy: capturing }}
            >
              {/* 진행 표시는 카드 오버레이가 담당(ADR-045) — 버튼은 분석 중 비활성·흐림만. */}
              <Camera size={18} color={tokens.accent} />
              <Text style={[styles.captureLabel, { color: tokens.accent }]}>캡처로 채우기</Text>
            </Pressable>
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
                maxLength={MEMO_MAX_LENGTH}
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
                disabled={amountInvalid}
                accessibilityRole="button"
                accessibilityState={{ disabled: amountInvalid }}
                style={[
                  styles.modalSaveBtn,
                  { backgroundColor: amountInvalid ? tokens.bg.secondary : tokens.accent },
                ]}
              >
                <Text
                  style={[
                    styles.modalSave,
                    { color: amountInvalid ? tokens.text.disabled : tokens.onAccent },
                  ]}
                >
                  저장
                </Text>
              </Pressable>
            </View>
            {/* 캡처 분석 진행 오버레이(ADR-045) — captureStage(OCR/분류)일 때만 카드를 덮어 단계 스피너 표시.
                분석 중 필드 오터치 차단. 폴백 Alert 은 네이티브라 이 위에 뜸(가림 없음). 단계는 두 경계로만. */}
            {capturing ? (
              <View style={styles.captureOverlay}>
                <View style={[styles.captureOverlayBg, { backgroundColor: tokens.bg.surface }]} />
                <ActivityIndicator size="large" color={tokens.accent} />
                {/* 추정 진행률 큰 숫자(ADR-045 개정) — 완료 전엔 천장(45/90)에 점근, 성공 시에만 100%. 추정치. */}
                <Text style={[styles.capturePercent, { color: tokens.accent }]}>{captureProgress}%</Text>
                <Text style={[styles.captureStageText, { color: tokens.text.body }]}>
                  {captureStage === "ocr" ? "이미지 인식 중…" : "상품 분석 중…"}
                </Text>
              </View>
            ) : null}
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
            {/* 제목 + 닫기(✕) 헤더 + 구분선(ADR-040 ①②). ✕ = 취소와 동일하게 모달 닫기(ADR-034 바깥 탭과 구분). */}
            <ModalHeader title="운송장 수정" onClose={() => setEditModal(false)} />
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
                disabled={editDisabled}
                accessibilityRole="button"
                accessibilityState={{ disabled: editDisabled }}
                style={[
                  styles.modalSaveBtn,
                  { backgroundColor: editDisabled ? tokens.bg.secondary : tokens.accent },
                ]}
              >
                <Text
                  style={[
                    styles.modalSave,
                    { color: editDisabled ? tokens.text.disabled : tokens.onAccent },
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

/** 입력 모달 공통 헤더 — 제목 + 닫기(✕) + 구분선(ADR-040 ①②). 두 모달이 modalCard 를 공유하므로 헤더도 공유. */
function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const { tokens } = useTheme();
  return (
    <>
      <View style={styles.modalHeader}>
        <Text style={[styles.modalTitle, { color: tokens.text.primary }]}>{title}</Text>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="닫기">
          <Close size={22} color={tokens.text.secondary} />
        </Pressable>
      </View>
      <View style={[styles.modalDivider, { borderBottomColor: tokens.border }]} />
    </>
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
  // 헤더 행(제목 좌·닫기 우) + 그 아래 얇은 구분선(ADR-040 ①②). 색은 인라인 토큰 주입.
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalDivider: { borderBottomWidth: 1 },
  modalTitle: { fontSize: fontSize.title3, fontWeight: fontWeight.semibold },
  // 캡처로 채우기 버튼 — accent 보더의 보조 액션(채움 아님·outline). 직접 입력과 병행이라 강조 과하지 않게.
  captureBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 10,
  },
  captureLabel: { fontSize: fontSize.callout, fontWeight: fontWeight.semibold },
  // 캡처 분석 진행 오버레이(ADR-045) — 카드 전체(absolute)를 덮어 단계 스피너 표시 + 필드 오터치 차단(터치 흡수).
  captureOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: spacing.md },
  // 반투명 표면색 베이스(별도 레이어 — opacity 가 스피너/텍스트엔 안 걸리게). 카드 라운드에 맞춤.
  captureOverlayBg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.lg, opacity: 0.92 },
  // 추정 진행률 큰 숫자(ADR-045 개정) — accent 색, 단계 텍스트 위. % 는 추정치(완료 전 100% 금지).
  capturePercent: { fontSize: fontSize.display2, fontWeight: fontWeight.bold },
  captureStageText: { fontSize: fontSize.callout, fontWeight: fontWeight.medium },
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
  modalActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: spacing.lg },
  modalCancel: { fontSize: fontSize.callout },
  // 채움형 1차 액션(저장) — accent 배경, onAccent 라벨(ADR-040 ③). 비활성 색은 호출부에서 분기.
  modalSaveBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md },
  modalSave: { fontSize: fontSize.callout, fontWeight: fontWeight.semibold },
  retry: { gap: spacing.sm, alignItems: "flex-start" },
  retryLabel: { fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  deleteBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, alignItems: "center" },
  deleteLabel: { fontSize: fontSize.callout, fontWeight: fontWeight.semibold },
});
