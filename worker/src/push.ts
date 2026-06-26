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
import { carrierName } from "./lib/carrier";

const SEND_URL = "https://exp.host/--/api/v2/push/send";
const RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
/** Expo 요청단 한도: send ≤100건, getReceipts ≤1000건. 초과 시 PUSH_TOO_MANY_*. */
const SEND_BATCH = 100;
const RECEIPTS_BATCH = 1000;

/**
 * Android 알림 채널 id — 모든 발송 PushMessage 에 싣는다. 안 실으면 안드로이드가 **기본 채널**로 보내
 * 앱이 만든 고중요도 채널(heads-up 배너)을 안 타고 알림함에만 쌓인다. iOS 는 이 필드를 무시한다.
 * ⚠️ 앱의 `app/src/lib/push.ts` `DELIVERY_CHANNEL_ID`("delivery-status")와 **동일 문자열 유지**(드리프트 금지).
 */
export const DELIVERY_CHANNEL_ID = "delivery-status";

export interface PushMessage {
  to: string; // ExponentPushToken[...]
  title: string;
  body: string;
  data: { shipment_id: string }; // 딥링크용
  channelId: string; // Android 알림 채널(위 DELIVERY_CHANNEL_ID). iOS 무시.
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

/** 알림 대상 단계별 body 문구 (PRD "알림 정책"). 거래성/정보성만(ADR-018). 배송출발은 KST 당일 여부로 분기(아래 bodyFor). */
const STAGE_BODY: Partial<Record<Stage, string>> = {
  등록: "📦 접수가 확인됐어요",
  집화: "📥 택배사가 상품을 수거했어요",
  // 이동중 = 허브 간 이동 시작(첫 진입 1회 — ADR-030). 배송출발(🚚=최종 배송)과 이모지 구분(🚛).
  이동중: "🚛 상품이 이동을 시작했어요",
  배송완료: "✅ 배송 완료",
  예외: "⚠️ 배송에 문제가 있어요(지연/반송) — 확인이 필요해요",
};

/** epoch ms → KST(UTC+9) 기준 yyyy-mm-dd 키. 날짜 경계 판정용(ARCHITECTURE: 날짜 판정은 KST). */
function kstDayKey(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

/** 배송출발 문구: 출발 이벤트가 KST 기준 '오늘'일 때만 '오늘 도착'을 단정한다. 시각 불명이면 중립 문구. */
function bodyFor(stage: Stage, ctx: { eventTimeMs?: number; nowMs?: number }): string | undefined {
  if (stage === "배송출발") {
    const sameDay =
      ctx.eventTimeMs !== undefined &&
      ctx.nowMs !== undefined &&
      kstDayKey(ctx.eventTimeMs) === kstDayKey(ctx.nowMs);
    return sameDay ? "🚚 오늘 도착 예정 — 배송이 시작됐어요" : "🚚 배송이 시작됐어요";
  }
  return STAGE_BODY[stage];
}

/**
 * 알림 대상 단계 → PushMessage 생성.
 * title 은 어떤 택배인지(택배사·끝4자리), body 는 무슨 일인지(단계 문구).
 * 비알림 단계(기타·미등록)는 null(이동중은 ADR-030으로 알림 대상이 됨).
 * 배송출발 '오늘 도착' 단정은 eventTimeMs/nowMs 로 KST 당일 여부를 확인한다(ARCHITECTURE 날짜=KST).
 */
export function buildMessage(
  stage: Stage,
  ctx: {
    token: string;
    shipmentId: string;
    carrier: string;
    last4: string;
    eventTimeMs?: number;
    nowMs?: number;
  },
): PushMessage | null {
  if (!NOTIFYING_STAGES.has(stage)) return null;
  const body = bodyFor(stage, ctx);
  if (body === undefined) return null;
  return {
    to: ctx.token,
    // title 은 carrierId 대신 한글 택배사명(이슈 #9). 미상 id 는 carrierName 이 원문 폴백.
    title: `${carrierName(ctx.carrier)}(${ctx.last4})`,
    body, // 문구는 모두 짧음 → payload ≤4096B 자명 충족
    data: { shipment_id: ctx.shipmentId },
    channelId: DELIVERY_CHANNEL_ID,
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
 * send: 메시지를 배치(≤100)로 분할해 순서대로 발송하고 ticket 을 **입력 순서와 1:1 정렬**해 모은다.
 * Expo 는 요청 배열 순서대로 ticket 을 반환하지만, 배치 응답이 짧거나(부분 실패) HTTP 오류로 data 가
 * 비면 이후 인덱스가 밀려 ticket↔message 짝이 깨진다(잘못된 토큰 삭제). 그래서 **배치 메시지 수만큼**
 * ticket 을 채우고, 부족분/실패분은 error ticket 으로 패딩해 `tickets[i] ↔ messages[i]` 를 보장한다.
 */
export async function sendPush(messages: PushMessage[], deps: PushDeps): Promise<PushTicket[]> {
  const tickets: PushTicket[] = [];
  for (const batch of chunk(messages, SEND_BATCH)) {
    let data: PushTicket[] = [];
    try {
      const res = await deps.fetch(SEND_URL, {
        method: "POST",
        headers: headers(deps),
        body: JSON.stringify(batch),
      });
      const json = (await res.json()) as { data?: PushTicket[] };
      data = json.data ?? [];
    } catch {
      data = []; // 네트워크 오류 → 전부 패딩(아래). 배치 실패가 다른 배치 정렬을 깨지 않게 한다.
    }
    // 정렬 보존: 배치 메시지 수만큼 ticket 을 채운다(부족분은 error 로 패딩 → classifyPushError=IGNORE).
    for (let i = 0; i < batch.length; i++) {
      tickets.push(data[i] ?? { status: "error", message: "no ticket returned" });
    }
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
