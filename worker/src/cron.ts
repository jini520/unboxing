/**
 * cron 배치 폴링 — due 송장을 폴링→정규화→멱등 알림→만료/삭제로 묶는 **배선(wiring) step**.
 * 정규화·알림판단·만료·푸시 문구는 step1~5 모듈을 호출한다(단일 출처, 재구현 금지).
 * 설계 기준: docs/ARCHITECTURE.md "적응형 폴링 + cron 실행 모델" · "상태 정규화 & 알림" ·
 *           "동시성 & 원자성" · "데이터 수명주기 & 만료" · "푸시 발송 파이프라인",
 *           ADR-001/006(서버리스 cron·적응형) · ADR-010(push 2단계) · ADR-012(선점 갱신·KST) · ADR-013(토큰 캐시).
 *
 * 핵심:
 *  - 1회 실행당 외부 subrequest ≤ 50 — due 처리 건수를 50으로 제한(나머지는 다음 fire 이월).
 *  - 단계 전환은 compare-and-set(영향행=1)으로 멱등 — 경쟁/재실행에도 정확히 1회 발송.
 *  - 처리 시작 시 last_polled_at=now 선점 갱신으로 중첩 실행 중복 처리 방지.
 *  - 배송완료 → 알림 후 shipment 삭제(개인정보 비영속, ADR-005).
 *  - now·fetch 주입(결정적 테스트) — Date.now()/실네트워크 호출 금지.
 *  - device_id·push_token·수령인 정보 로그/저장 금지.
 */

import type { Env } from "./index";
import { isDue, type Stage } from "./lib/polling";
import { normalizeStatus } from "./lib/normalize";
import { shouldNotify } from "./lib/notify";
import { lifecycleAction } from "./lib/lifecycle";
import { track, d1TokenStore } from "./tracker";
import { buildMessage, sendPush, classifyPushError, type PushMessage } from "./push";

/** 1회 실행당 외부 subrequest 상한(ADR-012 cron 한도). due 처리 건수를 이 값으로 제한. */
const MAX_BATCH = 50;

export interface CronDeps {
  now: number;
  fetch: typeof fetch;
}

interface DueRow {
  id: string;
  carrier: string;
  tracking_no: string;
  last_normalized_status: string | null;
  last_polled_at: number | null;
  created_at: number;
}

/** 저장된 status(문자열|null)를 Stage로 — null(미폴링)은 '미등록'으로 본다. */
function stageOf(status: string | null): Stage {
  return (status ?? "미등록") as Stage;
}

/** due 송장 배치 폴링 1회 실행. */
export async function runPollingBatch(env: Env, deps: CronDeps): Promise<void> {
  // 1. due 조회·정렬: active=1, '배송출발' 우선 → last_polled_at ASC. JS에서 isDue로 거른 뒤 ≤50건.
  const { results } = await env.DB.prepare(
    "SELECT id, carrier, tracking_no, last_normalized_status, last_polled_at, created_at " +
      "FROM shipments WHERE active = 1 " +
      "ORDER BY CASE WHEN last_normalized_status = '배송출발' THEN 0 ELSE 1 END, last_polled_at ASC",
  ).all<DueRow>();

  const due = results
    .filter((r) => isDue(stageOf(r.last_normalized_status), r.last_polled_at, deps.now))
    .slice(0, MAX_BATCH);

  for (const row of due) {
    await pollOne(env, deps, row);
  }
}

/** 송장 1건: 선점 갱신 → track → 정규화 → 멱등 전환/알림 → 만료. */
async function pollOne(env: Env, deps: CronDeps, row: DueRow): Promise<void> {
  const { now } = deps;
  const stored = row.last_normalized_status; // CAS 비교용 원본(null 가능)
  const prev = stageOf(stored);

  // 2. 선점 갱신: 처리 시작 시 last_polled_at=now 로 먼저 갱신(중첩/중복 방지, ADR-012).
  await env.DB.prepare("UPDATE shipments SET last_polled_at = ? WHERE id = ?")
    .bind(now, row.id)
    .run();

  // 3. track(외부 1회). 토큰은 D1 캐시(ADR-013). 데모 번호는 step4가 외부 호출 우회.
  let next: Stage;
  try {
    const result = await track(row.carrier, row.tracking_no, {
      fetch: deps.fetch,
      now,
      store: d1TokenStore(env.DB),
      clientId: env.DELIVERY_TRACKER_CLIENT_ID,
      clientSecret: env.DELIVERY_TRACKER_CLIENT_SECRET,
      demoTrackingNumber: env.DEMO_TRACKING_NUMBER,
    });
    // 4. 정규화: 원문 status.code → 표준 단계. 데이터 없음(NOT_FOUND)은 '미등록'.
    next = normalizeStatus(result.lastEvent?.statusCode);
  } catch {
    // 8. 외부 오류(UNAUTHENTICATED 재인증 실패·429·5xx·timeout): 조용히 다음 cron 재시도.
    //    이미 선점 갱신했으므로 단계 간격만큼 자연 백오프. 사용자 비노출.
    return;
  }

  // 5. 멱등 단계 전환(compare-and-set): 단계가 실제로 바뀐 경우에만 시도, 영향행=1일 때만 전환 인정.
  if (next !== prev) {
    const changed = await casStage(env, row.id, stored, next);
    if (changed) {
      if (shouldNotify(prev, next)) {
        await notifyTransition(env, deps, row, next);
      }
      // 6. 배송완료 → 알림 후 shipment 삭제(subscriptions CASCADE). 만료 판정 불필요.
      if (next === "배송완료") {
        await env.DB.prepare("DELETE FROM shipments WHERE id = ?").bind(row.id).run();
        return;
      }
    }
  }

  // 7. 만료/좀비: createdAt 기준. deactivate면 active=0 (+notify면 '분실 의심' 푸시).
  const action = lifecycleAction({ stage: next, createdAt: row.created_at, now });
  if (action.type === "deactivate") {
    await env.DB.prepare("UPDATE shipments SET active = 0 WHERE id = ?").bind(row.id).run();
    if (action.notify) {
      await notifyLost(env, deps, row);
    }
  }
}

