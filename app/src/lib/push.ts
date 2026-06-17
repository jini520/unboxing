/**
 * 푸시 알림 — 권한·토큰·Android 채널·딥링크 매핑.
 * docs/ARCHITECTURE.md "앱 아키텍처"(알림 처리·딥링크), docs/ADR.md ADR-010(2단계 send/receipt)·ADR-018(거래성만).
 *
 * 핵심 규칙:
 * - 권한은 priming(가치 안내) 후 요청 — 콜드스타트 즉시 팝업 금지. 호출부 UI(온보딩)가 먼저 안내한다.
 * - 거부돼도 앱은 계속 동작(알림만 비활성) — 푸시를 사용 전제로 강제하지 않는다(스토어 정책·ADR-018).
 * - Android는 "배송 상태" notification channel 분리(PRD 알림 정책).
 * - 알림 탭은 payload shipment_id 로 해당 상세로 딥링크.
 * - push_token 은 로그에 남기지 않는다.
 *
 * 순수 로직(routeForNotification)만 단위 테스트, 네이티브 권한/토큰 흐름은 통합(typecheck).
 * 권한/토큰 조작은 주입(PushDeps)으로 추상화하고 운영 구현은 expo-notifications(pushDeps).
 */
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";

/** Android "배송 상태" 채널 id(PRD 알림 정책 — 배송 상태 채널 분리). */
export const DELIVERY_CHANNEL_ID = "delivery-status";

/** 권한·토큰 조작 추상화(테스트 주입용). 운영 구현은 expo-notifications(pushDeps). */
export interface PushDeps {
  /** 현재 권한 상태 조회(팝업 없음). */
  getPermissions: () => Promise<{ granted: boolean }>;
  /** 권한 요청(priming 후 호출부에서) — 팝업 발생. */
  requestPermissions: () => Promise<{ granted: boolean }>;
  /** Expo push token 획득. */
  getExpoPushToken: () => Promise<{ data: string }>;
}

/**
 * 권한 확인 → (미허용 시 요청) → Expo push token. priming 은 호출부 UI 가 먼저 한다.
 * 거부면 { denied: true } — 호출부는 알림만 비활성하고 앱은 계속 동작시킨다.
 */
export async function registerForPush(
  deps: PushDeps,
): Promise<{ token: string } | { denied: true }> {
  const current = await deps.getPermissions();
  const granted = current.granted ? true : (await deps.requestPermissions()).granted;
  if (!granted) return { denied: true };
  const { data } = await deps.getExpoPushToken();
  return { token: data };
}

/**
 * 이미 허용된 경우에만 토큰을 갱신해 서버에 등록한다(팝업 없음). 미허용/거부면 no-op.
 * 콜드스타트(usePushNotifications)·wipe 후 재등록(settings.doWipe)이 공유 — priming 후 최초 권한 요청은 호출부가 한다.
 * register 는 주입(기본은 registerDevice) — push.ts 가 api/deps 를 import 하지 않게 해 계층·순환을 막는다.
 */
export async function registerPushIfGranted(
  deps: PushDeps,
  register: (token: string) => Promise<unknown>,
): Promise<void> {
  const perm = await deps.getPermissions();
  if (!perm.granted) return;
  const result = await registerForPush(deps);
  if ("denied" in result) return;
  await register(result.token);
}

/** Android "배송 상태" 채널 설정(멱등 — 같은 id 재설정은 갱신). iOS 는 no-op. */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(DELIVERY_CHANNEL_ID, {
    name: "배송 상태",
    // HIGH: 배송출발·배송완료는 즉시 확인 가치가 큰 거래성 알림이라 heads-up 배너로 띄운다.
    // (DEFAULT는 배너 없이 알림함에만 쌓여 핵심 알림이 묻힌다.)
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/** 포그라운드 수신 시 인앱 표시 핸들러 설정(배너+목록). 배지는 관리하지 않는다. */
export function configureForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** 알림 탭(응답) 리스너 등록 → payload data 를 콜백에 전달. 반환 구독은 .remove() 로 해제. */
export function addNotificationResponseListener(
  onData: (data: unknown) => void,
): { remove: () => void } {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    onData(response.notification.request.content.data);
  });
}

/**
 * 알림 payload → 상세 라우트 경로. 순수·테스트 대상.
 * { shipment_id: "abc" } → "/shipment/abc". shipment_id 없거나 형식 불일치면 null.
 */
export function routeForNotification(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const id = (data as Record<string, unknown>).shipment_id;
  if (typeof id !== "string" || id.length === 0) return null;
  return `/shipment/${id}`;
}

/** 운영용 기본 PushDeps(expo-notifications). projectId 는 EAS 설정에서 해석. */
export const pushDeps: PushDeps = {
  getPermissions: async () => {
    const { status } = await Notifications.getPermissionsAsync();
    return { granted: status === "granted" };
  },
  requestPermissions: async () => {
    const { status } = await Notifications.requestPermissionsAsync();
    return { granted: status === "granted" };
  },
  getExpoPushToken: async () => {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    return Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  },
};
