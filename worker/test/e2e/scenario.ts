import { SELF } from "cloudflare:test";

/**
 * E2E 시나리오 헬퍼 — "사용자 여정"을 지름길 없이 그대로 구동한다.
 *
 * 통합 테스트(test/*.test.ts)와의 차이: 그쪽은 편의상 device 선등록 등을 직접 INSERT 하거나
 * 활성 상한 시드를 DB에 꽂는다. E2E 는 그런 지름길을 일절 쓰지 않고, **앱이 실제로 하는 HTTP 호출
 * 순서 그대로** SELF.fetch 만으로 흐름을 구동한다.
 * (그 지름길이 QA-001 데드락 — 푸시 거부 시 device 미등록 → 송장 등록 401 — 을 통합 테스트가 놓친 원인이다.)
 *
 * 깨끗한 D1 은 테스트가 beforeEach 에서 applySchema(env.DB) 로 마련한다(이 헬퍼는 DB 를 건드리지 않는다).
 */

const BASE = "https://example.com";

export interface ApiResult {
  status: number;
  /** JSON 응답이면 파싱된 객체, 204·텍스트 응답이면 null/string. */
  body: unknown;
}

export interface CallOpts {
  /** Authorization: Bearer <device_id>. 생략하면 인증 헤더 없이 호출(미인증 흐름 표현용). */
  deviceId?: string;
  /** 요청 본문(JSON 직렬화). 생략하면 본문 없음(GET/DELETE 등). */
  json?: unknown;
}

/**
 * 앱이 하듯 HTTP 한 번을 SELF.fetch 로 호출한다. device 선등록 같은 지름길은 호출자가
 * call("POST","/devices", ...) 를 먼저 부르는 식으로 "실제 순서"를 그대로 표현한다.
 */
export async function call(method: string, path: string, opts: CallOpts = {}): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (opts.deviceId !== undefined) headers["Authorization"] = `Bearer ${opts.deviceId}`;
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }

  const res = await SELF.fetch(`${BASE}${path}`, { method, headers, body });

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text; // 비 JSON(예: "Not Found")
    }
  }
  return { status: res.status, body: parsed };
}
