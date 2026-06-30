/**
 * 구매내역 캡처 OCR 텍스트의 PII 마스킹 — **다층 방어**(ADR-038). 순수 함수(I/O·네트워크 없음).
 * 캡처 분석 파이프라인 ②: 이 결과(마스킹된 텍스트)만 외부(Workers AI 분류)로 전송한다 — 원문·이미지·PII 는 기기를 안 떠난다.
 *
 * 어느 한 겹에 의존하지 않는다:
 *  ① 구간 제거(주 방어): PII 섹션 헤더 ~ 다음 안전 섹션 헤더 사이를 통째 제거 → 라벨 없는 이름·주소도 위치로 제거.
 *  ② 패턴 정규식(안전망): 전화·우편번호·주소·이메일·카드번호 줄 제거 — 구간이 안 먹는 몰(예: 쿠팡, PII 헤더 없음)을 잡는다.
 *  ③ 보수적 과삭제: 분류엔 상품명·금액만 필요 → PII 의심 줄은 제거(상품/금액 줄은 보존).
 *  ④ 잔존 PII 게이트: `detectResidualPII` — 마스킹 후 비어야 한다(누출 0 단언).
 */

// ── PII 섹션 헤더(구간 시작) / 안전 섹션 헤더(구간 끝) ─────────────────────────
const PII_SECTION_HEADERS = [
  "배송지",
  "배송 주소",
  "받는사람",
  "받는 분",
  "수령인",
  "수취인",
  "수신인",
  "배송정보",
];
const SAFE_SECTION_HEADERS = [
  "결제정보",
  "결제 정보",
  "지불 방법",
  "주문금액",
  "주문상품",
  "상품 상세",
  "상품정보",
];

const startsWithAny = (line: string, headers: string[]): boolean =>
  headers.some((h) => line === h || line.startsWith(h));

// ── 패턴(안전망) ─────────────────────────────────────────────────────────────
// 전화: 일반(010-…)·국제(+82…)·마스킹형(010***…).
const PHONE_PATTERNS: RegExp[] = [
  /010[-\s]?\d{3,4}[-\s]?\d{4}/,
  /\+82\s?0?1\d{8,9}/,
  /010[\*\s]*\d{3,4}/,
];
// 이메일.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// 우편번호: 5자리(괄호 포함 `(06234)` 형). 금액은 천단위 콤마라 5연속 숫자가 없어 안전.
const POSTCODE = /\b\d{5}\b/;
// 카드번호(마스킹형 `1234******5678`).
const CARD = /\d{4,6}\*{4,}\d{0,4}/;
// 행정구역(특별시·광역시·…시/도/군/구) + 도로명(…로/…길/번길) 동시면 주소로 본다.
const ADMIN = /특별시|광역시|특별자치시|특별자치도|[가-힣]+시|[가-힣]+도|[가-힣]+군|[가-힣]+구/;
// 도로명: 로/길 뒤에 건물번호(숫자)가 와야 주소로 본다 — "바로 구매하기" 같은 로-끝 일반어 오탐 방지(실측 보강).
const ROAD = /[가-힣]{2,}(?:대로|로|길)\s*\d|\d+\s*번길/;
// 상세주소(동·호) 패턴.
const DONG_HO = /\d+\s*동|\d+\s*호/;
// 건물·동 조각 — 헤더 없는 몰에서 주소가 여러 줄로 쪼개질 때(실측 쿠팡 "비산동, 뷰티하우스)").
const BUILDING = /아파트|빌라|연립|오피스텔|맨션|빌딩|타워|팰리스|캐슬|하우스/;
// 마스킹된 수령인 이름(라벨·헤더 없는 줄 — "제·명"·"홍*동"·"김**"). 카테고리(`도서·문구` 등 4자+)와 길이로 구분.
const MASKED_NAME = /^[가-힣][·•・*][가-힣*]$|^[가-힣]\*{1,2}$/;

const isAddressLine = (line: string): boolean =>
  (ADMIN.test(line) && ROAD.test(line)) || DONG_HO.test(line) || BUILDING.test(line);

const isPiiLine = (line: string): boolean =>
  PHONE_PATTERNS.some((re) => re.test(line)) ||
  EMAIL.test(line) ||
  CARD.test(line) ||
  POSTCODE.test(line) ||
  MASKED_NAME.test(line.trim()) ||
  isAddressLine(line);

/**
 * OCR 텍스트(읽기순서 보존)에서 PII 줄을 제거한다. 상품명·금액 줄은 보존(분류 입력).
 * 다층: ① 구간 제거 → ② 남은 줄에 패턴 제거.
 */
export function maskPurchaseText(ocrText: string): string {
  const lines = ocrText.split("\n");

  // ① 구간 제거: PII 헤더 ~ 다음 안전 헤더(직전)까지 통째 제거. 안전 헤더 없이 끝나면 EOF 까지 제거(보수적).
  const afterSection: string[] = [];
  let removing = false;
  for (const line of lines) {
    const t = line.trim();
    if (removing) {
      if (startsWithAny(t, SAFE_SECTION_HEADERS)) {
        removing = false;
        afterSection.push(line); // 안전 헤더는 보존
      }
      // 그 외(PII 구간 본문)는 버린다
      continue;
    }
    if (startsWithAny(t, PII_SECTION_HEADERS)) {
      removing = true; // PII 헤더 줄도 버린다
      continue;
    }
    afterSection.push(line);
  }

  // ② 패턴 안전망: 구간이 못 잡은 PII 줄 제거(헤더 없는 몰 대응).
  return afterSection.filter((line) => !isPiiLine(line)).join("\n");
}

const GATE_PATTERNS: RegExp[] = [...PHONE_PATTERNS, EMAIL, POSTCODE, ROAD, BUILDING];

/**
 * 마스킹 결과에 남은 PII 의심 패턴(전화·이메일·우편번호·도로명)을 모아 반환한다.
 * **잔존 PII 자동탐지 게이트** — 정상 마스킹이면 빈 배열이어야 한다(누출 0).
 */
export function detectResidualPII(text: string): string[] {
  const hits: string[] = [];
  for (const line of text.split("\n")) {
    for (const re of GATE_PATTERNS) {
      const m = line.match(re);
      if (m) hits.push(m[0]);
    }
  }
  return hits;
}
