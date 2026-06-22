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
 *  - 배송완료 → 알림 후 보관(active=0 재폴링 중단; 사용자가 수동 삭제, ADR-005 개정).
 *  - now·fetch 주입(결정적 테스트) — Date.now()/실네트워크 호출 금지.
 *  - device_id·push_token·수령인 정보 로그/저장 금지.
 */

import type { Env } from "./index";
import { isDue, type Stage } from "./lib/polling";
import { normalizeStatus } from "./lib/normalize";
import { shouldNotify } from "./lib/notify";
import { lifecycleAction } from "./lib/lifecycle";
import { isQuietHours, isUrgentStage } from "./lib/quiet";
import { carrierName } from "./lib/carrier";
import { track, d1TokenStore } from "./tracker";
import { buildMessage, sendPush, getReceipts, classifyPushError, DELIVERY_CHANNEL_ID, type PushMessage } from "./push";

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
/** 아침 묶음 플러시 1회당 스캔/발송 상한 — send 배치(≤100)·cron subrequest 예산 보호. 초과분은 다음 fire 이월. */
const FLUSH_SCAN_LIMIT = 100;
/** 알림 기록 보존(ADR-023): 90일 경과분 sweep 기준(epoch ms 폭). */
const NOTIFICATION_RETENTION_MS = 90 * 24 * 3_600_000;
/** 알림 기록 디바이스당 보존 상한(ADR-023) — 초과 시 오래된 것부터 정리. 무한 증가 방지. (테스트가 참조 — 단일 출처) */
export const NOTIFICATION_DEVICE_CAP = 500;

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

/**
 * flushQueue collapse 결과 행 — (shipment_id, push_token)당 최신 보류 스냅샷(title·body) +
 * 발송/로깅에 필요한 JOIN 값. device_id=토큰 현재 소유자, carrier/tracking_no/active/stage=shipment 스냅샷.
 * (큐 자체는 title·body 만 저장 — ARCHITECTURE: 큐는 메시지 스냅샷만. 나머지는 flush 시점 JOIN 으로 해석.)
 */
interface FlushRow {
  shipment_id: string | null;
  push_token: string;
  title: string | null;
  body: string | null;
  created_at: number;
  device_id: string | null; // 토큰 현재 소유자(steal/삭제로 없으면 NULL → 로깅 제외)
  carrier: string | null; // shipment JOIN — carrierId 원문(미해석이면 NULL → 로깅 제외)
  tracking_no: string | null;
  active: number | null; // shipment.active — 전환 보류분(=1)/운영성·완료(=0) 판별
  stage: string | null; // shipment.last_normalized_status(전환 단계)
}

/**
 * 발송 알림 기록 1행(notifications, ADR-023) — fan-out 시점에 (device, shipment)별 1건 구성.
 * carrier 는 carrierId 원문(한글 변환은 앱). body 는 발송 메시지와 동일 소스. sent_at 은 발송 시점(deps.now).
 */
interface NotificationLog {
  deviceId: string;
  shipmentId: string;
  carrier: string;
  last4: string;
  body: string;
  stage: Stage;
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

  // 10. 아침 묶음 플러시 — 조용시간이 아니면 야간 보류분을 device·송장당 최신 1건으로 묶어 발송(PRD 알림 정책).
  if (!isQuietHours(deps.now)) {
    await flushQueue(env, deps);
  }

  // 11. 알림 기록 보존 sweep(ADR-023) — 90일 경과분 + 디바이스당 상한 정리. 조용시간 무관(시각과 독립).
  await sweepNotifications(env, deps);

  // 12. 만료된 rate_limits 윈도 정리(ADR-008 throttle 테이블 무한 증가 방지).
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
  // 단계 전환 시 기록할 status_changed_at: 전환을 일으킨 이벤트 시각(파싱 불가/누락이면 now).
  const parsedEvent = ev?.time ? Date.parse(ev.time) : NaN;
  const changedAt = Number.isNaN(parsedEvent) ? now : parsedEvent;

