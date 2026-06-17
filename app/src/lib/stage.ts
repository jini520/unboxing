/**
 * 단계 메타(순수 로직) — 진행 인디케이터 위치 매핑(stageProgress)과 친근한 한 줄 요약(STAGE_SUMMARY).
 * RN/SVG 의존 없음(테스트 대상). 색·아이콘은 컴포넌트(StageBadge/StageProgress)가 토큰으로 입힌다.
 * happy-path 5단계(등록→집화→이동중→배송출발→배송완료)는 ARCHITECTURE 표준 단계와 1:1.
 */
import type { Stage } from "./api";

/** happy-path 진행 5단계(등록=0 … 배송완료=4). off-track(미등록·예외·기타)은 여기 없다. */
export const STAGE_PROGRESS_STEPS = ["등록", "집화", "이동중", "배송출발", "배송완료"] as const;

type ProgressStage = (typeof STAGE_PROGRESS_STEPS)[number];

/**
 * 단계 → 진행 인디케이터 위치.
 * - `normal`: index 0~4(해당 단계). 지난 단계=채움·현재=강조·이후=빈 점.
 * - `pre`(미등록·기타): index -1, 진행 없음(채움 0·바 비강조) — 기타는 진행을 추정하지 않는다.
 * - `exception`(예외): index -1, 어느 스텝에서 멈췄는지 알 수 없어 선형 매핑 금지 — 예외 표시 전용.
 */
export function stageProgress(
  stage: Stage,
): { index: number; track: "normal" | "exception" | "pre" } {
  if (stage === "예외") return { index: -1, track: "exception" };
  if (stage === "미등록" || stage === "기타") return { index: -1, track: "pre" };
  // 남은 단계는 모두 happy-path 5단계 → indexOf 0~4(절대 -1 아님).
  return { index: STAGE_PROGRESS_STEPS.indexOf(stage as ProgressStage), track: "normal" };
}

/**
 * 상세 상단 "현재 상태" 문구 — 택배사 원문 description 을 그대로 쓰지 않고 단계별로 간결히 교정.
 * **명사는 "상품" 으로 통일**(물품/물건 혼용 금지). 짧은 명사구로 표현한다.
 * 이동중은 호출부에서 위치(허브명)를 괄호로 덧붙인다(예: "이동 중 (옥천HUB)").
 */
export const STAGE_STATUS_MESSAGE: Record<Stage, string> = {
  미등록: "조회 전",
  등록: "상품 접수",
  집화: "상품 집화",
  이동중: "이동 중",
  배송출발: "배송 출발",
  배송완료: "배송 완료",
  예외: "배송 문제 — 확인 필요",
  기타: "상태 확인 중",
};

/** 단계별 친근한 한 줄 요약(목록 카드 · 상세 상태문구 폴백). 기술 용어·에러 코드 노출 금지(PRD 톤). */
export const STAGE_SUMMARY: Record<Stage, string> = {
  미등록: "아직 조회 전이에요",
  등록: "접수가 확인됐어요",
  집화: "택배사가 상품을 수거했어요",
  이동중: "이동 중이에요",
  배송출발: "오늘 도착 예정이에요",
  배송완료: "배송이 완료됐어요",
  예외: "확인이 필요해요",
  기타: "상태를 확인 중이에요",
};
