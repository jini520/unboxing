/**
 * 디자인 프리미티브 — 스킴(light/dark) **무관** 공통 수치(간격·라운드·타이포).
 * 색은 tokens.ts(스킴별, useTheme로 주입), 여기엔 런타임에 변하지 않는 값만 둔다 → 컨텍스트 없이 직접 import.
 * 컴포넌트는 StyleSheet 안의 리터럴 대신 이 토큰을 참조한다(공통 값 단일 출처). docs/UI_GUIDE.md "레이아웃/타이포" 와 1:1.
 * 비표준 1회성 값(원형 점 반지름=width/2, 스와이프 버튼 폭, 아이콘 size 등)은 토큰화하지 않고 컴포넌트 로컬로 둔다.
 */
import type { TextStyle } from "react-native";

/** 간격(padding·margin·gap) — 4단위 리듬. 스케일에 없는 값은 의도된 1회성이라 로컬 리터럴로 둔다. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** 모서리 라운드 — 체크박스(sm) · 카드/버튼/입력(md) · 모달(lg). 원형(width/2)은 라운드 토큰 아님. */
export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
} as const;

/** 타입 램프 — 기존 사용값과 1:1(시각 회귀 0). */
export const fontSize = {
  micro: 11, // 스텝 라벨
  caption: 12, // 카드 보조·시간·캡션
  footnote: 13, // 라벨·섹션·페이지 설명
  body: 14, // 본문·타임라인
  callout: 15, // 버튼 라벨·메모·강조 본문
  base: 16, // 행 제목·입력·온보딩 본문
  title3: 17, // 멀티선택 카운트·방침 소제목
  title2: 19, // 상세 현재 상태 문구
  title1: 22, // ScreenHeader title
  display3: 24, // 방침 제목
  display2: 28, // 온보딩 제목
  display1: 30, // 페이지 제목(택배함·설정)
} as const;

/** 폰트 굵기 — RN TextStyle 호환 문자열. */
export const fontWeight = {
  medium: "500",
  semibold: "600",
  bold: "700",
} as const satisfies Record<string, TextStyle["fontWeight"]>;
