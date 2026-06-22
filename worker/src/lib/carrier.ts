/**
 * carrierId → 한글 택배사명 (worker 측 미러) — 푸시 발송 문구 title 에 carrierId 대신 한글명 표기(이슈 #9).
 * 단일 출처는 앱 드롭다운 `app/src/lib/carrier.ts` 의 CARRIERS — 두 곳을 같은 8종으로 동기화한다(드리프트 시 함께 갱신).
 * (index.ts SUPPORTED_CARRIERS 와 동일 원칙: 앱 목록을 서버에 미러.)
 *
 * ⚠️ 저장(notifications.carrier)은 **carrierId 원문** — 한글 변환은 표시 시점(이 함수)만. 알림 화면 변환은 앱 책임(#9 원칙).
 */
const CARRIER_NAMES: Record<string, string> = {
  "kr.cjlogistics": "CJ대한통운",
  "kr.epost": "우체국택배",
  "kr.hanjin": "한진택배",
  "kr.lotte": "롯데택배",
  "kr.logen": "로젠택배",
  "kr.kdexp": "경동택배",
  "kr.cupost": "CU 편의점택배",
  "kr.coupangls": "쿠팡 로지스틱스",
};

/** carrierId → 한글 택배사명. 미상/미지원 id 는 그대로 반환(폴백). 푸시 title 표시용(저장은 carrierId). */
export function carrierName(id: string): string {
  return CARRIER_NAMES[id] ?? id;
}
