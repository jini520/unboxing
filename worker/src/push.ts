/**
 * Expo Push 발송 파이프라인 (2단계: send→ticket, getReceipts→receipt).
 * 설계 기준: docs/ARCHITECTURE.md "푸시 발송 파이프라인" · "푸시 에러 처리",
 *           ADR-010(2단계·Enhanced Security), ADR-018(거래성 알림만), PRD "알림 정책".
 *
 * 핵심:
 *  - 외부 호출은 **주입된 fetch**로만 한다(테스트는 mock, 실제 exp.host 호출 없음).
 *  - send 는 배치 ≤100, getReceipts 는 배치 ≤1000 으로 분할(요청단 한도 위반 방지).
 *  - 알림 대상 단계(step2 NOTIFYING_STAGES)만 메시지를 만든다. 비알림 단계는 null.
 *  - data.shipment_id 를 항상 포함(딥링크). body 는 짧게 유지(≤4096B).
 *  - push_token 은 로그/에러 메시지에 남기지 않는다.
 *  - 토큰 삭제·D1 접근은 여기서 하지 않는다(부작용은 cron=step7). 여기는 발송·분류·문구만.
 */

import type { Stage } from "./lib/polling";
import { NOTIFYING_STAGES } from "./lib/notify";

const SEND_URL = "https://exp.host/--/api/v2/push/send";
const RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
/** Expo 요청단 한도: send ≤100건, getReceipts ≤1000건. 초과 시 PUSH_TOO_MANY_*. */
const SEND_BATCH = 100;
const RECEIPTS_BATCH = 1000;

export interface PushMessage {
  to: string; // ExponentPushToken[...]
  title: string;
  body: string;
  data: { shipment_id: string }; // 딥링크용
}

export interface PushTicket {
  id?: string;
  status: "ok" | "error";
  details?: { error?: string };
  message?: string;
}

export interface PushReceipt {
  status: "ok" | "error";
  details?: { error?: string };
  message?: string;
}

export type PushErrorAction = "DELETE_TOKEN" | "RETRY" | "ALERT" | "SHRINK" | "IGNORE";

export interface PushDeps {
  fetch: typeof fetch;
  /** Enhanced Security 활성화 시 Bearer 인증(선택·권장, ADR-010). 없으면 헤더 없이 발송. */
  expoAccessToken?: string;
}

/** 알림 대상 단계별 body 문구 (PRD "알림 정책"). 거래성/정보성만(ADR-018). */
const STAGE_BODY: Partial<Record<Stage, string>> = {
  등록: "접수가 확인됐어요",
  집화: "택배사가 상품을 수거했어요",
  배송출발: "오늘 도착 예정 — 배송이 시작됐어요",
  배송완료: "배송 완료 ✓",
  예외: "배송에 문제가 있어요(지연/반송) — 확인이 필요해요",
};

/**
 * 알림 대상 단계 → PushMessage 생성.
 * title 은 어떤 택배인지(택배사·끝4자리), body 는 무슨 일인지(단계 문구).
 * 비알림 단계(이동중·기타·미등록)는 null(step2 알림 규칙과 일관).
 */
export function buildMessage(
  stage: Stage,
  ctx: { token: string; shipmentId: string; carrier: string; last4: string },
): PushMessage | null {
  if (!NOTIFYING_STAGES.has(stage)) return null;
  const body = STAGE_BODY[stage];
  if (body === undefined) return null;
  return {
    to: ctx.token,
    title: `${ctx.carrier} · …${ctx.last4}`,
    body, // 문구는 모두 짧음 → payload ≤4096B 자명 충족
    data: { shipment_id: ctx.shipmentId },
  };
}

/** Expo 에러 코드 → 처리 액션 (ARCHITECTURE "푸시 에러 처리"). 토큰 삭제 실행은 step7. */
export function classifyPushError(error: string | undefined): PushErrorAction {
  switch (error) {
    case "DeviceNotRegistered":
      return "DELETE_TOKEN";
    case "MessageRateExceeded":
      return "RETRY";
    case "MessageTooBig":
      return "SHRINK";
    case "MismatchSenderId":
    case "InvalidCredentials":
      return "ALERT";
    default:
      return "IGNORE";
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Content-Type/Accept + (있으면) Bearer. token 자체는 로그하지 않는다. */
function headers(deps: PushDeps): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (deps.expoAccessToken) h.Authorization = `Bearer ${deps.expoAccessToken}`;
  return h;
}

/**
 * send: 메시지를 배치(≤100)로 분할해 순서대로 발송하고 ticket 을 입력 순서대로 모은다.
 * Expo 는 요청 배열 순서와 같은 순서로 ticket 배열을 반환한다.
 */
export async function sendPush(messages: PushMessage[], deps: PushDeps): Promise<PushTicket[]> {
  const tickets: PushTicket[] = [];
  for (const batch of chunk(messages, SEND_BATCH)) {
    const res = await deps.fetch(SEND_URL, {
      method: "POST",
      headers: headers(deps),
      body: JSON.stringify(batch),
    });
    const json = (await res.json()) as { data?: PushTicket[] };
    tickets.push(...(json.data ?? []));
  }
  return tickets;
}

/**
 * getReceipts: ticket id 를 배치(≤1000)로 분할 조회해 ticketId→receipt 맵으로 합친다.
 */
export async function getReceipts(
  ticketIds: string[],
  deps: PushDeps,
): Promise<Record<string, PushReceipt>> {
  const receipts: Record<string, PushReceipt> = {};
  for (const batch of chunk(ticketIds, RECEIPTS_BATCH)) {
    const res = await deps.fetch(RECEIPTS_URL, {
      method: "POST",
      headers: headers(deps),
      body: JSON.stringify({ ids: batch }),
    });
    const json = (await res.json()) as { data?: Record<string, PushReceipt> };
    Object.assign(receipts, json.data ?? {});
  }
  return receipts;
}