  // 6. 배송완료: 자동 삭제하지 않고 **보관**한다(기본 사양 — 사용자가 수동 삭제). active=0 으로 재폴링만 멈춘다.
  //    CAS(배송완료 + active=0)를 한 문장으로 원자화 → 좀비(완료·active=1) 방지 + 영향행으로 전환 차지 판정
  //    → 이긴 경우에만 정확히 1회 알림. (배송완료 자동 삭제는 다음 phase 설정 옵션 → docs/ROADMAP.md.)
  if (next === "배송완료" && prev !== "배송완료") {
    const casRes = await env.DB.prepare(
      "UPDATE shipments SET last_normalized_status = ?, status_changed_at = ?, active = 0 WHERE id = ? AND last_normalized_status IS ?",
    )
      .bind("배송완료", changedAt, row.id, stored)
      .run();
    if ((casRes.meta.changes ?? 0) === 1) {
      // 전환 차지(영향행=1) → notifyTransition 으로 fan-out(발송 + 알림 기록 1행). 긴급 → 야간에도 즉시.
      await notifyTransition(env, deps, row, "배송완료", ev?.time);
    }
    return;
  }

  // 5. 멱등 단계 전환(compare-and-set): 단계가 실제로 바뀐 경우에만, 영향행=1일 때만 전환 인정 후 알림.
  if (next !== prev) {
    const changed = await casStage(env, row.id, stored, next, changedAt);
    if (changed && shouldNotify(prev, next)) {
      await notifyTransition(env, deps, row, next, ev?.time);
    }
  }