/**
 * compare-and-set: 저장된 단계가 prev 그대로일 때만 next 로 원자 갱신.
 * 영향행이 1이면 이 실행이 전환을 차지한 것(경쟁/재실행 시 정확히 1회).
 */
async function casStage(env: Env, id: string, prev: string | null, next: Stage): Promise<boolean> {
  const r = await env.DB.prepare(
    "UPDATE shipments SET last_normalized_status = ? WHERE id = ? AND last_normalized_status IS ?",
  )
    .bind(next, id, prev)
    .run();
  return (r.meta.changes ?? 0) === 1;
}

/** 송장 구독자들의 push_token (device_id·push_token은 로그 금지). */
async function subscriberTokens(env: Env, shipmentId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT d.push_token FROM subscriptions sub JOIN devices d ON d.id = sub.device_id WHERE sub.shipment_id = ?",
  )
    .bind(shipmentId)
    .all<{ push_token: string }>();
  return results.map((r) => r.push_token);
}

/** 단계 전환 푸시 — 구독자별 buildMessage(step5)로 문구 생성 후 발송. */
async function notifyTransition(env: Env, deps: CronDeps, row: DueRow, stage: Stage): Promise<void> {
  const last4 = row.tracking_no.slice(-4);
  const messages: PushMessage[] = [];
  for (const token of await subscriberTokens(env, row.id)) {
    const msg = buildMessage(stage, { token, shipmentId: row.id, carrier: row.carrier, last4 });
    if (msg) messages.push(msg);
  }
  await deliver(env, deps, messages);
}

/** '분실 의심'(30일 미완료) 푸시 — 단계 전환이 아니라 운영성 알림이라 직접 구성. */
async function notifyLost(env: Env, deps: CronDeps, row: DueRow): Promise<void> {
  const last4 = row.tracking_no.slice(-4);
  const messages: PushMessage[] = (await subscriberTokens(env, row.id)).map((token) => ({
    to: token,
    title: `${row.carrier} · …${last4}`,
    body: "오래 변동이 없어요 — 배송 상태를 확인해 주세요",
    data: { shipment_id: row.id },
  }));
  await deliver(env, deps, messages);
}

/**
 * 발송 + ticket 보관 + 무효 토큰 정리.
 * sendPush(step5)는 입력 순서대로 ticket을 반환 → messages[i] 와 1:1.
 * ok ticket은 receipt 확인 대기로 push_tickets에 보관(ADR-010, 수신 확인 cron은 별도).
 * DeviceNotRegistered → 해당 토큰의 device 정리(push_token NOT NULL이라 행 삭제, ARCHITECTURE 토큰 위생).
 */
async function deliver(env: Env, deps: CronDeps, messages: PushMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const tickets = await sendPush(messages, {
    fetch: deps.fetch,
    expoAccessToken: env.EXPO_ACCESS_TOKEN,
  });

  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    const token = messages[i].to;
    if (ticket.status === "ok" && ticket.id) {
      stmts.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO push_tickets (ticket_id, push_token, created_at) VALUES (?, ?, ?)",
        ).bind(ticket.id, token, deps.now),
      );
    } else if (ticket.status === "error" && classifyPushError(ticket.details?.error) === "DELETE_TOKEN") {
      stmts.push(env.DB.prepare("DELETE FROM devices WHERE push_token = ?").bind(token));
    }
  }
  if (stmts.length > 0) await env.DB.batch(stmts);
}
