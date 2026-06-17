/**
 * 시간 표기 순수 헬퍼 — 상대 시간("방금"·"2시간 전")과 KST 절대 시각.
 * docs/PRD.md "UX 세부"(상대 시간 + 절대 시각 보조), docs/UI_GUIDE.md 타임라인(KST).
 * now 주입(Date.now 직접 호출 금지 — 결정적 테스트). 두 인자 모두 절대 instant라 상대값은 시간대 무관.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 시각(epoch ms 또는 ISO 문자열)과 now(ms epoch)의 차이를 친근한 상대 표기로. 1분 미만은 "방금".
 * epoch ms 를 직접 받으면 ISO 왕복(new Date().toISOString())이 불필요하고, createdAt 이 비어도
 * 안전하다(Date 생성 시 RangeError 회피). 호출부가 맥락어를 붙인다. 파싱 불가/미래/누락은 "방금".
 */
export function relativeTime(input: number | string, now: number): string {
  const t = typeof input === "number" ? input : Date.parse(input);
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

const WEEKDAYS_KST = ["일", "월", "화", "수", "목", "금", "토"] as const;

/**
 * KST(UTC+9) 절대 시각 "M월 D일 (요일) HH:mm" (한글 요일 일~토). 상세 현재 상태 문구용.
 * 타임라인용 absoluteKST("M.D HH:mm")와 별개. epoch ms 또는 ISO 문자열 수용, 파싱 불가면 "".
 * absoluteKST 와 동일하게 +9h 시프트 후 UTC 게터로 KST 벽시계를 읽는다(디바이스 시간대 무관).
 */
export function absoluteKSTLong(input: number | string): string {
  const t = typeof input === "number" ? input : Date.parse(input);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + 9 * HOUR);
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const weekday = WEEKDAYS_KST[d.getUTCDay()];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month}월 ${day}일 (${weekday}) ${hh}:${mi}`;
}
