/**
 * 등록 화면 — 번호 입력 → 택배사 자동추정/확인 → 등록(POST /shipments). 멱등(이미 등록=200)도 자연 처리.
 * 클립보드는 **화면 진입(명시 시점)에만** 읽어 **제안만** 한다(자동 등록 금지 — iOS 배너 정책, PRD 권한).
 * 미지원 택배사(409)는 친근한 안내 + 택배사 조회 딥링크 폴백. 등록 실패 시 입력값을 보존한다(재시도).
 * 서버 code/기술 메시지는 화면에 노출하지 않는다(PRD 톤). 색은 토큰만(색 단독 표시 금지).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { ApiError, createShipment } from "../src/lib/api";
import { ensureDeviceRegistered } from "../src/lib/bootstrap";
import { apiDeps } from "../src/lib/deps";
import { pushDeps } from "../src/lib/push";
import { autoPickCarrier, carrierName, estimateCarriers } from "../src/lib/carrier";
import { isValidTrackingNumber, normalizeTrackingNumber } from "../src/lib/tracking";
import { useTheme } from "../src/theme/ThemeProvider";
import { fontSize, fontWeight, radius, spacing } from "../src/theme/layout";
import { Close } from "../src/components/icons";
import { CarrierSelect } from "../src/components/CarrierSelect";
import { ScreenHeader } from "../src/components/ScreenHeader";

/** 푸시 priming 안내를 이미 했는지 — 첫 등록 직후 1회만 온보딩으로 유도(반복 유도 금지). */
const PRIMED_KEY = "unboxing.push_primed";

/** 푸시 미허용 + 아직 안내 안 했으면 true(첫 등록 직후 온보딩 priming 대상). 실패 시 false. */
async function shouldPrimePush(): Promise<boolean> {
  try {
    if (await AsyncStorage.getItem(PRIMED_KEY)) return false;
    const perm = await pushDeps.getPermissions();
    return !perm.granted;
  } catch {
    return false;
  }
}

/** 등록 실패를 친근한 카피로 매핑(코드 비노출). unsupported 만 딥링크 폴백을 띄운다. */
type RegError = "unsupported" | "rate" | "invalid" | "generic";

const ERROR_COPY: Record<Exclude<RegError, "unsupported">, string> = {
  rate: "잠시 후 다시 시도해 주세요",
  invalid: "운송장 번호를 다시 확인해 주세요",
  generic: "등록하지 못했어요. 잠시 후 다시 시도해 주세요",
};

