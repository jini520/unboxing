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
import { isDue, WEBHOOK_FALLBACK_MS, type Stage } from "./lib/polling";
import { normalizeStatus } from "./lib/normalize";
import { shouldNotify } from "./lib/notify";
import { lifecycleAction } from "./lib/lifecycle";
import {
  shouldRegisterWebhook,
  reregisterDue,
  webhookExpiration,
  WEBHOOK_TTL_MS,
  REREGISTER_THRESHOLD_MS,
} from "./lib/webhook";
import { carrierName } from "./lib/carrier";
import { track, registerTrackWebhook, d1TokenStore, type TrackerDeps } from "./tracker";
import { buildMessage, sendPush, getReceipts, classifyPushError, DELIVERY_CHANNEL_ID, type PushMessage } from "./push";

/** 1회 실행당 외부 track subrequest 상한(ADR-012 cron 한도). due 처리 건수를 이 값으로 제한. */
const MAX_BATCH = 50;
/** due 후보 SQL 1차 바닥 — 가장 짧은 간격(미등록 낮 15분, ADR-031)보다 오래 안 폴링된 행만(테이블 전체 적재 방지). 정밀 판정은 isDue. */
const MIN_POLL_INTERVAL_MS = 15 * 60_000;
/** SQL 스캔 상한. 정렬상 미폴링·오래된 행이 먼저라 due가 우선 포함된다(초과분은 다음 fire 이월). */
const DUE_SCAN_LIMIT = 200;
/** lifecycle 독립 sweep(T7) 1회 스캔 상한. active 전체를 훑되 무한 적재 방지(초과분은 다음 fire). */
const LIFECYCLE_SCAN_LIMIT = 500;
/** 폴링 실패 백오프: base(다음 fire ~15분)부터 지수, 상한 6h. fail_count/next_retry_at 컬럼 사용. */
const BACKOFF_BASE_MS = 15 * 60_000;
const BACKOFF_MAX_MS = 6 * 3_600_000;
/** receipt 확인은 send 후 ~15분 경과 ticket만(ADR-010 2단계). 1회 getReceipts ≤1000건. */
const RECEIPT_MIN_AGE_MS = 15 * 60_000;
const RECEIPT_SWEEP_LIMIT = 1000;
/** 등록 레이트 윈도(10분)의 2배 지난 rate_limits 행 정리(테이블 무한 증가 방지, ADR-008). */
const RATE_LIMIT_RETENTION_MS = 20 * 60_000;
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
  // webhook 만료 epoch ms(NULL=미등록→적응형 폴백 폴링·등록분 ~12h, ADR-028). pollDue 의 isDue 4번째 인자로 소비.
  webhook_expires_at: number | null;
}

/**
 * track → CAS → 전환 푸시에 필요한 최소 송장 참조 — **폴백 폴링(DueRow)·webhook 콜백 공용**.
 * processShipmentUpdate 가 소비한다(복제 금지). DueRow 는 이 필드를 모두 포함하므로 그대로 전달된다.
 */
export interface ShipmentUpdateRow {
  id: string;
  carrier: string;
  tracking_no: string;
  last_normalized_status: string | null;
}

/** lifecycle 독립 sweep(T7) 판정 행 — 만료/좀비 판단에 필요한 최소 필드. */
interface LifecycleRow {
  id: string;
  carrier: string;
  tracking_no: string;
  last_normalized_status: string | null;
  created_at: number;
}

/**
 * cron webhook (재)등록 sweep 컨텍스트 — 자격증명·콜백 시크릿·공개 베이스 URL 가드(셋 중 하나라도 없으면 null).
 * null 이면 등록/재등록 sweep 을 보류한다(폴백 폴링이 흡수). callbackUrl=/webhooks/track/<secret>(ADR-029 시크릿 경로).
 */
