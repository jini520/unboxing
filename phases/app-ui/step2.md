# Step 2: api-client (Worker HTTP API 클라이언트)

Worker 백엔드 HTTP API를 호출하는 타입드 클라이언트. 모든 요청에 `Authorization: Bearer <device_id>`. 외부 호출은 주입 `fetch` 로 mock 테스트.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — "HTTP API 계약" 표(엔드포인트·요청/응답·에러 코드), "에러 처리 매트릭스 → 앱(클라이언트)"
- `/docs/ADR.md` — ADR-007(Bearer device_id), ADR-014(서버 SOT)
- `/docs/PRD.md` — "마이크로카피 톤"(에러 코드/기술 용어 노출 금지)
- step0: `app/src/config.ts`(`API_URL`)
- step1: `app/src/lib/device.ts`(`getDeviceId`)
- `/Users/jinni/Developments/unboxing/app/src/lib/tracking.test.ts` — 테스트 스타일

## 작업

`app/src/lib/api.ts` 와 `app/src/lib/api.test.ts`.

타입은 ARCHITECTURE 계약을 미러:

```ts
export type Stage = "미등록" | "등록" | "집화" | "이동중" | "배송출발" | "배송완료" | "예외" | "기타";
export interface Shipment { id: string; carrier: string; trackingNo: string; status: Stage; /* … */ }
export interface TimelineEvent { time: string; description?: string; location?: string }

export class ApiError extends Error { code: string; status: number } // UI는 code를 친근한 카피로 매핑(원시 노출 금지)

interface ApiDeps { fetch: typeof fetch; getDeviceId: () => Promise<string>; baseUrl?: string }

export function registerDevice(pushToken: string, platform: "ios" | "android", deps: ApiDeps): Promise<{ deviceId: string }>;
export function createShipment(carrier: string, trackingNo: string, deps: ApiDeps): Promise<{ shipment: Shipment; created: boolean }>; // created: 201 vs 200(멱등)
export function listShipments(deps: ApiDeps): Promise<Shipment[]>;
export function getShipment(id: string, deps: ApiDeps): Promise<{ shipment: Shipment; timeline: TimelineEvent[] }>;
export function deleteShipment(id: string, deps: ApiDeps): Promise<void>; // 204
export function deleteMe(deps: ApiDeps): Promise<void>; // 204 (모든 데이터 삭제)
```

- 베이스 URL = `deps.baseUrl ?? API_URL`. 헤더 `Authorization: Bearer <device_id>`, `Content-Type: application/json`.
- 비-2xx 응답의 `{ error, code }` 를 `ApiError` 로 변환. 네트워크 오류도 `ApiError`(code 예: `NETWORK`).

## 핵심 규칙 (벗어나면 안 됨)

- 모든 요청에 `Authorization: Bearer <device_id>` 를 붙인다(`/health` 제외, 앱은 호출 안 함). 이유: ADR-007 인가.
- 서버의 `code`·기술 메시지를 **UI 텍스트로 그대로 노출하지 않도록** 구조화해 전달한다(`ApiError.code` 는 매핑용, 사용자 문구는 화면 step이 생성). 이유: PRD "에러 코드/기술 용어 노출 금지".
- device_id 를 로그/쿼리스트링에 넣지 마라(Authorization 헤더로만). 이유: ADR-007.
- 변경(등록/삭제)은 온라인에서만. 오프라인 큐잉하지 마라(Phase 2). 이유: ADR-014.

## 테스트 (mock fetch + 주입 getDeviceId)

- 각 함수가 올바른 method·path·헤더(Bearer)·body 로 호출하는지(주입 fetch 인자 검증).
- `createShipment`: 201 → `created:true`, 200 → `created:false`(멱등).
- 비-2xx `{error,code}` → `ApiError`(code·status 보존).
- 네트워크 throw → `ApiError(code:"NETWORK")`.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트: 모든 호출에 Bearer 헤더? 멱등(200/201) 구분? 에러가 ApiError로 정규화? device_id 로그/URL 부재?
3. `phases/app-ui/index.json` 의 step 2 업데이트(규칙은 step0 동일).

## 금지사항

- 테스트에서 실제 Worker로 네트워크 호출하지 마라. 이유: 외부 의존 mock(주입 fetch).
- 서버 `code` 문자열을 사용자 화면에 그대로 쓰지 마라. 이유: PRD 톤 규칙.
- 오프라인 변경 큐잉을 구현하지 마라. 이유: ADR-014 Phase 1 범위 밖.
- 기존 테스트를 깨뜨리지 마라.
