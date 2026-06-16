# Step 4: push-setup (알림 권한·토큰·딥링크)

Expo 푸시 권한 요청(priming 후)·토큰 등록·Android 채널·알림 탭 딥링크. 네이티브 모듈은 통합(typecheck), 순수 매핑은 test-first.

## 읽어야 할 파일

- **https://docs.expo.dev/versions/v56.0.0/sdk/notifications/** — SDK 56 expo-notifications API(권한·토큰·채널·리스너; 버전별 변경 큼)
- **https://docs.expo.dev/router/** — expo-router 프로그래매틱 네비게이션(`router`)
- `/docs/ARCHITECTURE.md` — "앱 아키텍처"(알림 처리·딥링크), "푸시 발송 파이프라인"(payload `shipment_id`)
- `/docs/PRD.md` — "권한 & 온보딩"(pre-permission priming, Android 13+ `POST_NOTIFICATIONS`, 거부 graceful), "알림 정책"(Android 채널)
- `/docs/ADR.md` — ADR-010(Expo Push), ADR-018(거래성만)
- step0 `app/app/_layout.tsx`, step2 `app/src/lib/api.ts`(`registerDevice`)

## 작업

`app/src/lib/push.ts`(+ 순수 부분 `push.test.ts`)와 루트 레이아웃 배선.

```ts
/** 권한 요청(priming은 호출부 UI가 먼저) → Expo push token. 거부면 denied. */
export function registerForPush(deps): Promise<{ token: string } | { denied: true }>;

/** Android "배송 상태" 채널 설정(멱등). */
export function ensureAndroidChannel(): Promise<void>;

/** 알림 payload → 라우트 경로. 순수·테스트 대상. */
export function routeForNotification(data: unknown): string | null; // {shipment_id} → "/shipment/{id}"
```

배선(루트 레이아웃 또는 훅):
- 알림 응답(탭) 리스너 → `routeForNotification` → `router.push(path)`(상세 딥링크).
- 포그라운드 알림 핸들러(인앱 표시).
- 토큰 획득 시 `api.registerDevice(token, platform)` 호출(권한 허용 시).

## 핵심 규칙 (벗어나면 안 됨)

- 권한은 **priming(가치 안내) 후** 요청한다(콜드스타트 즉시 팝업 금지). 거부 시 앱은 계속 동작(알림만 비활성). 이유: PRD 권한 온보딩, 스토어 정책.
- **푸시를 앱 사용의 전제로 강제하지 마라.** 이유: Apple/Google 정책, ADR-018.
- Android는 "배송 상태" **notification channel 분리**. 이유: PRD 알림 정책.
- 알림 탭은 payload `shipment_id` 로 **해당 상세로 딥링크**. 이유: ARCHITECTURE.
- push_token 을 로그에 남기지 마라.

## 테스트 (순수 부분)

- `routeForNotification({shipment_id:"abc"})` = `"/shipment/abc"`, 잘못된 payload → `null`.

> 네이티브 권한/토큰 흐름은 jest로 검증하기 어렵다 → 통합(typecheck)으로 두고, 분기 로직(`routeForNotification`)만 단위 테스트한다.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트: priming 후 요청·거부 graceful? Android 채널 분리? 딥링크 payload→상세? push_token 로그 부재?
3. `phases/app-ui/index.json` 의 step 4 업데이트(규칙은 step0 동일).

## 금지사항

- 콜드스타트에 권한 팝업을 띄우지 마라. 이유: 가치 시점 priming 원칙.
- 권한 거부 시 앱 기능을 막지 마라. 이유: 스토어 정책·PRD.
- 마케팅/광고 알림 경로를 넣지 마라. 이유: ADR-018.
- 기존 테스트를 깨뜨리지 마라.
