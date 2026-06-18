/**
 * 개인정보처리방침 인앱 화면 — 번들된 방침(app/src/content/privacyPolicy.ts)을 Text 로 렌더.
 * - 오프라인에서도 항상 열린다(번들 내용). "웹에서 보기"만 네트워크 필요(실패 시 조용히).
 * - 스토어 메타데이터용 공개 URL(PRIVACY_POLICY_URL)은 하단 "웹에서 보기" 링크로 병행 제공.
 * - 마크다운 라이브러리 미사용(과의존 금지). 색은 토큰만, 긴 본문은 ScrollView 로 스크롤.
 * 헤더는 루트 Stack 규칙(title 없음 + 아이콘 뒤로가기) — 여기서 title 을 두지 않는다.
 */
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PRIVACY_POLICY_URL } from "../src/config";
import { PRIVACY_POLICY } from "../src/content/privacyPolicy";
import { ScreenHeader } from "../src/components/ScreenHeader";
import { useTheme } from "../src/theme/ThemeProvider";

export default function PrivacyScreen() {
  const { tokens } = useTheme();

  // 웹 버전 열기 — 실패(미호스팅·링크 깨짐·오프라인)는 조용히 무시(인앱 본문이 이미 전체 내용).
  const openWeb = () => {
    Linking.openURL(PRIVACY_POLICY_URL).catch(() => {});
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.bg.page }]} edges={["bottom"]}>
      <ScreenHeader />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: tokens.text.primary }]}>{PRIVACY_POLICY.title}</Text>
        <Text style={[styles.meta, { color: tokens.text.secondary }]}>
          시행일 {PRIVACY_POLICY.effectiveDate} · 최종 수정일 {PRIVACY_POLICY.lastUpdated}
        </Text>

        <Text style={[styles.intro, { color: tokens.text.body }]}>{PRIVACY_POLICY.intro}</Text>

        {PRIVACY_POLICY.sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={[styles.heading, { color: tokens.text.primary }]}>{section.heading}</Text>
            {section.body.map((para, i) => (
              <Text key={i} style={[styles.para, { color: tokens.text.body }]}>
                {para}
              </Text>
            ))}
          </View>
        ))}

        <Pressable
          onPress={openWeb}
          style={styles.webLink}
          accessibilityRole="link"
          accessibilityLabel="개인정보처리방침 웹에서 보기"
        >
          <Text style={[styles.webLinkText, { color: tokens.stage.outForDelivery }]}>웹에서 보기</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  title: { fontSize: 24, fontWeight: "600", marginBottom: 4 },
  meta: { fontSize: 13, marginBottom: 16 },
  intro: { fontSize: 15, lineHeight: 23, marginBottom: 8 },
  section: { marginTop: 20 },
  heading: { fontSize: 17, fontWeight: "600", marginBottom: 8 },
  para: { fontSize: 15, lineHeight: 23, marginBottom: 6 },
  webLink: { marginTop: 28, paddingVertical: 8 },
  webLinkText: { fontSize: 15, fontWeight: "600" },
});
