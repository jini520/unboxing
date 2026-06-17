/**
 * SVG 라인 아이콘 세트 — OS 이모지/유니코드 글리프 전면 금지(전부 SVG, 사용자 요구).
 * react-native-svg(15.x, Expo SDK 56) 의 Svg/Path/Circle 로 단색 라인 아이콘 구현.
 * - 색은 `color` prop 으로 토큰을 주입받는다(hex 하드코딩 금지 — UI_GUIDE).
 * - strokeWidth 1.5(라인), 둥근 배경 박스로 감싸지 않음(UI_GUIDE "아이콘").
 * - 형태는 Feather(MIT) 라인 아이콘 path 를 따른다. viewBox 24, stroke 는 root 에서 상속.
 * - 아이콘은 의미 중복을 막으려 부모(Pressable/배지)가 a11y 라벨을 제공하고,
 *   아이콘 자체는 accessibilityElementsHidden / importantForAccessibility 로 숨긴다.
 */
import Svg, { Circle, Path, Rect, type SvgProps } from "react-native-svg";

export type IconProps = {
  /** 정사각 크기(px). 기본 20. */
  size?: number;
  /** 선/채움 색 — 토큰 색을 주입(하드코딩 금지). */
  color: string;
  /** 선 굵기. 기본 1.5(UI_GUIDE 라인 아이콘). */
  strokeWidth?: number;
} & Pick<SvgProps, "accessibilityElementsHidden" | "importantForAccessibility">;

/** 모든 stroke 기반 아이콘이 공유하는 root 속성(자식 Path 가 stroke 상속). */
function rootProps(size: number, color: string, strokeWidth: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: color,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

// ── 네비/액션 ──────────────────────────────────────────────

/** 뒤로가기(<). */
export function ChevronLeft({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M15 18l-6-6 6-6" />
    </Svg>
  );
}

/** 더보기/진입(>). */
export function ChevronRight({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M9 18l6-6-6-6" />
    </Svg>
  );
}

/** 드롭다운 펼침(∨). 접힘 표시는 호출부에서 180° 회전. */
export function ChevronDown({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

/** 닫기/제거(×). */
export function Close({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M18 6L6 18" />
      <Path d="M6 6l12 12" />
    </Svg>
  );
}

/** 운송장 추가(+). */
export function Plus({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M12 5v14" />
      <Path d="M5 12h14" />
    </Svg>
  );
}

/** 삭제(쓰레기통). */
export function Trash({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M3 6h18" />
      <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <Path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <Path d="M10 11v6" />
      <Path d="M14 11v6" />
    </Svg>
  );
}

/** 알림 켜짐(종). */
export function Bell({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <Path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </Svg>
  );
}

/** 알림 음소거(종+빗금). */
export function BellOff({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <Path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
      <Path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
      <Path d="M18 8a6 6 0 0 0-9.33-5" />
      <Path d="M1 1l22 22" />
    </Svg>
  );
}

/** 설정(톱니바퀴). */
export function Gear({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Svg>
  );
}

/** 선택 체크(✓ 단독) — 멀티선택 체크박스용. */
export function Check({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M20 6L9 17l-5-5" />
    </Svg>
  );
}

/** 택배함(닫힌 상자) — 탭 비활성. */
export function Package({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M16.5 9.4l-9-5.19" />
      <Path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <Path d="M3.27 6.96L12 12.01l8.73-5.05" />
      <Path d="M12 22.08V12" />
    </Svg>
  );
}

/** 택배함(열린 상자 — 몸통 + 위로 펼쳐진 좌·우 뚜껑) — 탭 활성. */
export function PackageOpen({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M4 11v6l8 4 8-4v-6" />
      <Path d="M4 11l8 3 8-3" />
      <Path d="M12 14v7" />
      <Path d="M4 11l4-5 4 2" />
      <Path d="M20 11l-4-5-4 2" />
    </Svg>
  );
}

/** 메모 편집(연필). */
export function Pencil({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
      <Path d="M15 5l4 4" />
    </Svg>
  );
}

// ── 단계 글리프(StageBadge·상세 인디케이터 공용) ────────────

/** 미등록(시계). */
export function Clock({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7v5l3 2" />
    </Svg>
  );
}

/** 중립 단계(등록·집화·이동중·기타) — 채워진 작은 점. */
export function DotSmall({ size = 20, color, ...a11y }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...a11y}>
      <Circle cx="12" cy="12" r="4" fill={color} />
    </Svg>
  );
}

/** 배송출발(트럭). */
export function Truck({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M1 3h15v13H1z" />
      <Path d="M16 8h4l3 3v5h-7z" />
      <Circle cx="5.5" cy="18.5" r="2.5" />
      <Circle cx="18.5" cy="18.5" r="2.5" />
    </Svg>
  );
}

/** 배송완료(체크 원). */
export function CheckCircle({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <Path d="M22 4L12 14.01l-3-3" />
    </Svg>
  );
}

/** 예외(경고 삼각형). */
export function AlertTriangle({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <Path d="M12 9v4" />
      <Path d="M12 17h.01" />
    </Svg>
  );
}

/** 등록/접수(클립보드 + 체크). */
export function ClipboardCheck({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <Rect x="8" y="2" width="8" height="4" rx="1" />
      <Path d="M9 14l2 2 4-4" />
    </Svg>
  );
}

/** 배송출발/동네 도착(지도 핀). */
export function MapPin({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <Circle cx="12" cy="10" r="3" />
    </Svg>
  );
}
