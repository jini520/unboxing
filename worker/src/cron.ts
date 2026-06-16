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
import { buildMessage, sendPush, getReceipts, classifyPushError, type PushMessage } from "./push";

/** 1회 실행당 외부 track subrequest 상한(ADR-012 cron 한도). due 처리 건수를 이 값으로 제한. */
const MAX_BATCH = 50;
/** due 후보 SQL 1차 제한 — 가장 짧은 단계(배송출발=60분) 간격보다 오래 안 폴링된 행만(테이블 전체 적재 방지). */
const MIN_POLL_INTERVAL_MS = 60 * 60_000;
/** SQL 스캔 상한. 정렬상 미폴링·오래된 행이 먼저라 due가 우선 포함된다(초과분은 다음 fire 이월). */
const DUE_SCAN_LIMIT = 200;
/** 폴링 실패 백오프: base(다음 fire ~15분)부터 지수, 상한 6h. fail_count/next_retry_at 컬럼 사용. */
const BACKOFF_BASE_MS = 15 * 60_000;
const BACKOFF_MAX_MS = 6 * 3_600_000;
/** receipt 확인은 send 후 ~15분 경과 ticket만(ADR-010 2단계). 1회 getReceipts ≤1000건. */
const RECEIPT_MIN_AGE_MS = 15 * 60_000;
const RECEIPT_SWEEP_LIMIT = 1000;
/** 등록 레이트 윈도(10분)의 2배 지난 rate_limits 행 정리(테이블 무한 증가 방지, ADR-008). */
const RATE_LIMIT_RETENTION_MS = 20 * 60_000;

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
  fail_count: number;
  next_retry_at: number | null;
}

/** 저장된 status(문자열|null)를 Stage로 — null(미폴링)은 '미등록'으로 본다. */
function stageOf(status: string | null): Stage {
  return (status ?? "미등록") as Stage;
}

/** 연속 실패 횟수 → 백오프(ms). 지수, 상한 BACKOFF_MAX_MS. */
function backoffMs(failCount: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, failCount - 1), BACKOFF_MAX_MS);
}

/** due 송장 배치 폴링 1회 실행 + receipt sweep. */
export async function runPollingBatch(env: Env, deps: CronDeps): Promise<void> {
  // 1. due 조회: active=1 AND (미폴링 또는 최소간격 경과) AND (백오프 해제) → '배송출발' 우선·오래된 순.
  //    SQL로 1차로 좁혀(테이블 전체 적재 방지) JS isDue로 단계별 간격 정밀 판정 후 ≤50건.
  const { results } = await env.DB.prepare(
    "SELECT id, carrier, tracking_no, last_normalized_status, last_polled_at, created_at, fail_count, next_retry_at " +
      "FROM shipments WHERE active = 1 " +
      "AND (last_polled_at IS NULL OR last_polled_at <= ?) " +
      "AND (next_retry_at IS NULL OR next_retry_at <= ?) " +
      "ORDER BY CASE WHEN last_normalized_status = '배송출발' THEN 0 ELSE 1 END, last_polled_at ASC " +
      "LIMIT ?",
  )
    .bind(deps.now - MIN_POLL_INTERVAL_MS, deps.now, DUE_SCAN_LIMIT)
    .all<DueRow>();

  const due = results
    .filter((r) => isDue(stageOf(r.last_normalized_status), r.last_polled_at, deps.now))
    .slice(0, MAX_BATCH);

  for (const row of due) {
    await pollOne(env, deps, row);
  }

  // 9. receipt 확인(ADR-010 2단계): ~15분 지난 ticket의 전달 결과 확인 → 무효 토큰 정리 + ticket 폐기.
  await sweepReceipts(env, deps);

  // 10. 만료된 rate_limits 윈도 정리(ADR-008 throttle 테이블 무한 증가 방지).
  await env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?")
    .bind(deps.now - RATE_LIMIT_RETENTION_MS)
    .run();
}

