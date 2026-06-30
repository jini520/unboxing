import { describe, it, expect } from "@jest/globals";
import { maskPurchaseText, detectResidualPII } from "./purchaseMask";

/**
 * ⚠️ 아래 fixture 의 PII(이름·전화·주소·카드)는 **전부 합성(가짜)** 이다 — 실측 3몰의 레이아웃만 본떴다.
 * 진짜 PII 는 repo·테스트에 절대 넣지 않는다(개인정보 비영속 CRITICAL).
 */

// fixture A — 네이버페이형: PII 섹션 헤더(배송지) ~ 안전 헤더(결제정보) 구간 있음 → 구간 제거가 주 방어.
const FIXTURE_A = `주문상품
마크곤잘레스 엔젤 키링 스트릿 백팩 - ...
옵션 색상: BLACK / 사이즈: FREE | 1개
60,190원 99,000
배송지
홍길동(홍길동)
010-1234-5678
햇살아파트) 202동 101호 (06234)
서울특별시 강남구 테헤란로 123 (역삼동,
결제정보
주문금액
총 60,190원
상품금액
99,000원`;

// fixture B — 쿠팡형: ⚠️ PII 섹션 헤더 없음(결제 정보 뒤 헤더 없이 PII) → 패턴 안전망이 잡아야 함(ADR-038 핵심).
const FIXTURE_B = `주문상세
결제 정보
상품 가격
28,300 원
할인금액
1,070원
총 결제금액
27,230 원
카드영수증 보기
홍*동
(06234) 서울특별시 강남구 테헤란로 123 202동 101호 (역삼동, 햇살아파트)
010***5678
배송요청사항 • 문 앞
배송완료 6/17(수) 도착
신지모루 강화유리 휴대폰 액정보호필름 4p 세트, 갤럭시`;

// fixture C — AliExpress형: PII 헤더(배송 주소) ~ 안전 헤더(지불 방법), 한 줄에 이름+전화.
const FIXTURE_C = `합계:
₩21,348
배송 주소
홍길동 +82 01012345678
테헤란로 123 / 45, 햇살아파트 202동 101호, 강남구, 서울특별시, Korea, 06234
지불 방법
1234******5678
상품 상세
2026년 신상 한국 패션 남성 가디건 가을
₩25,707`;

describe("maskPurchaseText — fixture A (네이버페이형 · 구간 제거)", () => {
  const masked = maskPurchaseText(FIXTURE_A);

  it("PII(이름·전화·우편번호·주소)를 제거한다", () => {
    expect(masked).not.toContain("홍길동");
    expect(masked).not.toContain("010-1234-5678");
    expect(masked).not.toContain("06234");
    expect(masked).not.toContain("서울특별시 강남구 테헤란로");
  });

  it("상품명·금액 줄은 보존한다", () => {
    expect(masked).toContain("백팩");
    expect(masked).toContain("60,190");
  });

  it("잔존 PII 게이트가 비어야 한다", () => {
    expect(detectResidualPII(masked)).toEqual([]);
  });
});

describe("maskPurchaseText — fixture B (쿠팡형 · PII 헤더 없음 → 패턴 안전망)", () => {
  const masked = maskPurchaseText(FIXTURE_B);

  it("구간 제거가 안 먹어도 패턴이 PII(우편번호·주소·전화)를 제거한다", () => {
    expect(masked).not.toContain("06234");
    expect(masked).not.toContain("서울특별시 강남구 테헤란로");
    expect(masked).not.toContain("010***5678");
  });

  it("상품명·금액 줄은 보존한다", () => {
    expect(masked).toContain("액정보호필름");
    expect(masked).toContain("27,230");
  });

  it("잔존 PII 게이트가 비어야 한다", () => {
    expect(detectResidualPII(masked)).toEqual([]);
  });
});

describe("maskPurchaseText — fixture C (AliExpress형 · 이름+전화 한 줄)", () => {
  const masked = maskPurchaseText(FIXTURE_C);

  it("PII(이름·전화·주소·우편번호·카드)를 제거한다", () => {
    expect(masked).not.toContain("홍길동");
    expect(masked).not.toContain("+82 01012345678");
    expect(masked).not.toContain("테헤란로");
    expect(masked).not.toContain("06234");
    expect(masked).not.toContain("1234******5678");
  });

  it("상품명·금액 줄은 보존한다", () => {
    expect(masked).toContain("가디건");
    expect(masked).toContain("21,348");
  });

  it("잔존 PII 게이트가 비어야 한다", () => {
    expect(detectResidualPII(masked)).toEqual([]);
  });
});

describe("detectResidualPII — 패턴 직접 검증", () => {
  it("전화(일반·국제·마스킹형)를 탐지한다", () => {
    expect(detectResidualPII("연락처 010-1234-5678").length).toBeGreaterThan(0);
    expect(detectResidualPII("홍길동 +82 01012345678").length).toBeGreaterThan(0);
    expect(detectResidualPII("010***5678").length).toBeGreaterThan(0);
  });

  it("우편번호·도로명 주소를 탐지한다", () => {
    expect(detectResidualPII("(06234)").length).toBeGreaterThan(0);
    expect(detectResidualPII("서울특별시 강남구 테헤란로 123").length).toBeGreaterThan(0);
  });

  it("이메일을 탐지한다", () => {
    expect(detectResidualPII("user@example.com")).toContain("user@example.com");
  });

  it("상품·금액만 있는 정상 텍스트는 빈 배열", () => {
    expect(detectResidualPII("액정보호필름 4p 세트\n27,230 원")).toEqual([]);
    expect(detectResidualPII("2026년 신상 가디건\n₩25,707")).toEqual([]);
  });
});

// 실측 OCR(2026-06-30 3몰)에서 합성 fixture 가 놓친 케이스 — 회귀 락(ADR-038). PII 는 전부 합성.
describe("maskPurchaseText — 실측 보강 회귀", () => {
  it("로-끝 일반어('바로 구매하기')는 도로명 오탐이 아니라 보존한다", () => {
    const out = maskPurchaseText("마크 백팩\n60,190원\n바로 구매하기\n장바구니 담기");
    expect(out).toContain("바로 구매하기");
    expect(out).toContain("백팩");
    expect(detectResidualPII(out)).toEqual([]);
  });

  it("도로명은 건물번호(숫자)가 있어야 주소로 본다(로-끝 일반어 오탐 방지)", () => {
    expect(detectResidualPII("바로 구매하기")).toEqual([]);
    expect(detectResidualPII("새로 나온 신상")).toEqual([]);
    expect(detectResidualPII("테헤란로 123").length).toBeGreaterThan(0);
  });

  it("헤더 없는 몰(쿠팡형): 마스킹된 이름·동/건물 조각을 제거한다", () => {
    const coupang = [
      "총 결제금액",
      "27,230 원",
      "카드영수증 보기",
      "홍*동",
      "(06234) 서울특별시 강남구 테헤란로 123 202동 101호",
      "비산동, 뷰티하우스)",
      "010***5678",
      "강화유리 액정보호필름 4p 세트",
    ].join("\n");
    const out = maskPurchaseText(coupang);
    expect(out).not.toContain("홍*동");
    expect(out).not.toContain("뷰티하우스");
    expect(out).not.toContain("010***5678");
    expect(out).toContain("액정보호필름");
    expect(out).toContain("27,230");
    expect(detectResidualPII(out)).toEqual([]);
  });

  it("카테고리(`도서·문구`)는 마스킹 이름으로 오인하지 않는다", () => {
    expect(maskPurchaseText("도서·문구 노트")).toContain("도서·문구");
  });
});
