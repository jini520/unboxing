# Step 14: register (등록 화면)

운송장 등록 화면. 번호 입력 → 택배사 자동추정/확인 → 등록. 클립보드 제안(명시 시점·제안만), 미지원 택배사 딥링크 폴백.

## 읽어야 할 파일

- `/docs/PRD.md` — 핵심 플로우 1(등록), "핵심 기능" 1~2, "권한 & 온보딩"(클립보드 정책), "UX 세부"
- `/docs/UI_GUIDE.md` — "화면 구성 → 등록", "입력 필드", "상태별 UI"(등록 실패·미지원), "인터랙션 → 클립보드 제안"
- `/docs/ARCHITECTURE.md` — "HTTP API 계약"(`POST /shipments`·`409 CARRIER_UNSUPPORTED`)
- step0 테마, step2 `api.createShipment`, `app/src/lib/tracking.ts`(기존 `normalizeTrackingNumber`·`isValidTrackingNumber` 재사용)
- **https://docs.expo.dev/versions/v56.0.0/sdk/clipboard/** — expo-clipboard API
- **https://docs.expo.dev/router/** — 라우트·뒤로가기

## 작업

라우트 `app/app/register.tsx` + 순수 추정 `app/src/lib/carrier.ts`(+ `carrier.test.ts`).

```ts
export interface CarrierCandidate { id: string; name: string }
/** 번호 형식 휴리스틱으로 택배사 후보 추정(로컬). 확정 아님 — 사용자 확인용. */
export function estimateCarriers(trackingNo: string): CarrierCandidate[];
```

화면:
- 번호 입력 → `normalizeTrackingNumber`·`isValidTrackingNumber`(기존 lib 재사용) 검증.
- `estimateCarriers` 로 후보 제시 → 사용자 확인/수정(드롭다운). 실패 시 수동 선택.
- 등록 → `api.createShipment` → 성공 시 목록으로. 멱등(이미 등록=200)도 자연 처리.
- **클립보드 제안**: 화면 진입 등 명시 시점에만 `expo-clipboard` 읽기 → 운송장-형태면 입력 제안(자동 등록 ❌).
- **미지원 택배사**(`409 CARRIER_UNSUPPORTED`): "자동 추적 미지원" 안내 + 택배사 조회 **딥링크** 버튼.
- 등록 실패: 인라인 에러(코드 노출 금지)+재시도, **입력값 보존**.

## 핵심 규칙 (벗어나면 안 됨)

- 클립보드는 **명시적 시점에만 읽고 제안만**. 자동 등록 금지. 이유: iOS 클립보드 배너 정책(PRD 권한).
- 서버 `code`(`CARRIER_UNSUPPORTED` 등)를 사용자 문구로 노출하지 마라 → 친근한 안내+딥링크. 이유: PRD 톤.
- 등록 실패 시 입력값을 지우지 마라. 이유: UX(재시도).
- 회원가입·API 키 입력 같은 마찰을 넣지 마라. 이유: CLAUDE.md CRITICAL(마찰 최소).
- 색은 토큰만, 색 단독 상태 표시 금지. 이유: UI_GUIDE.

## 테스트

- `estimateCarriers` 휴리스틱 순수 테스트(번호 형식별 후보).
- 기존 `tracking.ts` 검증 재사용 확인(import).

> 화면 렌더 테스트는 Phase 2 보류. typecheck + 순수 테스트로 검증.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트: 클립보드 제안만(자동등록 X)? 미지원 딥링크 폴백? 실패 시 입력 보존? 에러 코드 미노출? 마찰 요소(로그인/키) 부재?
3. `phases/app-ui/index.json` 의 step 6 업데이트(규칙은 step0 동일).

## 금지사항

- 클립보드 내용을 자동으로 등록하지 마라. 이유: iOS 배너·오탐(PRD).
- 운송장 검증 로직을 새로 만들지 마라 — 기존 `tracking.ts` 재사용. 이유: 단일 출처.
- 로그인·API 키 입력을 등록 경로에 넣지 마라. 이유: CLAUDE.md CRITICAL.
- 기존 테스트를 깨뜨리지 마라.