/** 송장 1건: 선점 갱신 → track → 정규화 → 멱등 전환/알림 → 만료. 외부 실패는 백오프. */
async function pollOne(env: Env, deps: CronDeps, row: DueRow): Promise<void> {
  const { now } = deps;
  const stored = row.last_normalized_status; // CAS 비교용 원본(null 가능)
  const prev = stageOf(stored);

  // 2. 선점 갱신: 처리 시작 시 last_polled_at=now 로 먼저 갱신(중첩/중복 방지, ADR-012).
  await env.DB.prepare("UPDATE shipments SET last_polled_at = ? WHERE id = ?").bind(now, row.id).run();

  // 3. track(외부 1회). 토큰은 D1 캐시(ADR-013). 데모 번호는 step4가 외부 호출 우회.
  let result: Awaited<ReturnType<typeof track>>;
  try {
    result = await track(row.carrier, row.tracking_no, {
      fetch: deps.fetch,
      now,
      store: d1TokenStore(env.DB),
      clientId: env.DELIVERY_TRACKER_CLIENT_ID,
      clientSecret: env.DELIVERY_TRACKER_CLIENT_SECRET,
      demoTrackingNumber: env.DEMO_TRACKING_NUMBER,
    });
  } catch (err) {
    // 8. 외부 오류(UNAUTHENTICATED 재인증 실패·429·5xx·timeout): 선점 갱신 원복 + 백오프(다음 fire 재시도).
    await onPollError(env, deps, row, err);
    return;
  }

  // 성공 → 백오프 상태가 있었다면 해제.
  if (row.fail_count > 0) {
    await env.DB.prepare("UPDATE shipments SET fail_count = 0, next_retry_at = NULL WHERE id = ?")
      .bind(row.id)
      .run();
  }

  // 4. 정규화: lastEvent 우선, 없으면 events 최신값으로 폴백(upstream이 lastEvent를 비워도 단계 회귀 방지).
  const ev = result.lastEvent ?? result.events[result.events.length - 1];
  const next = normalizeStatus(ev?.statusCode);

  // 6. 배송완료: 토큰을 먼저 모으고(삭제 시 CASCADE로 사라짐) → delete-if-prev 로 CAS+삭제를 한 문장에 원자화
  //    (좀비 방지) → 이긴 경우에만 알림. ADR-005(완료 즉시 삭제).
  if (next === "배송완료" && prev !== "배송완료") {
    // 토큰을 먼저 모은다(삭제 시 subscriptions가 CASCADE로 사라짐).
    const tokens = await subscriberTokens(env, row.id);
    // CAS(배송완료)+삭제를 한 트랜잭션(batch)으로 원자화 — 좀비(배송완료·active=1 잔존) 방지.
    // 전환을 차지했는지는 UPDATE의 영향행으로 판정(경쟁/재실행에도 정확히 1회 발송).
    const [casRes] = await env.DB.batch([
      env.DB.prepare(
        "UPDATE shipments SET last_normalized_status = ? WHERE id = ? AND last_normalized_status IS ?",
      ).bind("배송완료", row.id, stored),
      env.DB.prepare("DELETE FROM shipments WHERE id = ? AND last_normalized_status = ?").bind(
        row.id,
        "배송완료",
      ),
    ]);
    if ((casRes.meta.changes ?? 0) === 1) {
      const last4 = row.tracking_no.slice(-4);
      const messages = tokens
        .map((token) => buildMessage("배송완료", { token, shipmentId: row.id, carrier: row.carrier, last4 }))
        .filter((m): m is PushMessage => m !== null);
      await deliver(env, deps, messages);
    }
    return;
  }

  // 5. 멱등 단계 전환(compare-and-set): 단계가 실제로 바뀐 경우에만, 영향행=1일 때만 전환 인정 후 알림.
  if (next !== prev) {
    const changed = await casStage(env, row.id, stored, next);
    if (changed && shouldNotify(prev, next)) {
      await notifyTransition(env, deps, row, next, ev?.time);
    }
  }

  // 7. 만료/좀비: createdAt 기준. deactivate면 active=0 (+notify면 '분실 의심' 푸시). 데모 번호는 분실 알림 제외.
  const action = lifecycleAction({ stage: next, createdAt: row.created_at, now });
  if (action.type === "deactivate") {
    await env.DB.prepare("UPDATE shipments SET active = 0 WHERE id = ?").bind(row.id).run();
    if (action.notify && row.tracking_no !== env.DEMO_TRACKING_NUMBER) {
      await notifyLost(env, deps, row);
    }
  }
}

/** 외부 폴링 실패: 선점 갱신 원복(다음 fire 재시도) + fail_count 증가 + next_retry_at 백오프. 분류해 로깅. */
async function onPollError(env: Env, deps: CronDeps, row: DueRow, err: unknown): Promise<void> {
  const failCount = row.fail_count + 1;
  await env.DB.prepare(
    "UPDATE shipments SET last_polled_at = ?, fail_count = ?, next_retry_at = ? WHERE id = ?",
  )
    .bind(row.last_polled_at, failCount, deps.now + backoffMs(failCount), row.id)
    .run();
  logPollError(row, err, failCount);
}

