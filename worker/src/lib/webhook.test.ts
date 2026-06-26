import { describe, it, expect } from "vitest";
import {
  shouldRegisterWebhook,
  webhookExpiration,
  reregisterDue,
  fallbackInterval,
  verifyCallbackSecret,
  shouldRefetchOnCallback,
  parseCallback,
  WEBHOOK_TTL_MS,
  WEBHOOK_FALLBACK_MS,
  REREGISTER_THRESHOLD_MS,
  CALLBACK_FRESHNESS_MS,
} from "./webhook";
import { pollIntervalMs, type Stage } from "./polling";

const NOW = 1_700_000_000_000;
const H = 60 * 60 * 1000;

const ALL_STAGES: Stage[] = [
  "미등록",
  "등록",
  "집화",
  "이동중",
  "배송출발",
  "배송완료",
  "예외",
  "기타",
];
// 등록 가능 = 비종료(배송완료 제외) && 미등록 아님(이벤트 0)
const REGISTRABLE: Stage[] = ["등록", "집화", "이동중", "배송출발", "예외", "기타"];
const NOT_REGISTRABLE: Stage[] = ["미등록", "배송완료"];

describe("상수", () => {
  it("TTL=48h, 재등록 임계=24h, 폴백 안전망=12h", () => {
    expect(WEBHOOK_TTL_MS).toBe(48 * H);
    expect(REREGISTER_THRESHOLD_MS).toBe(24 * H);
    expect(WEBHOOK_FALLBACK_MS).toBe(12 * H);
  });
  it("콜백 신선도 throttle=60s", () => {
    expect(CALLBACK_FRESHNESS_MS).toBe(60_000);
  });
});

describe("shouldRegisterWebhook (8단계 × active × 만료상태 전수)", () => {
  describe("active && webhook 미등록(NULL) — 등록 가능 단계만 true", () => {
    for (const stage of REGISTRABLE) {
      it(`${stage} → true`, () => {
        expect(shouldRegisterWebhook(stage, true, null, NOW)).toBe(true);
      });
    }
    for (const stage of NOT_REGISTRABLE) {
      it(`${stage} → false (종료/이벤트0)`, () => {
        expect(shouldRegisterWebhook(stage, true, null, NOW)).toBe(false);
      });
    }
  });

  describe("비active → 전 8단계 false (만료상태 무관)", () => {
    for (const stage of ALL_STAGES) {
      it(`${stage} (active=false, NULL) → false`, () => {
        expect(shouldRegisterWebhook(stage, false, null, NOW)).toBe(false);
      });
      it(`${stage} (active=false, 임박) → false`, () => {
        expect(shouldRegisterWebhook(stage, false, NOW + H, NOW)).toBe(false);
      });
    }
  });

  describe("이미 등록·만료 여유(48h 남음) → 재등록 안 함(false)", () => {
    const 여유 = NOW + 48 * H;
    for (const stage of REGISTRABLE) {
      it(`${stage} → false`, () => {
        expect(shouldRegisterWebhook(stage, true, 여유, NOW)).toBe(false);
      });
    }
  });

  describe("만료 임박(<24h) → 재등록 true", () => {
    const 임박 = NOW + 12 * H;
    for (const stage of REGISTRABLE) {
      it(`${stage} → true`, () => {
        expect(shouldRegisterWebhook(stage, true, 임박, NOW)).toBe(true);
      });
    }
    for (const stage of NOT_REGISTRABLE) {
      it(`${stage} (임박이어도 단계 게이트) → false`, () => {
        expect(shouldRegisterWebhook(stage, true, 임박, NOW)).toBe(false);
      });
    }
  });

  describe("재등록 임계 경계(엄격 <)", () => {
    it("정확히 24h 남으면 임박 아님 → false", () => {
      expect(shouldRegisterWebhook("이동중", true, NOW + 24 * H, NOW)).toBe(false);
    });
    it("24h 직전이면 → true", () => {
      expect(shouldRegisterWebhook("이동중", true, NOW + 24 * H - 1, NOW)).toBe(true);
    });
    it("이미 만료(과거 expiresAt) → true", () => {
      expect(shouldRegisterWebhook("이동중", true, NOW - 1000, NOW)).toBe(true);
    });
  });
});

describe("webhookExpiration", () => {
  it("now+48h 를 ISO8601 UTC(끝 Z)로", () => {
    const iso = webhookExpiration(NOW);
    expect(iso).toMatch(/Z$/);
    expect(iso).toBe(new Date(NOW + WEBHOOK_TTL_MS).toISOString());
  });
  it("정확히 48h 뒤 시각", () => {
    const iso = webhookExpiration(NOW);
    expect(new Date(iso).getTime() - NOW).toBe(48 * H);
  });
});

describe("reregisterDue", () => {
  it("NULL(미등록) → false (등록 sweep 소관)", () => {
    expect(reregisterDue(null, NOW)).toBe(false);
  });
  it("여유(48h) → false", () => {
    expect(reregisterDue(NOW + 48 * H, NOW)).toBe(false);
  });
  it("임박(<24h) → true", () => {
    expect(reregisterDue(NOW + H, NOW)).toBe(true);
  });
  it("경계: 정확히 24h → false (엄격 <)", () => {
    expect(reregisterDue(NOW + 24 * H, NOW)).toBe(false);
  });
  it("경계: 24h 직전 → true", () => {
    expect(reregisterDue(NOW + 24 * H - 1, NOW)).toBe(true);
  });
  it("이미 만료(과거) → true", () => {
    expect(reregisterDue(NOW - 1000, NOW)).toBe(true);
  });
});

