/**
 * 콜드스타트 초기 라우팅 우선순위(보강③·ADR-025·E17):
 *   ① 알림 탭 딥링크(getLastNotificationResponseAsync) → 해당 상세(/shipment/:id) — **최우선**
 *   ② 없으면 시작 화면 preference("list" | "dashboard")
 *   ③ 미설정/실패(homePref null) → 택배함("list") 폴백
 * 알림으로 켜진 앱은 그 상세가 시작 화면 설정을 **이긴다**(보강③).
 *
 * 순수 함수 — 네이티브 호출(getLastNotificationResponseAsync·preference 로드)은 호출부(09 화면 배선)가
 * 수행하고 결과만 주입한다. 딥링크 대상 해석은 기존 routeForNotification(push.ts) 재사용(드리프트 금지).
 */
import { routeForNotification } from "./push";
import type { HomePref } from "./prefs";

export interface InitialRouteInput {
  /** getLastNotificationResponseAsync() 응답의 payload data(없으면 null). */
  lastNotificationResponse: unknown;
  /** 시작 화면 preference(로드 실패/미설정이면 null → 택배함 폴백). */
  homePref: HomePref | null;
}

/** 콜드스타트가 향할 곳 — 알림 딥링크(경로) 또는 시작 화면 탭. 09 화면 배선이 router 동작으로 매핑. */
export type InitialRoute =
  | { kind: "deepLink"; path: string }
  | { kind: "home"; home: HomePref };

export function resolveInitialRoute(input: InitialRouteInput): InitialRoute {
  const deep = routeForNotification(input.lastNotificationResponse);
  if (deep) return { kind: "deepLink", path: deep }; // ① 딥링크 최우선.
  if (input.homePref === "dashboard") return { kind: "home", home: "dashboard" }; // ②
  return { kind: "home", home: "list" }; // ③ list 또는 미설정/실패 → 택배함 폴백.
}
