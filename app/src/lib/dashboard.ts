/**
 * 대시보드 요약 집계(순수 로직). docs/ARCHITECTURE.md "데이터 흐름"·"v1.1 설계 보강 ①", ADR-021.
 * 서버 라운드트립 없이 GET /shipments(또는 오프라인 캐시) 목록을 클라이언트에서 집계한다.
 * 버킷 카운트는 stageBucket 단일 출처 사용(필터 칩과 동일 정의·드리프트 금지).
 * now 주입(Date.now 직접 호출 금지 — 결정적 테스트). 휴지통/정보 스토어를 import 하지 않는다
 * (순수 유지·step 의존 역전 방지) — trashCount·unreadCount·amounts 는 호출부가 주입한다.
 */
import type { Shipment } from "./api";
import { stageBucket, isImminent } from "./bucket";
import { dateKST, monthKST } from "./time";

export interface DashboardCounts {
  inProgress: number;
  completed: number;
  exception: number;
  /** 배송출발 ∩ KST 당일 — "오늘 도착 예정". */
  arrivingToday: number;
  trash: number;
  unread: number;
  /** 이번 달(KST createdAt) 등록 금액 합 teaser. partial=일부만 입력됨(가계부 예고). */
  amountTeaser: { total: number; partial: boolean };
}

export interface DashboardInput {
  trashCount: number;
  unreadCount: number;
  now: number;
  /** 송장별 금액(로컬 정보 스토어에서 호출부가 주입). 미입력/무효는 undefined. */
  amounts: Record<string, number | undefined>;
}

export function dashboardCounts(
  list: Shipment[],
  { trashCount, unreadCount, now, amounts }: DashboardInput,
): DashboardCounts {
  let inProgress = 0;
  let completed = 0;
  let exception = 0;
  let arrivingToday = 0;
  const todayKey = dateKST(now);

  for (const s of list) {
    const bucket = stageBucket(s.status);
    if (bucket === "완료") completed++;
    else if (bucket === "예외") exception++;
    else inProgress++;
    // 오늘 도착 예정 = 배송출발로 전환된 시각(statusChangedAt)이 KST 당일.
    if (isImminent(s.status) && dateKST(s.statusChangedAt) === todayKey) arrivingToday++;
  }

  // 금액 teaser: KST 이번 달 createdAt 건만. list 는 라이브 목록이라 휴지통은 본래 제외된다.
  const monthKey = monthKST(now);
  let total = 0;
  let entered = 0; // 이번 달 건 중 유효 금액이 입력된 수
  let thisMonth = 0; // 이번 달 건 총수
  for (const s of list) {
    if (monthKST(s.createdAt) !== monthKey) continue;
    thisMonth++;
    const amt = amounts[s.id];
    if (typeof amt === "number" && amt >= 0) {
      total += amt;
      entered++;
    }
  }

  return {
    inProgress,
    completed,
    exception,
    arrivingToday,
    trash: trashCount,
    unread: unreadCount,
    // 전부 미입력이면 total=0·partial=false, 일부만 입력이면 partial=true.
    amountTeaser: { total, partial: entered > 0 && entered < thisMonth },
  };
}
