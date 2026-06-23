/**
 * 택배사 선택(공유·controlled) — 등록 화면과 상세 "수정" 모달이 **같은 컴포넌트·정책**을 재사용한다(ADR-026).
 * 정책(autoPickCarrier)은 **호출부(화면)** 가 적용해 `value` 로 넘긴다 — 이 컴포넌트는 표시·선택만(presentational).
 * 추정 후보(추천) 먼저, 나머지 CARRIERS 순. 선택 행은 accent + Check 글리프(색 단독 금지 — UI_GUIDE 회귀 락).
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CARRIERS, carrierName, type CarrierCandidate } from "../lib/carrier";
import { useTheme } from "../theme/ThemeProvider";
import { fontSize, radius, spacing } from "../theme/layout";
import { ChevronDown, Check } from "./icons";

export function CarrierSelect({
  candidates,
  value,
  onChange,
  open,
  onToggleOpen,
}: {
  /** 추정 후보 — 호출부가 estimateCarriers(번호)로 만들어 전달(추천 표기·정렬 기준). */
  candidates: CarrierCandidate[];
  /** 현재 선택된 carrierId(= picked ?? autoPickCarrier(candidates), 호출부가 계산). null 이면 미선택. */
  value: string | null;
  /** 사용자가 행을 고르면 호출(호출부가 picked 갱신). */
  onChange: (id: string) => void;
  /** 드롭다운 펼침 여부(controlled). */
  open: boolean;
  /** selector 탭으로 펼침/접힘 토글. */
  onToggleOpen: () => void;
}) {
  const { tokens } = useTheme();
  const recIds = new Set(candidates.map((c) => c.id));
  // 추천(추정 후보) 먼저, 나머지 택배사 순. 행은 중첩 컴포넌트 없이 직접 매핑한다 —
  // render 안에서 컴포넌트를 정의하면 매 렌더 새 타입이 돼 모든 행이 remount 된다.
  const rows = [
    ...candidates.map((c) => ({ c, recommended: true })),
    ...CARRIERS.filter((c) => !recIds.has(c.id)).map((c) => ({ c, recommended: false })),
  ];
  const selectedName = value ? carrierName(value) : null;

  return (
    <View>
      <Pressable
        onPress={onToggleOpen}
        style={[styles.field, styles.selector, { backgroundColor: tokens.bg.secondary, borderColor: tokens.border }]}
        accessibilityRole="button"
        accessibilityLabel={selectedName ? `택배사 ${selectedName}, 변경하려면 누르세요` : "택배사 선택"}
      >
        <Text style={{ color: selectedName ? tokens.text.primary : tokens.text.disabled }}>
          {selectedName ?? "택배사를 선택하세요"}
        </Text>
        <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
          <ChevronDown size={18} color={tokens.text.secondary} />
        </View>
      </Pressable>

      {open && (
        <View style={[styles.listBox, { borderColor: tokens.border }]}>
          {rows.map(({ c, recommended }) => {
            const isSel = c.id === value;
            return (
              <Pressable
                key={c.id}
                onPress={() => onChange(c.id)}
                style={[styles.row, { borderColor: tokens.border }]}
                accessibilityRole="button"
                accessibilityState={{ selected: isSel }}
              >
                <Text style={{ color: isSel ? tokens.accent : tokens.text.body }}>
                  {c.name}
                  {recommended ? "  · 추천" : ""}
                </Text>
                {isSel && <Check size={16} color={tokens.accent} />}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.base,
  },
  selector: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  listBox: { borderWidth: 1, borderRadius: radius.md, overflow: "hidden", marginTop: spacing.sm },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
