/**
 * 상세 화면 "받는 분" 표시 게이트 (ADR-032).
 * 수취인 이름이 "사용자가 식별 가능"할 때만 그대로 반환하고, 아니면 undefined(= 줄 숨김)를 준다.
 * 한진 등 일부 택배사는 recipient.name 에 실제 이름 대신 "받는 분" 같은 라벨이나 완전마스킹(***)을
 * 넣어 보낸다 → 화면에 무의미하게 찍히는 것을 막는다. 부분 마스킹(김**)은 본인이 알아볼 수 있어 표시한다.
 * 표시 여부는 프레젠테이션 규칙이라 앱 측 순수 함수가 담당(worker toContact 무변경).
 */

/** 택배사가 이름 대신 넣는 플레이스홀더 라벨(정확 일치 시 숨김). 새 변형은 실측으로 보강. */
const PLACEHOLDER_NAMES = new Set([
  "받는 분",
  "받는분",
  "수령인",
  "수취인",
  "수신인",
  "고객",
  "고객님",
  "본인",
]);

export function displayRecipientName(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined; // 빈 값·공백만
  if (PLACEHOLDER_NAMES.has(trimmed)) return undefined; // 라벨(받는 분 등)
  if (trimmed.replace(/[*\s]/g, "") === "") return undefined; // 전부 가림(*** 등)
  return trimmed; // 부분 마스킹(김**)·실명은 식별 가치가 있어 표시
}