interface WebhookRegContext {
  trackerDeps: TrackerDeps;
  callbackUrl: string;
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

/**
 * cron 1회 실행 — webhook-first 전환 후 **유지보수 + 저빈도 폴백**(ADR-028). 신선도 1차는 webhook 콜백.
 * 외부 subrequest 예산(≤MAX_BATCH·10 req/s)을 우선순위로 나눠 쓰고 초과분은 다음 fire 이월:
 *   ① webhook 24h 재등록(생존=신선도 핵심) → ② 조건부 폴백 폴링 → ③ webhook 등록 sweep(마이그레이션/승급/재시도).
 * lifecycle 독립 sweep 은 폴링과 분리(T7)돼 track/register 예산을 쓰지 않는다. receipt/보존/rate_limits 도 예산 밖(자체 상한).
 */
export async function runPollingBatch(env: Env, deps: CronDeps): Promise<void> {
  let budget = MAX_BATCH;
  // 등록/재등록 컨텍스트(자격증명·시크릿·베이스 URL 가드). 없으면 등록 sweep 보류 → 폴백 폴링이 흡수.
  const reg = webhookRegContext(env, deps);

  // ① webhook 24h 재등록 sweep — 만료 임박(<24h) active 송장만(예산 우선: 살아있는 webhook 이 신선도 핵심).
  if (reg) budget -= await sweepReregisterWebhooks(env, deps, reg, budget);

  // ② 조건부 폴백 due 폴링 — webhook 등록분 ~12h·미등록분 적응형(isDue 단일 출처). 남은 예산 내(≤budget).
  budget -= await pollDue(env, deps, budget);

  // ③ lifecycle 독립 sweep(T7) — **폴링 뒤**에 둬 방금 갱신된 단계를 읽고, **등록 sweep 앞**에 둬 비활성된 송장을
  //    등록 대상에서 뺀다. webhook 송장은 무변화라 재폴링이 거의 없어, 폴링 루프 안에서 판정하면 만료가 누락된다(W11).
  await sweepLifecycle(env, deps);

  // ④ webhook 등록 sweep — active·NULL·등록가능 송장을 due 무관 등록(즉시 마이그레이션·승급·재시도). 남은 예산 내.
  if (reg) budget -= await sweepRegisterWebhooks(env, deps, reg, budget);

  // ⑤ receipt 확인(ADR-010 2단계): ~15분 지난 ticket의 전달 결과 확인 → 무효 토큰 정리 + ticket 폐기.
  await sweepReceipts(env, deps);

  // ⑥ 알림 기록 보존 sweep(ADR-023) — 90일 경과분 + 디바이스당 상한 정리.
  await sweepNotifications(env, deps);

  // ⑦ 만료된 rate_limits 윈도 정리(ADR-008 throttle 테이블 무한 증가 방지).
  await env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?")
    .bind(deps.now - RATE_LIMIT_RETENTION_MS)
    .run();
}

/**
 * cron 의 webhook (재)등록 컨텍스트. 자격증명·콜백 시크릿·공개 베이스 URL 중 하나라도 없으면 null
 * (등록 sweep 보류 → 폴백 폴링이 흡수). deps.fetch 는 scheduled 진입에서 fetch.bind(globalThis) 된 것(T1·P-1) —
 * track 과 **같은 deps 구성**을 재사용해 바인딩 누락을 구조적으로 막는다. 시크릿 경로·운송장번호는 로그 금지(T6).
 */
function webhookRegContext(env: Env, deps: CronDeps): WebhookRegContext | null {
  if (!env.WEBHOOK_CALLBACK_SECRET || !env.WEBHOOK_CALLBACK_BASE_URL) return null;
  if (!env.DELIVERY_TRACKER_CLIENT_ID || !env.DELIVERY_TRACKER_CLIENT_SECRET) return null;
  return {
    trackerDeps: {
      fetch: deps.fetch,
      now: deps.now,
      store: d1TokenStore(env.DB),
      clientId: env.DELIVERY_TRACKER_CLIENT_ID,
      clientSecret: env.DELIVERY_TRACKER_CLIENT_SECRET,
    },
    callbackUrl: `${env.WEBHOOK_CALLBACK_BASE_URL}/webhooks/track/${env.WEBHOOK_CALLBACK_SECRET}`,
  };
}

/**
 * 조건부 폴백 due 폴링(ADR-028) — budget 만큼만 외부 호출(예산 공유). 반환 = 폴링한 건수(소비 예산).
 * due 조회: active=1 AND 백오프 해제 AND (미폴링 | 미등록분[NULL] 적응형 경과 | webhook 등록분 ~12h 경과).
 * SQL 1차로 좁혀(webhook 분이 12h 전엔 안 걸리게) JS isDue(…, webhook_expires_at)로 단계별 정밀 판정 후 ≤budget.
 */
async function pollDue(env: Env, deps: CronDeps, budget: number): Promise<number> {
  if (budget <= 0) return 0;
  const { results } = await env.DB.prepare(
    "SELECT id, carrier, tracking_no, last_normalized_status, last_polled_at, created_at, fail_count, next_retry_at, webhook_expires_at " +
      "FROM shipments WHERE active = 1 " +
      "AND (last_polled_at IS NULL " +
      "OR (webhook_expires_at IS NULL AND last_polled_at <= ?) " +
      "OR (webhook_expires_at IS NOT NULL AND last_polled_at <= ?)) " +
      "AND (next_retry_at IS NULL OR next_retry_at <= ?) " +
      "ORDER BY CASE WHEN last_normalized_status = '배송출발' THEN 0 ELSE 1 END, last_polled_at ASC " +
      "LIMIT ?",
  )
    .bind(deps.now - MIN_POLL_INTERVAL_MS, deps.now - WEBHOOK_FALLBACK_MS, deps.now, DUE_SCAN_LIMIT)
    .all<DueRow>();

  const due = results
    .filter((r) => isDue(stageOf(r.last_normalized_status), r.last_polled_at, deps.now, r.webhook_expires_at))
    .slice(0, budget);

  for (const row of due) {
    await pollOne(env, deps, row);
  }
  return due.length;
}

/**
 * webhook 24h 재등록 sweep(ADR-028) — 만료 임박(<24h)·active 송장의 webhook 을 48h 앞으로 재등록.
 * SQL 로 임박분만 1차로 좁히고 reregisterDue(단일 출처)로 확정한다. budget 만큼만(예산 우선). 반환 = 시도 건수(소비 예산).
 * 비active·여유·NULL 은 제외(비active 는 재등록 안 돼 ≤48h 자연 만료로 1000 슬롯 회수 — 슬롯 위생).
 */
async function sweepReregisterWebhooks(
  env: Env,
  deps: CronDeps,
  reg: WebhookRegContext,
  budget: number,
): Promise<number> {
  if (budget <= 0) return 0;
  const { results } = await env.DB.prepare(
    "SELECT id, carrier, tracking_no, webhook_expires_at FROM shipments " +
      "WHERE active = 1 AND webhook_expires_at IS NOT NULL AND webhook_expires_at < ? " +
      "ORDER BY webhook_expires_at ASC LIMIT ?",
  )
    .bind(deps.now + REREGISTER_THRESHOLD_MS, DUE_SCAN_LIMIT)
    .all<{ id: string; carrier: string; tracking_no: string; webhook_expires_at: number | null }>();

  let used = 0;
  for (const row of results) {
    if (used >= budget) break;
    if (!reregisterDue(row.webhook_expires_at, deps.now)) continue;
    used += 1;
    await registerWebhook(env, deps, reg, row.id, row.carrier, row.tracking_no);
  }
  return used;
}

/**
 * webhook 등록 sweep(ADR-028) — active·webhook_expires_at NULL·등록 가능 단계 송장을 **due 무관** 매 fire 등록.
 * 하나의 sweep 이 ① 즉시 마이그레이션(운영 D1 기존 NULL) ② 승급(미등록→첫 이벤트 후) ③ 등록 실패 NULL 재시도를 덮는다.
 * 미등록(이벤트0)·배송완료·비active 는 shouldRegisterWebhook=false → 제외(미등록은 폴링이 첫 이벤트까지 적응형 커버).
 * 예산 막내(재등록·폴백 뒤) — budget 만큼만, 초과분은 다음 fire 이월(W10). 등록되면 due 간격이 ~12h 로 낙하.
 */
async function sweepRegisterWebhooks(
  env: Env,
  deps: CronDeps,
  reg: WebhookRegContext,
  budget: number,
): Promise<number> {
  if (budget <= 0) return 0;
  const { results } = await env.DB.prepare(
    "SELECT id, carrier, tracking_no, last_normalized_status FROM shipments " +
      "WHERE active = 1 AND webhook_expires_at IS NULL " +
      "AND last_normalized_status IS NOT NULL AND last_normalized_status NOT IN ('미등록', '배송완료') " +
      "LIMIT ?",
  )
    .bind(DUE_SCAN_LIMIT)
    .all<{ id: string; carrier: string; tracking_no: string; last_normalized_status: string | null }>();

  let used = 0;
  for (const row of results) {
    if (used >= budget) break;
    // SQL 로 1차로 좁혔지만 shouldRegisterWebhook 을 단일 출처로 재확인(등록 가능 단계 판정 드리프트 방지).
    if (!shouldRegisterWebhook(stageOf(row.last_normalized_status), true, null, deps.now)) continue;
    used += 1;
    await registerWebhook(env, deps, reg, row.id, row.carrier, row.tracking_no);
  }
  return used;
}

/**
 * registerTrackWebhook 1회 + 성공 시 webhook_expires_at set(now+48h). 실패는 삼킨다(NULL 유지 → 폴백 흡수, W3·W4·W10).
 * fetch 는 reg.trackerDeps(=deps.fetch 바인딩, T1·P-1). 시크릿 경로·운송장번호는 로그 금지(T6).
 */
async function registerWebhook(
  env: Env,
  deps: CronDeps,
  reg: WebhookRegContext,
  shipmentId: string,
  carrier: string,
  trackingNo: string,
): Promise<void> {
  try {
    const res = await registerTrackWebhook(
      carrier,
      trackingNo,
      reg.callbackUrl,
      webhookExpiration(deps.now),
      reg.trackerDeps,
    );
    if (res.ok) {
      await env.DB.prepare("UPDATE shipments SET webhook_expires_at = ? WHERE id = ?")
        .bind(deps.now + WEBHOOK_TTL_MS, shipmentId)
        .run();
    }
  } catch {
    // 삼킴 — webhook_expires_at NULL 유지 → 폴백 폴링이 적응형 간격으로 흡수. 다음 fire 재시도.
  }
}

/**
 * lifecycle 독립 sweep(ADR-028·T7) — active 송장의 수명을 **폴링과 분리해** 직접 판정한다.
 * webhook 송장은 무변화라 재폴링이 거의 없어, 폴링 루프 안에서 만료를 판정하면 누락된다(W11). 그래서 매 fire
 * active 전체를 스캔해 lifecycleAction(미등록7일·예외7일·분실의심30일)을 적용한다. **폴링 뒤에 호출**돼 방금 갱신된
 * last_normalized_status 를 읽는다(예: 미등록→이동중 폴링 후 30일이면 '분실 의심'이지 '번호 확인' 아님). 데모 번호는 안내 제외.
 * 판정은 순수(track/register 예산 무관)·발송은 push 파이프라인(자체 상한). 비활성 후엔 재등록 sweep 에서도 빠져 슬롯 회수.
 */
async function sweepLifecycle(env: Env, deps: CronDeps): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT id, carrier, tracking_no, last_normalized_status, created_at FROM shipments WHERE active = 1 LIMIT ?",
  )
    .bind(LIFECYCLE_SCAN_LIMIT)
    .all<LifecycleRow>();
  for (const row of results) {
    const action = lifecycleAction({
      stage: stageOf(row.last_normalized_status),
      createdAt: row.created_at,
      now: deps.now,
    });
    if (action.type !== "deactivate") continue;
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

/**
 * track → 정규화 → CAS → 전환 푸시 — **폴백 폴링·webhook 콜백 공용 다운스트림(복제 금지, ADR-028)**.
 * pollOne(cron.ts)과 webhook 콜백(index.ts handleWebhookCallback)이 같은 정규화·CAS·푸시 경로를 공유한다
 * → 두 경로가 갈리지 않아 중복 푸시·멱등 깨짐이 구조적으로 불가능하다. 반환 = 정규화된 현재 단계.
 *
 * - **last_polled_at 선점 갱신은 호출부 소관**(폴링·콜백 각자 track 전에 처리) — 여기선 갱신하지 않는다(중복 방지).
 * - track 실패는 throw → 호출부가 경로별로 처리: 폴링=백오프(onPollError), 콜백=무시(202 후 폴백 폴링이 흡수, W5).
 * - 단계 전환(CAS 영향행=1)일 때만 notifyTransition fan-out(발송 + 알림 기록 1행). 중복 콜백(같은 단계)은
 *   next===prev → CAS no-op → 푸시 0(멱등, W6). 배송완료는 active=0 으로 재폴링 중단(보관, ADR-005).
 */
export async function processShipmentUpdate(
  env: Env,
  deps: CronDeps,
  row: ShipmentUpdateRow,
): Promise<Stage> {
  const { now } = deps;
  const stored = row.last_normalized_status; // CAS 비교용 원본(null 가능)
  const prev = stageOf(stored);

  // track(외부 1회). 토큰은 D1 캐시(ADR-013). 데모 번호는 외부 호출 우회. 실패는 throw — 호출부가 처리.
  const result = await track(row.carrier, row.tracking_no, {
    fetch: deps.fetch,
    now,
    store: d1TokenStore(env.DB),
    clientId: env.DELIVERY_TRACKER_CLIENT_ID,
    clientSecret: env.DELIVERY_TRACKER_CLIENT_SECRET,
    demoTrackingNumber: env.DEMO_TRACKING_NUMBER,
  });

  // 정규화: lastEvent 우선, 없으면 events 최신값으로 폴백(upstream이 lastEvent를 비워도 단계 회귀 방지).
  const ev = result.lastEvent ?? result.events[result.events.length - 1];
  const next = normalizeStatus(ev?.statusCode);
  // 단계 전환 시 기록할 status_changed_at: 전환을 일으킨 이벤트 시각(파싱 불가/누락이면 now).
  const parsedEvent = ev?.time ? Date.parse(ev.time) : NaN;
  const changedAt = Number.isNaN(parsedEvent) ? now : parsedEvent;

  // 배송완료: 자동 삭제하지 않고 **보관**한다(기본 사양 — 사용자가 수동 삭제). active=0 으로 재폴링만 멈춘다.
  //    CAS(배송완료 + active=0)를 한 문장으로 원자화 → 좀비(완료·active=1) 방지 + 영향행으로 전환 차지 판정
  //    → 이긴 경우에만 정확히 1회 알림. (배송완료 자동 삭제는 다음 phase 설정 옵션 → docs/ROADMAP.md.)
  if (next === "배송완료" && prev !== "배송완료") {
    const casRes = await env.DB.prepare(
      "UPDATE shipments SET last_normalized_status = ?, status_changed_at = ?, active = 0 WHERE id = ? AND last_normalized_status IS ?",
    )
      .bind("배송완료", changedAt, row.id, stored)
      .run();
    if ((casRes.meta.changes ?? 0) === 1) {
      // 전환 차지(영향행=1) → notifyTransition 으로 fan-out(발송 + 알림 기록 1행). 시각 무관 즉시(ADR-030).
      await notifyTransition(env, deps, row, "배송완료", ev?.time);
    }
    return next;
  }

  // 멱등 단계 전환(compare-and-set): 단계가 실제로 바뀐 경우에만, 영향행=1일 때만 전환 인정 후 알림.
  if (next !== prev) {
    const changed = await casStage(env, row.id, stored, next, changedAt);
    if (changed && shouldNotify(prev, next)) {
      await notifyTransition(env, deps, row, next, ev?.time);
    }
  }
  return next;
}

/** 송장 1건: 선점 갱신 → 공용 다운스트림(track→정규화→전환/알림). 외부 실패는 백오프. (만료/lifecycle 은 독립 sweep — T7) */
async function pollOne(env: Env, deps: CronDeps, row: DueRow): Promise<void> {
  const { now } = deps;

  // 2. 선점 갱신: 처리 시작 시 last_polled_at=now 로 먼저 갱신(중첩/중복 방지, ADR-012).
  await env.DB.prepare("UPDATE shipments SET last_polled_at = ? WHERE id = ?").bind(now, row.id).run();

  // 3~6. track → 정규화 → CAS → 전환 푸시(콜백과 공용 다운스트림). 외부 오류는 백오프(다음 fire 재시도).
  try {
    await processShipmentUpdate(env, deps, row);
  } catch (err) {
    // 외부 오류(UNAUTHENTICATED 재인증 실패·429·5xx·timeout): 선점 갱신 원복 + 백오프(다음 fire 재시도).
    await onPollError(env, deps, row, err);
    return;
  }

  // 성공 → 백오프 상태가 있었다면 해제.
  if (row.fail_count > 0) {
    await env.DB.prepare("UPDATE shipments SET fail_count = 0, next_retry_at = NULL WHERE id = ?")
      .bind(row.id)
      .run();
  }
  // 만료/좀비(미등록7일·예외7일·분실의심30일)는 폴링과 분리된 sweepLifecycle 이 판정한다(T7·ADR-028) — 여기서 ❌.
  // (폴링은 due 송장만 보는데 webhook 송장은 무변화라 재폴링이 거의 없어, 여기서 판정하면 만료가 누락된다 — W11.)
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
 * deliver 가 시각 무관 즉시 발송한다(조용시간 폐지, ADR-030).
 * logMeta 가 주어지면(전환 푸시) **이 시점에 (device, shipment)별 알림 기록 1행**을 구성해 deliver 로 넘긴다
 * (ADR-023 보강②: 로깅은 fan-out 메시지 구성 시점 1회 — send 재시도와 분리, 음소거는 이미 subscribers 에서 제외).
 * 운영성 안내(번호 확인·분실 의심)는 logMeta 없이 호출 → 기록하지 않는다(전환 푸시만 기록).
 */
async function fanOut(
  env: Env,
  deps: CronDeps,
  shipmentId: string,
  build: (token: string) => PushMessage | null,
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
  await deliver(env, deps, messages, logs);
}

/** 단계 전환 푸시 — 구독자별 buildMessage(step5). eventTime으로 '오늘 도착'(KST) 판정. */
async function notifyTransition(
  env: Env,
  deps: CronDeps,
  row: ShipmentUpdateRow,
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
    { carrier: row.carrier, last4, stage }, // 전환 푸시 → 알림 기록(ADR-023). carrier 는 carrierId 원문(저장은 id, #9).
  );
}

/**
 * 운영성 안내 푸시(번호 확인·분실 의심) — 단계 전환이 아니라 직접 구성하는 알림. body 만 다르다.
 * id·carrier·tracking_no 만 쓰므로 최소 구조 타입을 받는다(lifecycle 독립 sweep 의 LifecycleRow 가 그대로 만족).
 * logMeta 없음 → 알림 기록 안 함(전환 푸시만 기록, ADR-023).
 */
async function notifyOperational(
  env: Env,
  deps: CronDeps,
  row: { id: string; carrier: string; tracking_no: string },
  body: string,
): Promise<void> {
  const last4 = row.tracking_no.slice(-4);
  await fanOut(
    env,
    deps,
    row.id,
    (token) => ({
      to: token,
      title: `${carrierName(row.carrier)}(${last4})`, // 한글 택배사명(이슈 #9, 전환 푸시와 일관)
      body,
      data: { shipment_id: row.id },
      channelId: DELIVERY_CHANNEL_ID,
    }),
  );
}

/** '번호 확인'(미등록 7일) 안내 — 7일째 데이터 미수신(오타/잘못된 번호 의심). */
async function notifyCheckNumber(
  env: Env,
  deps: CronDeps,
  row: { id: string; carrier: string; tracking_no: string },
): Promise<void> {
  await notifyOperational(env, deps, row, "❓ 운송장 번호를 확인해 주세요 — 7일째 배송 정보가 없어요");
}

/** '분실 의심'(30일 미완료) 푸시 — 단계 전환이 아니라 운영성 알림. */
async function notifyLost(
  env: Env,
  deps: CronDeps,
  row: { id: string; carrier: string; tracking_no: string },
): Promise<void> {
  await notifyOperational(env, deps, row, "🕵️ 오래 변동이 없어요 — 배송 상태를 확인해 주세요");
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
 * 알림 발송 — 시각과 무관하게 **항상 즉시** 발송한다(조용시간 폐지, ADR-030). 거래성 알림은 야간 제한
 * 비대상이고 과알림은 전환 1회·NOTIFYING_STAGES·dedupe·음소거로 억제된다. 발송 후 발송 시점에 1회 기록.
 */
async function deliver(
  env: Env,
  deps: CronDeps,
  messages: PushMessage[],
  logs: NotificationLog[],
): Promise<void> {
  if (messages.length === 0) return;
  await sendAndRecord(env, deps, messages);
  await logNotifications(env, deps, logs); // 발송분 기록 — sendAndRecord 뒤(best-effort).
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