export default function RegisterScreen() {
  const { tokens } = useTheme();
  const [input, setInput] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<RegError | null>(null);
  const [clip, setClip] = useState<string | null>(null);

  const candidates = useMemo(() => estimateCarriers(input), [input]);
  const valid = isValidTrackingNumber(input);
  // 사용자가 직접 고른 값이 우선, 없으면 autoPickCarrier(후보 1개일 때만 자동 채움·≥2 면 미선택, ADR-026).
  const selectedId = picked ?? autoPickCarrier(candidates);
  // 번호가 유효한데 자동선택이 안 됨(후보 ≥2 라 미선택) = 모호 → 드롭다운을 펼쳐 명시 선택을 유도(UI_GUIDE).
  const ambiguous = valid && selectedId === null;

  // 화면 진입 시 1회만 클립보드를 읽어 운송장-형태면 **제안**한다(자동 등록 ❌).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const text = await Clipboard.getStringAsync();
        if (active && isValidTrackingNumber(text)) setClip(normalizeTrackingNumber(text));
      } catch {
        // 클립보드 접근 실패는 조용히 무시(제안은 부가 기능).
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // 모호 상태로 **진입하는 순간 1회만** 드롭다운을 펼친다(상승 엣지). 사용자가 직접 접으면
  // ambiguous 가 유지돼도 다시 강제로 펼치지 않는다(무한 펼침 금지) — prevAmbiguous 로 게이트.
  const prevAmbiguous = useRef(false);
  useEffect(() => {
    if (ambiguous && !prevAmbiguous.current) setShowList(true);
    prevAmbiguous.current = ambiguous;
  }, [ambiguous]);

  const onChangeInput = (text: string) => {
    setInput(text);
    setError(null);
  };

  const acceptClip = () => {
    if (clip) onChangeInput(clip);
    setClip(null);
  };

  const choose = (id: string) => {
    setPicked(id);
    setShowList(false);
    setError(null);
  };

  const submit = async () => {
    if (!valid || !selectedId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // 송장 등록 전 device 가 서버에 등록돼 있음을 보장(푸시 거부 사용자도 통과 — QA-001 데드락 방지).
      await ensureDeviceRegistered();
      await createShipment(selectedId, normalizeTrackingNumber(input), apiDeps);
      // 첫 등록 직후(가치 시점)에 푸시 미허용이면 온보딩(priming)으로 유도한다 — PRD 권한 온보딩.
      // 이걸 안 하면 신규 사용자는 권한 팝업을 못 봐 '앱이 꺼져 있어도 푸시'가 동작하지 않는다. priming은 1회만.
      if (await shouldPrimePush()) {
        await AsyncStorage.setItem(PRIMED_KEY, "1");
        router.replace("/onboarding"); // 온보딩이 끝나면 목록으로 돌아간다.
      } else if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/");
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setError("unsupported");
      else if (e instanceof ApiError && e.status === 429) setError("rate");
      else if (e instanceof ApiError && e.status === 422) setError("invalid");
      else setError("generic"); // NETWORK·401·5xx 등 — 입력값 보존
    } finally {
      setSubmitting(false);
    }
  };

  // 미지원 택배사: 택배사 조회 페이지(공개 검색)로 직접 조회 폴백.
  const openCarrierLookup = () => {
    const q = `${selectedId ? carrierName(selectedId) : ""} 택배조회 ${normalizeTrackingNumber(input)}`.trim();
    void Linking.openURL(`https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.bg.page }]} edges={["bottom"]}>
      <ScreenHeader
        title="운송장 번호 등록"
        description="운송장 번호를 입력하면 택배사가 자동으로 채워져요. 자동으로 채워지지 않으면 아래에서 직접 택배사를 선택해 주세요."
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.label, { color: tokens.text.secondary }]}>운송장 번호</Text>
        <TextInput
          value={input}
          onChangeText={onChangeInput}
          placeholder="번호를 입력하세요"
          placeholderTextColor={tokens.text.disabled}
          keyboardType="number-pad"
          autoFocus
          style={[
            styles.field,
            { backgroundColor: tokens.bg.secondary, borderColor: tokens.border, color: tokens.text.primary },
          ]}
          accessibilityLabel="운송장 번호 입력"
        />

        {/* 클립보드 제안 — 입력창 **하단**에 둔다(사용자 요구). 제안만, 자동 등록 ❌. */}
        {clip && (
          <Pressable
            onPress={acceptClip}
            style={[styles.clip, { backgroundColor: tokens.bg.secondary, borderColor: tokens.border }]}
            accessibilityRole="button"
            accessibilityLabel={`클립보드의 번호 ${clip} 넣기`}
          >
            <Text style={{ color: tokens.text.body }}>
              클립보드의 번호 넣기 · {clip}
            </Text>
            <Pressable onPress={() => setClip(null)} hitSlop={8} accessibilityLabel="제안 닫기">
              <Close size={16} color={tokens.text.secondary} />
            </Pressable>
          </Pressable>
        )}

        <Text style={[styles.label, { color: tokens.text.secondary }]}>택배사</Text>
        <CarrierSelect
          candidates={candidates}
          value={selectedId}
          onChange={choose}
          open={showList}
          onToggleOpen={() => setShowList((v) => !v)}
        />

        {error === "unsupported" ? (
          <View style={[styles.notice, { backgroundColor: tokens.bg.secondary }]}>
            <Text style={{ color: tokens.text.body }}>
              자동 추적을 지원하지 않는 택배사예요. 택배사에서 직접 조회할 수 있어요.
            </Text>
            <Pressable onPress={openCarrierLookup} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.link, { color: tokens.accent }]}>
                택배사에서 직접 조회
              </Text>
            </Pressable>
          </View>
        ) : error ? (
          <Text style={[styles.inlineError, { color: tokens.stage.exception }]}>
            {ERROR_COPY[error]}
          </Text>
        ) : null}

        <Pressable
          onPress={submit}
          disabled={!valid || !selectedId || submitting}
          style={[
            styles.submit,
            {
              backgroundColor: tokens.accent,
              opacity: !valid || !selectedId || submitting ? 0.4 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="등록"
        >
          {submitting ? (
            <ActivityIndicator color={tokens.onAccent} />
          ) : (
            <Text style={[styles.submitLabel, { color: tokens.onAccent }]}>등록</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.sm },
  clip: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  label: { fontSize: fontSize.footnote, marginTop: spacing.sm },
  field: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.base,
  },
  notice: { borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, marginTop: spacing.xs },
  link: { fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  inlineError: { fontSize: fontSize.body, marginTop: spacing.xs },
  submit: { borderRadius: radius.md, paddingVertical: 14, alignItems: "center", marginTop: spacing.lg },
  submitLabel: { fontSize: fontSize.callout, fontWeight: fontWeight.semibold },
});
