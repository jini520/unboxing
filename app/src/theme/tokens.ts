/**
 * 시맨틱 컬러 토큰 — docs/UI_GUIDE.md "테마 & 색상" 단일 출처.
 * hex 값은 **이 파일에만** 둔다(컴포넌트는 토큰명만 참조). 라이트 기준·다크 동등 지원(ADR-016).
 * 값은 **애플 iOS 시스템 컬러 팔레트**에 매핑(systemBlue/Green/Red·systemGray*·systemBackground·label 등 — 사용자 요구).
 * 각 값 옆 주석은 대응하는 Apple 시스템 컬러명. 다크는 Apple 다크 변형값.
 */

export type Scheme = "light" | "dark";
export type ThemePreference = "system" | Scheme;

export interface ColorTokens {
  bg: {
    /** 페이지 배경 */
    page: string;
    /** 카드 표면 */
    surface: string;
    /** 보조 배경(입력 필드 등) */
    secondary: string;
  };
  /** 보더 */
  border: string;
  /** 대표(브랜드) 색 — 상호작용 요소(기본 버튼·CTA·활성 탭·선택 상태·링크). 단계 색과 분리한다(의미 디커플링). */
  accent: string;
  /** accent 위에 얹는 전경(채워진 버튼 라벨·선택 체크 글리프) — 두 스킴 모두 흰색(blue 위 대비 확보). */
  onAccent: string;
  text: {
    primary: string;
    body: string;
    secondary: string;
    disabled: string;
  };
  /** 표준 7단계 시맨틱 색 (ARCHITECTURE 상태 정규화와 1:1) */
  stage: {
    /** 배송완료(성공) */
    delivered: string;
    /** 배송출발(임박) */
    outForDelivery: string;
    /** 이동중(진행 강조) — 노란색 계열 */
    inTransit: string;
    /** 예외(에러) */
    exception: string;
    /** 등록·집화·기타(중립) */
    neutral: string;
    /** 미등록(비활성) */
    unregistered: string;
  };
}

const light: ColorTokens = {
  bg: {
    page: "#ffffff", // systemBackground
    surface: "#ffffff", // secondarySystemGroupedBackground (페이지와 동색 — 카드는 border 로 구분)
    secondary: "#f2f2f7", // systemGray6
  },
  border: "#e5e5ea", // systemGray5 (얇은 구분선/보더)
  // 애플 systemBlue(light) — 정통 하늘색 색조라 보라끼 도는 진블루보다 덜 쨍하고 iOS 네이티브 느낌(사용자 요구).
  accent: "#007aff", // systemBlue
  onAccent: "#ffffff",
  text: {
    primary: "#000000", // label
    body: "#3c3c43", // secondaryLabel(base RGB, 본문은 불투명 사용)
    secondary: "#8e8e93", // systemGray
    disabled: "#c7c7cc", // systemGray3
  },
  stage: {
    delivered: "#34c759", // systemGreen
    outForDelivery: "#007aff", // systemBlue
    // 이동중 — 노란색 계열. 애플 systemYellow(#ffcc00)는 흰 카드 위에서 대비 ≈1.5:1 로 라벨이 거의 안 보여,
    // 라이트는 톤을 내린 골드(≈2.2:1, 다른 배지 색과 비슷한 가독성)로 둔다. 다크는 systemYellow 정값이 잘 보임.
    inTransit: "#e0a500", // systemYellow(deepened for light contrast)
    exception: "#ff3b30", // systemRed
    neutral: "#8e8e93", // systemGray
    unregistered: "#aeaeb2", // systemGray2
  },
};

const dark: ColorTokens = {
  bg: {
    page: "#000000", // systemBackground (OLED true black)
    surface: "#1c1c1e", // secondarySystemGroupedBackground (페이지 위 카드)
    secondary: "#2c2c2e", // tertiarySystemGroupedBackground (카드보다 한 톤 위)
  },
  border: "#38383a", // opaqueSeparator
  // 애플 systemBlue(dark) — 어두운 배경에서 한 톤 밝은 변형(iOS 다크 시스템 컬러).
  accent: "#0a84ff", // systemBlue (dark)
  onAccent: "#ffffff",
  text: {
    primary: "#ffffff", // label
    body: "#ebebf5", // secondaryLabel(base RGB)
    secondary: "#8e8e93", // systemGray
    disabled: "#48484a", // systemGray3 (dark)
  },
  stage: {
    delivered: "#30d158", // systemGreen (dark)
    outForDelivery: "#0a84ff", // systemBlue (dark)
    inTransit: "#ffd60a", // systemYellow (dark) — 어두운 배경에선 정값이 잘 보임
    exception: "#ff453a", // systemRed (dark)
    neutral: "#8e8e93", // systemGray
    unregistered: "#636366", // systemGray2 (dark)
  },
};

export const tokens: Record<Scheme, ColorTokens> = { light, dark };

/**
 * 선호(preference)와 시스템 외형(systemScheme)을 합쳐 활성 토큰 세트를 결정한다.
 * - `'system'`이면 시스템 외형을 따르되, 미확정(null)이면 라이트 기준(ADR-016).
 * - `'light'`/`'dark'`는 시스템과 무관하게 고정.
 */
export function resolveTokens(
  preference: ThemePreference,
  systemScheme: Scheme | null | undefined,
): ColorTokens {
  const scheme: Scheme =
    preference === "system" ? systemScheme ?? "light" : preference;
  return tokens[scheme];
}
