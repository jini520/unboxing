/**
 * 시맨틱 컬러 토큰 — docs/UI_GUIDE.md "테마 & 색상" 단일 출처.
 * hex 값은 **이 파일에만** 둔다(컴포넌트는 토큰명만 참조). 라이트 기준·다크 동등 지원(ADR-016).
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
    /** 예외(에러) */
    exception: string;
    /** 등록·집화·이동중·기타(중립) */
    neutral: string;
    /** 미등록(비활성) */
    unregistered: string;
  };
}

const light: ColorTokens = {
  bg: {
    page: "#ffffff",
    surface: "#ffffff",
    secondary: "#f5f5f5",
  },
  border: "#e5e5e5",
  text: {
    primary: "#18181b",
    body: "#3f3f46",
    secondary: "#6b7280",
    disabled: "#9ca3af",
  },
  stage: {
    delivered: "#16a34a",
    outForDelivery: "#2563eb",
    exception: "#dc2626",
    neutral: "#6b7280",
    unregistered: "#9ca3af",
  },
};

const dark: ColorTokens = {
  bg: {
    page: "#0a0a0a",
    surface: "#141414",
    secondary: "#1c1c1c",
  },
  border: "#262626",
  text: {
    primary: "#ffffff",
    body: "#d4d4d4",
    secondary: "#a3a3a3",
    disabled: "#737373",
  },
  stage: {
    delivered: "#22c55e",
    outForDelivery: "#3b82f6",
    exception: "#ef4444",
    neutral: "#a3a3a3",
    unregistered: "#737373",
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
