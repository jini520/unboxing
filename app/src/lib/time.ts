/**
 * 시간 표기 순수 헬퍼 — 상대 시간("방금"·"2시간 전")과 KST 절대 시각.
 * docs/PRD.md "UX 세부"(상대 시간 + 절대 시각 보조), docs/UI_GUIDE.md 타임라인(KST).
 * now 주입(Date.now 직접 호출 금지 — 결정적 테스트). 두 인자 모두 절대 instant라 상대값은 시간대 무관.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * iso 시각과 now(ms epoch)의 차이를 친근한 상대 표기로. 1분 미만은 "방금".
 * 호출부가 맥락어를 붙인다(예: "마지막 업데이트 · {relative}"). 파싱 불가/미래는 "방금".
 */
export function relativeTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "방금";
  const diff = now - t;
  if (diff < MINUTE) return "방금";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}분 전`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}시간 전`;
  return `${Math.floor(diff / DAY)}일 전`;
}

/**
 * KST(UTC+9) 절대 시각 "M.D HH:mm". 상대 시간의 보조 표기(타임라인). 파싱 불가면 "".
 * 시프트 후 UTC 게터로 읽어 디바이스 시간대와 무관하게 KST 벽시계를 만든다.
 */
export function absoluteKST(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + 9 * HOUR);
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month}.${day} ${hh}:${mi}`;
}
