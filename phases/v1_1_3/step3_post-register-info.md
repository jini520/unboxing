# Step 3: post-register-info (#4 등록 성공 후 "택배 정보 입력" 확인 → 상세 모달 자동 오픈)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-043**(등록 후 정보입력 확인 → 상세 모달 자동오픈·priming 우선·멱등 스킵) 전문.
- `/docs/ARCHITECTURE.md` — "v1.1.3" 절의 **등록 후 정보입력 네비게이션(#4)** 항(분기 우선순위·param 소비 규칙).
- `/docs/UI_GUIDE.md` — "v1.1.3" 섹션의 **등록 후 "택배 정보 입력" 확인** 항(마이크로카피 톤).
- `app/app/register.tsx` — `submit`(`113~139`). 현재 `createShipment(...)` 호출이 `120` 에서 **반환값을 버린다**(void). 등록 성공 후 네비게이션 `123~130`: `if (await shouldPrimePush())` → `router.replace("/onboarding")`(`124~125`) / `else if (router.canGoBack())` → `back()`(`127`) / `else` → `replace("/")`(`129`). `shouldPrimePush` 정의 `38~46`, `PRIMED_KEY` `35`.
- `app/app/shipment/[id].tsx` — `useLocalSearchParams<{ id: string }>()` `72`(**현재 `id` 만**). `setInfoModal` `84`. mount 시 모달 자동오픈 로직 **없음**(현재 `openInfo` 는 헤더 콜백 `115~121` 일 뿐 URL param 아님). `createShipment` 반환 형태는 `204` 에서 `const { shipment, created } = await createShipment(...)` 로 **`{ shipment, created }` 확정**.
- `app/src/lib/*` — `createShipment` 시그니처(반환 `{ shipment, created }`)를 확인하라(api 레이어). 이미 그 형태이므로 **api 변경 없음**.

## 작업

서버·D1 무변경(순수 클라 네비게이션 + param). 두 파일을 배선한다.

### (A) `app/app/register.tsx` — 등록 성공 분기
- `120` 의 호출을 반환 캡처로: `const { shipment, created } = await createShipment(...)`.
- 등록 성공 후 분기를 **우선순위대로**:
  1. **priming 우선**: `if (await shouldPrimePush()) { …setItem(PRIMED_KEY,"1"); router.replace("/onboarding"); return; }` (기존 동작 유지 — 첫 등록 푸시 권한 유도가 최우선).
  2. **멱등 등록**(`created === false` = 이미 추적 중): 확인 다이얼로그 **스킵**하고 그 상세로 `router.replace({ pathname: "/shipment/[id]", params: { id: shipment.id } })`(자동 오픈 **안 함** — 기존 정보 덮어쓰기 혼란 방지).
  3. **그 외(신규 등록)**: native `Alert.alert("택배 정보 입력", "택배 정보를 입력할까요?", [...])` —
     - **취소**(`style:"cancel"`): 기존 흐름(`router.canGoBack() ? back() : replace("/")`).
     - **입력**: `router.replace({ pathname: "/shipment/[id]", params: { id: shipment.id, openInfo: "1" } })`.
- 카피는 친근체(삭제 확인과 동일 톤). `Alert` 는 `react-native` 에서.

### (B) `app/app/shipment/[id].tsx` — `openInfo` param 수신 + 1회 자동오픈
- `72` 를 `useLocalSearchParams<{ id: string; openInfo?: string }>()` 로 확장.
- mount effect 추가: `openInfo === "1"` 이면 **한 번만** `setInfoModal(true)`. **소비 후 무시**(재오픈 루프 방지) — `useRef` 플래그로 1회 가드(예: `const consumed = useRef(false); if (!consumed.current && openInfo === "1") { consumed.current = true; setInfoModal(true); }`). param 자체를 다시 쓰지 않으므로 URL 정리는 불필요.

**핵심 규칙:**
- **분기 우선순위 고정**: priming > 멱등 스킵 > (신규) 확인 다이얼로그. priming 과 확인을 동시에 띄우지 마라(첫 등록 프롬프트 과다 회피).
- 자동오픈은 **신규 등록 + 사용자 "입력"** 경로에서만(`openInfo:"1"`). 멱등·취소 경로는 자동오픈 없음.
- **서버 호출·스키마·저장 경로 추가 금지**(ADR-005·ADR-039 불변) — 네비게이션 파라미터만.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

> ⚠️ Alert·네비게이션·모달 자동오픈의 실 동작은 시뮬/실기기에서만(step 5 스모크). 자동 AC는 typecheck/test green.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처/회귀 체크리스트:
   - `createShipment` 반환을 `{ shipment, created }` 로 받고 새 `shipment.id` 로 네비게이션.
   - 분기 우선순위: priming → 온보딩 / 멱등(`created:false`) → 상세(자동오픈 X) / 신규 → 확인 다이얼로그.
   - 상세 화면이 `openInfo === "1"` 을 **1회만** 소비해 모달 오픈(재오픈 루프 없음).
   - 서버/D1/api 시그니처 무변경(순수 클라 네비).
3. 결과에 따라 `phases/v1_1_3/index.json` 의 step 3 을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "register 분기(priming>멱등>확인) + [id] openInfo 1회 소비"`.
   - 수정 3회 실패 → `"status": "error"`, `"error_message": "..."`.

## 금지사항

- priming 대상에서 확인 다이얼로그를 띄우지 마라. 이유: 첫 등록은 푸시 권한 유도가 최우선(ADR-043) — 동시 프롬프트 과다.
- 멱등 등록(`created:false`)에서 정보 모달을 자동오픈하지 마라. 이유: 이미 추적 중인 건의 기존 정보 덮어쓰기 혼란 방지(ADR-043).
- `openInfo` 를 매 렌더 읽어 모달을 다시 열지 마라. 이유: 재오픈 루프 — `useRef` 1회 가드 필수.
- 등록/상세에 서버 호출·D1 저장 경로를 추가하지 마라. 이유: 이 기능은 클라 네비게이션만(ADR-005·ADR-039 불변).
- 기존 테스트를 깨뜨리지 마라.
