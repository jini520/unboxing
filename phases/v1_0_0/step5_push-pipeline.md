# Step 5: push-pipeline (Expo Push 2단계)

Expo Push 발송(send→ticket) + receipt 확인(getReceipts) + 에러 분류 + 단계별 알림 문구 생성. 외부 호출은 **주입된 `fetch`** 로 mock. 실제 Expo 호출 금지.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — "푸시 발송 파이프라인", "푸시 에러 처리" 표
- `/docs/ADR.md` — ADR-010(2단계 send/receipt, Enhanced Security)
- `/docs/PRD.md` — "알림 정책"(단계별 문구 예시), "UX 세부"(상대 시간·KST)
- `/Users/jinni/Developments/unboxing/worker/src/index.ts` — `Env.EXPO_ACCESS_TOKEN`
- `/Users/jinni/Developments/unboxing/worker/src/lib/polling.ts` — `Stage`
- `/Users/jinni/Developments/unboxing/worker/src/lib/notify.ts` — step2(알림 대상 단계)

## 작업

`worker/src/push.ts` 와 `worker/src/push.test.ts` 를 만든다.

### 타입

```ts
export interface PushMessage {
  to: string;                          // ExponentPushToken[...]
  title: string;
  body: string;
  data: { shipment_id: string };       // 딥링크용
}
export interface PushTicket { id?: string; status: "ok" | "error"; details?: { error?: string }; message?: string }
export interface PushReceipt { status: "ok" | "error"; details?: { error?: string }; message?: string }
export type PushErrorAction = "DELETE_TOKEN" | "RETRY" | "ALERT" | "SHRINK" | "IGNORE";
```

### 함수

```ts
interface PushDeps { fetch: typeof fetch; expoAccessToken?: string }

/** 알림 대상 단계 → PushMessage 생성. ctx 의 끝4자리·택배사로 문구 구성. 비알림 단계는 null. */
export function buildMessage(
  stage: Stage,
  ctx: { token: string; shipmentId: string; carrier: string; last4: string },
): PushMessage | null;

/** send: 배치 ≤100 으로 분할 발송 → ticket 배열(요청 순서 보존). POST https://exp.host/--/api/v2/push/send */
export async function sendPush(messages: PushMessage[], deps: PushDeps): Promise<PushTicket[]>;

/** getReceipts: 배치 ≤1000 으로 분할 조회. POST .../push/getReceipts */
export async function getReceipts(ticketIds: string[], deps: PushDeps): Promise<Record<string, PushReceipt>>;

/** Expo 에러 코드 → 처리 액션. */
export function classifyPushError(error: string | undefined): PushErrorAction;
```

문구(PRD 알림 정책 예시):

- `등록`: "{택배사} 접수 확인 — …{끝4자리}"
- `집화`: "택배사가 상품을 수거했어요"
- `배송출발`: "오늘 도착 예정 — 배송이 시작됐어요"
- `배송완료`: "배송 완료 ✓"
- `예외`: "배송에 문제가 있어요(지연/반송) — 확인이 필요해요"

에러 분류(ARCHITECTURE "푸시 에러 처리"):

| 에러 | 액션 |
|---|---|
| `DeviceNotRegistered` | `DELETE_TOKEN` |
| `MessageRateExceeded` | `RETRY` |
| `MessageTooBig` | `SHRINK` |
| `MismatchSenderId` / `InvalidCredentials` | `ALERT` |
| 그 외 | `IGNORE` |

## 핵심 규칙 (벗어나면 안 됨)

- **배치 한도**: send 는 **≤100**, getReceipts 는 **≤1000** 으로 분할한다. 이유: 초과 시 `PUSH_TOO_MANY_NOTIFICATIONS`/`_RECEIPTS`.
- payload(특히 `body`)는 **≤4096B**. `data.shipment_id` 를 반드시 포함(딥링크). 이유: ARCHITECTURE 푸시 파이프라인.
- `DeviceNotRegistered`(ticket 또는 receipt) → `DELETE_TOKEN` 분류. 실제 토큰 삭제는 step7이 수행. 이유: 토큰 위생.
- `EXPO_ACCESS_TOKEN` 이 있으면 `Authorization: Bearer` 헤더를 붙인다. 없으면 헤더 없이 발송(둘 다 동작). 이유: ADR-010 Enhanced Security(선택·권장).
- 알림 대상 단계만 `buildMessage` 가 메시지를 만든다. 비알림 단계(`이동중`/`기타`/`미등록`)는 `null`. 이유: step2 알림 규칙 일관성.
- push_token 을 로그에 남기지 마라.

## 테스트 (mock fetch)

- 101개 메시지 → send 가 2배치(100+1)로 분할 호출됨(주입 fetch 호출 횟수·바디 검증).
- ticket 순서가 입력 순서와 일치.
- `classifyPushError("DeviceNotRegistered")` = `"DELETE_TOKEN"` 등 표 전수.
- `buildMessage("이동중", …)` = `null`, `buildMessage("배송완료", …)` ≠ null 이고 `data.shipment_id` 포함.
- `EXPO_ACCESS_TOKEN` 주입 시 Authorization 헤더 존재, 미주입 시 부재.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 배치 분할(100/1000)이 테스트로 보장되는가?
   - `data.shipment_id` 가 항상 포함되는가?
   - 에러 분류표가 전수 검증되는가?
   - push_token 로그 부재?
3. `phases/worker-backend/index.json` 의 step 5 를 업데이트한다(규칙은 step0 과 동일).

## 금지사항

- 테스트에서 실제 Expo(exp.host)로 네트워크 호출하지 마라. 이유: 외부 의존 mock.
- 배치 한도를 무시하고 한 요청에 전량 보내지 마라. 이유: Expo 요청단 한도 위반.
- 마케팅성 문구·이모지 남발을 넣지 마라. 이유: ADR-018(거래성만), UI 톤(친근하되 도구답게).
- 토큰 삭제·D1 접근을 여기서 하지 마라. 이유: 부작용/저장은 step7(cron). 여기는 발송·분류·문구만.
- 기존 테스트를 깨뜨리지 마라.
