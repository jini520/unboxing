/**
 * 테마 컨텍스트 — 선호(system/light/dark)를 AsyncStorage에 영속하고
 * 시스템 외형과 결합해 활성 토큰을 제공한다(ADR-016). 순수 결정 로직은 tokens.ts:resolveTokens.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  resolveScheme,
  resolveTokens,
  type ColorTokens,
  type Scheme,
  type ThemePreference,
} from "./tokens";

const STORAGE_KEY = "theme.preference";

interface ThemeContextValue {
  /** 활성 컬러 토큰 세트 */
  tokens: ColorTokens;
  /** 활성 스킴(light/dark) — 스킴 의존 스타일(예: 라이트 전용 그림자) 분기용 */
  scheme: Scheme;
  /** 현재 사용자 선호 */
  preference: ThemePreference;
  /** 선호 변경(설정 화면에서 사용) → AsyncStorage 영속 */
  setPreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  // 저장된 선호 복원(최초 1회).
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (active && (stored === "system" || stored === "light" || stored === "dark")) {
        setPreferenceState(stored);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const setPreference = (pref: ThemePreference) => {
    setPreferenceState(pref);
    void AsyncStorage.setItem(STORAGE_KEY, pref);
  };

  // useColorScheme()은 'light' | 'dark' | 'unspecified' | null 을 반환 → Scheme | null 로 정규화.
  const normalizedScheme: Scheme | null =
    systemScheme === "dark" ? "dark" : systemScheme === "light" ? "light" : null;

  const value = useMemo<ThemeContextValue>(
    () => ({
      tokens: resolveTokens(preference, normalizedScheme),
      scheme: resolveScheme(preference, normalizedScheme),
      preference,
      setPreference,
    }),
    [preference, normalizedScheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** 활성 토큰 + 선호 + setPreference 반환. ThemeProvider 하위에서만 사용. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