  // 7. 만료/좀비: createdAt 기준. deactivate면 active=0 (+notify면 운영성 안내 1회). 데모 번호는 안내 제외.
  //    비활성 후엔 active=0 이라 due 대상이 아님 → 재폴링 없음 → 안내는 정확히 1회(멱등, 과알림 방지).
  //    reason 별 안내 분기: 미등록7일='번호 확인'(오타/잘못된 번호), 분실의심30일='분실 의심'(별개 경로). 예외7일은 notify:false(조용히).
  const action = lifecycleAction({ stage: next, createdAt: row.created_at, now });
  if (action.type === "deactivate") {
    await env.DB.prepare("UPDATE shipments SET active = 0 WHERE id = ?").bind(row.id).run();
    if (action.notify && row.tracking_no !== env.DEMO_TRACKING_NUMBER) {
      if (action.reason === "미등록7일") {
        await notifyCheckNumber(env, deps, row);
      } else {
        await notifyLost(env, deps, row);
      }
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
 * status_changed_at 도 같은 문장에서 전환 이벤트 시각(changedAt)으로 갱신한다(단계 전환 시에만).
 */
async function casStage(
  env: Env,
  id: string,
  prev: string | null,
  next: Stage,
  changedAt: number,
): Promise<boolean> {
  const r = await env.DB.prepare(
    "UPDATE shipments SET last_normalized_status = ?, status_changed_at = ? WHERE id = ? AND last_normalized_status IS ?",
  )
    .bind(next, changedAt, id, prev)
    .run();
  return (r.meta.changes ?? 0) === 1;
}

/**
 * 송장 구독자들의 (device_id, push_token) (둘 다 로그 금지).
 * push_token IS NOT NULL 만 — 토큰이 nullable(QA-001) 이 된 뒤 토큰 없는 구독자에게
 * sendPush({to: null}) 로 오발송/에러 내지 않도록 거른다(C1 회귀 방지).
 * sub.muted = 0 만 — 음소거한 구독은 모든 푸시(전환·운영성)에서 제외한다(ADR-020). 단계 추적(CAS)은
 * 그대로 진행되고 발송만 빠진다 — 이 함수가 모든 알림 fan-out 의 단일 소스라 여기서 거르면 발송·기록 모두 일관.
 * device_id 는 알림 기록(notifications, ADR-023) 의 키 — fan-out 시점에 토큰과 함께 안다.
 */
async function subscribers(
  env: Env,
  shipmentId: string,
): Promise<{ deviceId: string; token: string }[]> {
  const { results } = await env.DB.prepare(
    "SELECT sub.device_id AS device_id, d.push_token AS push_token FROM subscriptions sub JOIN devices d ON d.id = sub.device_id " +
      "WHERE sub.shipment_id = ? AND sub.muted = 0 AND d.push_token IS NOT NULL",
  )
    .bind(shipmentId)
    .all<{ device_id: string; push_token: string }>();
  return results.map((r) => ({ deviceId: r.device_id, token: r.push_token }));
}

/**
 * 구독자별 메시지 생성 → 발송 (notifyTransition/notifyCheckNumber/notifyLost 공용 fan-out).
 * urgent=false 인 알림은 조용시간(야간)에 deliver 가 보류 큐로 돌린다(아침 묶음 발송).
 * logMeta 가 주어지면(전환 푸시) **이 시점에 (device, shipment)별 알림 기록 1행**을 구성해 deliver 로 넘긴다
 * (ADR-023 보강②: 로깅은 fan-out 메시지 구성 시점 1회 — send 재시도와 분리, 음소거는 이미 subscribers 에서 제외).
 * 운영성 안내(번호 확인·분실 의심)는 logMeta 없이 호출 → 기록하지 않는다(전환 푸시만 기록).
 */
async function fanOut(
  env: Env,
  deps: CronDeps,
  shipmentId: string,
  build: (token: string) => PushMessage | null,
  urgent: boolean,
  logMeta?: { carrier: string; last4: string; stage: Stage },
): Promise<void> {
  const messages: PushMessage[] = [];
  const logs: NotificationLog[] = [];
  for (const { deviceId, token } of await subscribers(env, shipmentId)) {
    const msg = build(token);
    if (!msg) continue;
    messages.push(msg);
    if (logMeta) {
      logs.push({
        deviceId,
        shipmentId,
        carrier: logMeta.carrier,
        last4: logMeta.last4,
        body: msg.body,
        stage: logMeta.stage,
      });
    }
  }
  await deliver(env, deps, messages, logs, urgent);
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
  await fanOut(
    env,
    deps,
    row.id,
    (token) =>
      buildMessage(stage, {
        token,
        shipmentId: row.id,
        carrier: row.carrier,
        last4,
        eventTimeMs,
        nowMs: deps.now,
      }),
    isUrgentStage(stage), // 예외·배송완료만 야간 즉시, 그 외 단계 전환은 야간 보류
    { carrier: row.carrier, last4, stage }, // 전환 푸시 → 알림 기록(ADR-023). carrier 는 carrierId 원문(저장은 id, #9).
  );
}

/** 운영성 안내 푸시(번호 확인·분실 의심) — 단계 전환이 아니라 직접 구성하는 비긴급(야간 보류) 알림. body 만 다르다. */
async function notifyOperational(env: Env, deps: CronDeps, row: DueRow, body: string): Promise<void> {
  const last4 = row.tracking_no.slice(-4);
  await fanOut(
    env,
    deps,
    row.id,
    (token) => ({
      to: token,
      title: `${carrierName(row.carrier)} · …${last4}`, // 한글 택배사명(이슈 #9, 전환 푸시와 일관)
      body,
      data: { shipment_id: row.id },
      channelId: DELIVERY_CHANNEL_ID,
    }),
    false, // 운영성 안내 — 비긴급(야간 보류 대상). logMeta 없음 → 알림 기록 안 함(전환 푸시만 기록).
  );
}

/** '번호 확인'(미등록 7일) 안내 — 7일째 데이터 미수신(오타/잘못된 번호 의심). */
async function notifyCheckNumber(env: Env, deps: CronDeps, row: DueRow): Promise<void> {
  await notifyOperational(env, deps, row, "운송장 번호를 확인해 주세요 — 7일째 배송 정보가 없어요");
}

/** '분실 의심'(30일 미완료) 푸시 — 단계 전환이 아니라 운영성 알림. */
async function notifyLost(env: Env, deps: CronDeps, row: DueRow): Promise<void> {
  await notifyOperational(env, deps, row, "오래 변동이 없어요 — 배송 상태를 확인해 주세요");
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
 * 알림 발송 게이트 — 조용시간(야간 KST 22–08) + 비긴급이면 보류 큐에 적재(아침 묶음 발송), 아니면 즉시 발송.
 * 긴급(예외·배송완료, urgent=true)은 야간에도 즉시 발송한다(PRD 알림 정책). 보류는 "발송 시점"만 미룰 뿐
 * 단계 상태(CAS)는 이미 적용됐으므로 멱등은 깨지지 않는다.
 */
async function deliver(
  env: Env,
  deps: CronDeps,
  messages: PushMessage[],
  logs: NotificationLog[],
  urgent: boolean,
): Promise<void> {
  if (messages.length === 0) return;
  if (!urgent && isQuietHours(deps.now)) {
    await enqueue(env, deps, messages);
    return; // 야간 보류 → 기록은 보류분을 실제 발송하는 flush 시점(step2). 적재 시점 아님(ADR-023 보강②).
  }
  await sendAndRecord(env, deps, messages);
  await logNotifications(env, deps, logs); // 즉시 발송분만 기록 — sendAndRecord 뒤(best-effort).
}

/**
 * 발송 알림 기록(notifications, ADR-023) — fan-out 에서 구성된 (device, shipment)별 1행 INSERT.
 * **best-effort**: INSERT 실패는 푸시 발송·전환 CAS 를 막지 않는다(이미 끝남) → try/catch 로 삼킨다.
 * 로깅이 실패로 알림을 못 가게 하는 것이 더 나쁘기 때문(보강②). device_id·push_token 은 콘솔 로그 금지.
 */
async function logNotifications(env: Env, deps: CronDeps, logs: NotificationLog[]): Promise<void> {
  if (logs.length === 0) return;
  try {
    await env.DB.batch(
      logs.map((l) =>
        env.DB.prepare(
          "INSERT INTO notifications (id, device_id, shipment_id, carrier, last4, body, stage, sent_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(crypto.randomUUID(), l.deviceId, l.shipmentId, l.carrier, l.last4, l.body, l.stage, deps.now),
      ),
    );
  } catch (err) {
    console.error("[cron] notifications 로깅 실패(best-effort)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 조용시간 비긴급 알림을 보류 큐에 적재 — 메시지 스냅샷(title·body)을 저장(아침에 재구성 안 함, E2). */
async function enqueue(env: Env, deps: CronDeps, messages: PushMessage[]): Promise<void> {
  await env.DB.batch(
    messages.map((m) =>
      env.DB.prepare(
        "INSERT INTO notification_queue (id, shipment_id, push_token, title, body, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(crypto.randomUUID(), m.data.shipment_id, m.to, m.title, m.body, deps.now),
    ),
  );
}

/**
 * 아침(주간) 묶음 플러시 — 야간 보류분을 (송장, push_token)당 **최신 1건**으로 collapse 해 발송 후 큐 삭제.
 * 한 송장 야간 다중 전환(등록→집화→배송출발)은 최신 단계 1건만 보낸다(과알림 방지, PRD "묶어 전달").
 * (R2) 경계 stale 은 감수: 스냅샷 그대로 발송하고 현재 단계와 재대조하지 않는다(단순·결정적 유지).
 * subrequest 예산 보호: 1회 ≤FLUSH_SCAN_LIMIT 행만 처리하고(send 배치 ≤100) 초과분은 다음 fire 로 이월.
 * 송장 소멸(완료·orphan·DELETE /me) 보류분은 FK CASCADE/토큰 폐기로 이미 정리돼 죽은 토큰 발송을 막는다.
 */
async function flushQueue(env: Env, deps: CronDeps): Promise<void> {
  // collapse 와 동시에 device(토큰 소유자)·shipment(carrier·번호·active·단계)를 JOIN 해 발송·로깅 값을 한 번에 얻는다.
  // JOIN 키(push_token·shipment_id)는 GROUP BY 키라 그룹 내 상수 → 조인 값은 결정적, title·body 는 MAX 행 스냅샷.
  const { results } = await env.DB.prepare(
    "SELECT q.shipment_id AS shipment_id, q.push_token AS push_token, q.title AS title, q.body AS body, " +
      "MAX(q.created_at) AS created_at, d.id AS device_id, " +
      "s.carrier AS carrier, s.tracking_no AS tracking_no, s.active AS active, s.last_normalized_status AS stage " +
      "FROM notification_queue q " +
      "LEFT JOIN devices d ON d.push_token = q.push_token " +
      "LEFT JOIN shipments s ON s.id = q.shipment_id " +
      "GROUP BY q.shipment_id, q.push_token LIMIT ?",
  )
    .bind(FLUSH_SCAN_LIMIT)
    .all<FlushRow>();
  if (results.length === 0) return;

  // 모든 보류분을 발송(at-least-once — 토큰/송장 미해석이어도 sendPush 가 무효 토큰을 정리).
  const messages: PushMessage[] = results.map((r) => ({
    to: r.push_token,
    title: r.title ?? "",
    body: r.body ?? "",
    data: { shipment_id: r.shipment_id ?? "" },
    // 채널은 상수라 큐에 스냅샷하지 않고 발송 시 부여(title·body 만 보류 큐에 저장).
    channelId: DELIVERY_CHANNEL_ID,
  }));

  // flush 시점 알림 기록(ADR-023 보강②) — 사용자가 받는 시점에 (device, shipment)별 1행.
  //  - device_id = 토큰 현재 소유자(d.id). 양도분은 steal(F3)에서 큐가 이미 정리돼 여기 없다(교차 누설 없음).
  //  - **전환 푸시만 기록(step1 일관)**: 운영성 안내(번호확인·분실의심)는 항상 shipment 를 active=0 으로 두고
  //    발생하므로 active=1(=단계 전환 보류분)만 로깅한다. 드문 경계(전환과 동시 비활성)는 미기록 감수(best-effort).
  //  - carrier(=carrierId)·last4·stage 는 shipment JOIN 스냅샷, body 는 큐 스냅샷, sent_at = flush now. INSERT 는 step1 헬퍼 재사용.
  const logs: NotificationLog[] = [];
  for (const r of results) {
    if (!r.device_id || !r.shipment_id || !r.carrier || !r.tracking_no || r.active !== 1) continue;
    logs.push({
      deviceId: r.device_id,
      shipmentId: r.shipment_id,
      carrier: r.carrier,
      last4: r.tracking_no.slice(-4),
      body: r.body ?? "",
      stage: stageOf(r.stage),
    });
  }

  // 발송 먼저(실패해도 행 보존 = at-least-once) → 기록(best-effort) → 스캔한 행 전체 삭제(collapse 로 버린 오래된 보류분 포함).
  await sendAndRecord(env, deps, messages);
  await logNotifications(env, deps, logs);
  await env.DB.batch(
    results.map((r) =>
      env.DB.prepare("DELETE FROM notification_queue WHERE shipment_id = ? AND push_token = ?").bind(
        r.shipment_id,
        r.push_token,
      ),
    ),
  );
}

/**
 * 알림 기록 보존 sweep(ADR-023) — notifications 무한 증가 방지. cron 매 실행 시 멱등·저비용 정리:
 *  1) 90일 경과분 삭제(sent_at < now-90일).
 *  2) 디바이스당 상한 초과분: device_id 별 최신 NOTIFICATION_DEVICE_CAP 개만 보존, 나머지(오래된 것) 삭제.
 * now 주입(결정적). batch 내 순차 실행이라 ②는 ①후 잔여에 적용된다. 다른 device 행은 건드리지 않는다(기기별 독립 보존).
 * **best-effort**: 비핵심 유지보수라 sweep 실패가 cron 의 다른 작업(폴링·발송)을 막지 않게 try/catch 로 격리한다(로깅과 동일 철학).
 */
async function sweepNotifications(env: Env, deps: CronDeps): Promise<void> {
  try {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM notifications WHERE sent_at < ?").bind(deps.now - NOTIFICATION_RETENTION_MS),
      // device_id 별 sent_at DESC(동률은 id DESC tie-break) 순위가 상한 초과면 삭제 → 최신 상한 개만 남는다(결정적).
      env.DB.prepare(
        "DELETE FROM notifications WHERE id IN (" +
          "SELECT id FROM (" +
          "SELECT id, ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY sent_at DESC, id DESC) AS rn FROM notifications" +
          ") WHERE rn > ?)",
      ).bind(NOTIFICATION_DEVICE_CAP),
    ]);
  } catch (err) {
    console.error("[cron] notifications 보존 sweep 실패(best-effort)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * 실제 발송 + ticket 보관 + 무효 토큰 정리(조용시간 판정 없음 — 호출자가 보류/즉시를 이미 결정).
 * sendPush(step5)는 입력 순서와 1:1 정렬된 ticket을 반환 → messages[i] 와 짝이 보장된다(배치 패딩).
 * ok ticket은 receipt 확인 대기로 push_tickets에 보관(ADR-010, sweepReceipts가 확인·폐기).
 * DeviceNotRegistered → 해당 토큰을 가진 device 행 삭제(무효 토큰 정리, ARCHITECTURE 토큰 위생).
 */
async function sendAndRecord(env: Env, deps: CronDeps, messages: PushMessage[]): Promise<void> {
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