/**
 * 폴링 실패 로깅(관측성). device_id·push_token·수령인·tracking_no·시크릿은 남기지 않는다.
 * 자격증명 의심(UNAUTHENTICATED·토큰 발급 실패)은 [ALERT] 태그로 — ADR-013 21일 만료 감지용.
 */
function logPollError(row: DueRow, err: unknown, failCount: number): void {
  const msg = err instanceof Error ? err.message : String(err);
  const credential = /UNAUTHENTICATED|토큰 발급 실패|InvalidCredentials/i.test(msg);
  console.error(credential ? "[ALERT] tracker 자격증명 의심" : "[cron] track 실패", {
    carrier: row.carrier,
    failCount,
    error: msg,
  });
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

/** 구독자별 메시지 생성 → 발송 (notifyTransition/notifyLost 공용 fan-out). */
async function fanOut(
  env: Env,
  deps: CronDeps,
  shipmentId: string,
  build: (token: string) => PushMessage | null,
): Promise<void> {
  const messages: PushMessage[] = [];
  for (const token of await subscriberTokens(env, shipmentId)) {
    const msg = build(token);
    if (msg) messages.push(msg);
  }
  await deliver(env, deps, messages);
}

/** 단계 전환 푸시 — 구독자별 buildMessage(step5). eventTime으로 '오늘 도착'(KST) 판정. */
async function notifyTransition(
  env: Env,
  deps: CronDeps,
  row: DueRow,
  stage: Stage,
  eventTime?: string,
): Promise<void> {
  const last4 = row.tracking_no.slice(-4);
  const parsed = eventTime ? Date.parse(eventTime) : NaN;
  const eventTimeMs = Number.isNaN(parsed) ? undefined : parsed;
  await fanOut(env, deps, row.id, (token) =>
    buildMessage(stage, {
      token,
      shipmentId: row.id,
      carrier: row.carrier,
      last4,
      eventTimeMs,
      nowMs: deps.now,
    }),
  );
}

/** '분실 의심'(30일 미완료) 푸시 — 단계 전환이 아니라 운영성 알림이라 직접 구성. */
async function notifyLost(env: Env, deps: CronDeps, row: DueRow): Promise<void> {
  const last4 = row.tracking_no.slice(-4);
  await fanOut(env, deps, row.id, (token) => ({
    to: token,
    title: `${row.carrier} · …${last4}`,
    body: "오래 변동이 없어요 — 배송 상태를 확인해 주세요",
    data: { shipment_id: row.id },
  }));
}

/**
 * receipt sweep(ADR-010 2단계): ~15분 지난 ticket의 전달 결과를 getReceipts로 확인한다.
 * DeviceNotRegistered → 해당 토큰 device 정리. 결과가 나온 ticket은 push_tickets에서 폐기(무한 증가 방지).
 */
async function sweepReceipts(env: Env, deps: CronDeps): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT ticket_id, push_token FROM push_tickets WHERE created_at <= ? LIMIT ?",
  )
    .bind(deps.now - RECEIPT_MIN_AGE_MS, RECEIPT_SWEEP_LIMIT)
    .all<{ ticket_id: string; push_token: string }>();
  if (results.length === 0) return;

  const tokenOf = new Map(results.map((r) => [r.ticket_id, r.push_token]));
  const receipts = await getReceipts([...tokenOf.keys()], {
    fetch: deps.fetch,
    expoAccessToken: env.EXPO_ACCESS_TOKEN,
  });

  const stmts: D1PreparedStatement[] = [];
  for (const [ticketId, token] of tokenOf) {
    const receipt = receipts[ticketId];
    if (!receipt) continue; // 아직 결과 없음 → 다음 sweep까지 보관.
    if (receipt.status === "error" && classifyPushError(receipt.details?.error) === "DELETE_TOKEN") {
      stmts.push(env.DB.prepare("DELETE FROM devices WHERE push_token = ?").bind(token));
    }
    stmts.push(env.DB.prepare("DELETE FROM push_tickets WHERE ticket_id = ?").bind(ticketId));
  }
  if (stmts.length > 0) await env.DB.batch(stmts);
}

/**
 * 발송 + ticket 보관 + 무효 토큰 정리.
 * sendPush(step5)는 입력 순서와 1:1 정렬된 ticket을 반환 → messages[i] 와 짝이 보장된다(배치 패딩).
 * ok ticket은 receipt 확인 대기로 push_tickets에 보관(ADR-010, sweepReceipts가 확인·폐기).
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