describe("fallbackInterval (단일 출처 — isDue 가 소비)", () => {
  it("배송완료 → null (폴링 안 함, webhook 무관)", () => {
    expect(fallbackInterval("배송완료", null)).toBeNull();
    expect(fallbackInterval("배송완료", NOW)).toBeNull();
  });
  it("webhook 등록분(expiresAt 있음) → ~12h 안전망", () => {
    expect(fallbackInterval("배송출발", NOW)).toBe(WEBHOOK_FALLBACK_MS);
    expect(fallbackInterval("이동중", NOW)).toBe(WEBHOOK_FALLBACK_MS);
    expect(fallbackInterval("미등록", NOW)).toBe(WEBHOOK_FALLBACK_MS);
  });
  it("미등록·폴백분(expiresAt null) → 기존 적응형 pollIntervalMs", () => {
    for (const stage of ALL_STAGES) {
      expect(fallbackInterval(stage, null)).toBe(pollIntervalMs(stage));
    }
  });
});

describe("verifyCallbackSecret (상수시간·ADR-029 ①·T6)", () => {
  it("일치 → true", () => {
    expect(verifyCallbackSecret("s3cret-abc-123", "s3cret-abc-123")).toBe(true);
  });
  it("불일치(같은 길이) → false", () => {
    expect(verifyCallbackSecret("s3cret-abc-123", "s3cret-xyz-123")).toBe(false);
  });
  it("불일치(다른 길이) → false (길이 early-return 없이 누산)", () => {
    expect(verifyCallbackSecret("short", "longer-secret-value")).toBe(false);
    expect(verifyCallbackSecret("longer-secret-value", "short")).toBe(false);
  });
  it("got 의 prefix 가 expected 와 같아도(짧음) → false", () => {
    expect(verifyCallbackSecret("s3cret", "s3cret-abc-123")).toBe(false);
  });
  it("첫 글자만 다름 → false (첫 불일치 early-return 단축 아님)", () => {
    expect(verifyCallbackSecret("Xbcdef", "abcdef")).toBe(false);
  });
  it("마지막 글자만 다름 → false (전수 스캔)", () => {
    expect(verifyCallbackSecret("abcdeX", "abcdef")).toBe(false);
  });
  it("빈 got → false", () => {
    expect(verifyCallbackSecret("", "expected-secret")).toBe(false);
  });
  it("빈 expected → false", () => {
    expect(verifyCallbackSecret("got-secret", "")).toBe(false);
  });
  it("둘 다 빈값 → false (빈 콜백 경로 우회 차단)", () => {
    expect(verifyCallbackSecret("", "")).toBe(false);
  });
});

describe("shouldRefetchOnCallback (신선도 throttle·ADR-029 ③·W6)", () => {
  it("한 번도 폴링 안 함(null) → true", () => {
    expect(shouldRefetchOnCallback(null, NOW)).toBe(true);
  });
  it("직전 폴링 <60s → false (연속·중복 콜백 dedupe)", () => {
    expect(shouldRefetchOnCallback(NOW - 30_000, NOW)).toBe(false);
    expect(shouldRefetchOnCallback(NOW - 59_999, NOW)).toBe(false);
  });
  it("정확히 60s 경계 → true (엄격 <)", () => {
    expect(shouldRefetchOnCallback(NOW - 60_000, NOW)).toBe(true);
  });
  it("60s 초과 → true (재조회 허용)", () => {
    expect(shouldRefetchOnCallback(NOW - 120_000, NOW)).toBe(true);
  });
});

describe("parseCallback (페이로드 형식 검증·W1 안전)", () => {
  it("정상 {carrierId, trackingNumber} → 객체", () => {
    expect(parseCallback({ carrierId: "kr.cjlogistics", trackingNumber: "522093451360" })).toEqual({
      carrierId: "kr.cjlogistics",
      trackingNumber: "522093451360",
    });
  });
  it("여분 필드는 무시(두 필드만 취함)", () => {
    expect(
      parseCallback({ carrierId: "kr.epost", trackingNumber: "999", evil: "drop", status: {} }),
    ).toEqual({ carrierId: "kr.epost", trackingNumber: "999" });
  });
  it("carrierId 누락 → null", () => {
    expect(parseCallback({ trackingNumber: "123" })).toBeNull();
  });
  it("trackingNumber 누락 → null", () => {
    expect(parseCallback({ carrierId: "kr.cjlogistics" })).toBeNull();
  });
  it("빈 문자열 필드 → null", () => {
    expect(parseCallback({ carrierId: "", trackingNumber: "123" })).toBeNull();
    expect(parseCallback({ carrierId: "kr.cjlogistics", trackingNumber: "" })).toBeNull();
  });
  it("타입 오류(숫자·객체) → null", () => {
    expect(parseCallback({ carrierId: 123, trackingNumber: "x" })).toBeNull();
    expect(parseCallback({ carrierId: "x", trackingNumber: { n: 1 } })).toBeNull();
  });
  it("비객체·손상 입력(null·undefined·문자열·숫자·배열) → null", () => {
    expect(parseCallback(null)).toBeNull();
    expect(parseCallback(undefined)).toBeNull();
    expect(parseCallback("not-an-object")).toBeNull();
    expect(parseCallback(42)).toBeNull();
    expect(parseCallback([])).toBeNull();
  });
});
