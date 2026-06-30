# Step 10: info-draft-prefill-fix (코드리뷰 #1 — draft 미러가 사용자 입력을 덮는 레이스 + #7 prefill 일원화)

> 이 step 은 step 7(info-prefill)이 도입한 "로드 효과에서 draft 무조건 미러" 를 **수정**한다. step 7 의 접근이 #4 자동오픈 모달에서 레이스를 만든다(아래). 코드리뷰(xhigh) 검출 #1.

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-046** 전문 + 그 **"개정(2026-06-30 · 코드리뷰 #1 ...)"** 절(이 step 의 SoT). **ADR-043**(#4 등록후 자동오픈 딥링크·`openInfo="1"`)·**ADR-024/039**(택배 정보 = 로컬 ShipmentInfo·D1 미저장).
- `/docs/ENGINEERING.md` — **P-12 F4**(비동기 로드가 "열린 모달의 사용자 입력"을 덮는 레이스).
- `app/src/lib/info.ts` — `getInfo(id, {store})` 반환(`ShipmentInfo`: `memo?`·`category?`·`amount?`). **신규/미저장 id 는 빈 `{}` 로 resolve**(이게 빈 값을 미러하는 근본).
- `app/app/shipment/[id].tsx` — **이 step 의 유일한 수정 대상.** 현재 상태를 꼼꼼히 읽어라:
  - draft 상태(`memoDraft`/`categoryDraft`/`amountDraft`) 선언부.
  - **저장값 로드 효과**(`[id]`, `getInfo(...).then`) — 현재 memo/category/amount **및 draft 3종**을 set(step 7 에서 추가한 draft 미러가 문제).
  - **#4 자동오픈 효과**(`openInfoParam === "1"` → `openInfoConsumed` ref 1회 가드 → `setInfoModal(true)`). 메모 `TextInput` 은 `autoFocus` 라 열리면 키보드가 즉시 뜨고 사용자가 곧장 타이핑할 수 있다.
  - **헤더 `openInfo` 콜백** — live state(`memo`/`category`/`amount`)로 draft prefill 후 `setInfoModal(true)`(유지).
  - `onCaptureFill`(캡처 자동채움이 draft 를 덮음 — ADR-045, 불변).

## 문제 (왜 고치나)

`openInfo="1"` 자동오픈 효과는 mount 시 **동기로** `setInfoModal(true)` 한다(autoFocus 메모 → 즉시 타이핑 가능). 그런데 로드 효과의 `getInfo(id)` 는 **비동기**라, 신규 송장은 빈 `{}` 로 resolve → `setMemoDraft(info.memo ?? "")` = `setMemoDraft("")` 등이 **사용자가 이미 친 글자를 빈 값으로 덮는다**. 자동오픈은 신규 송장 전용 흐름이라(ADR-043) 정확히 이 시나리오에서 터진다. 창은 좁으나(로컬 AsyncStorage 빠름) 콜드·저사양 기기에서 비결정적. 자동오픈 경로엔 draft 미러가 이득 0(신규=빈 info)인데 레이스만 만든다.

## 작업

`app/app/shipment/[id].tsx` **한 파일만** 수정한다. 목표: draft 는 **모달 오픈 시점에만** 채우고, **열린 모달의 사용자 입력을 비동기 로드가 절대 덮지 않게** 한다.

1. **prefill 일원화** — memo/category/amount → draft 매핑을 단일 헬퍼로 모은다(헤더 `openInfo` 와 자동오픈이 같은 매핑을 쓰게):
   ```ts
   // ShipmentInfo 또는 live 값을 draft 로 — 금액은 순수 숫자 문자열(미설정이면 "")
   const prefillDrafts = useCallback((info: { memo?: string; category?: string; amount?: number }) => {
     setMemoDraft(info.memo ?? "");
     setCategoryDraft(info.category);
     setAmountDraft(info.amount === undefined ? "" : String(info.amount));
   }, []);
   ```
   헤더 `openInfo` 콜백은 이 헬퍼를 live state(`{ memo, category, amount }`)로 호출하도록 바꾼다(동작 동일·중복 제거).
2. **로드 효과의 무조건 draft 미러 제거** — `getInfo(...).then` 은 memo/category/amount **live state 만** set 한다(헤더 타이틀·`openInfo` 가 의존). draft 는 set 하지 않는다.
3. **자동오픈을 로드 완료까지 지연** — 로드 효과가 끝났음을 알리는 플래그(예: `const [infoLoaded, setInfoLoaded] = useState(false)` 를 `.then` 끝에서 `true` 로)를 두고, 자동오픈 효과를 다음으로 바꾼다:
   ```ts
   // openInfo="1" 딥링크: 로드 완료 후 1회만 — prefill 한 뒤 연다(열린 뒤 비동기 로드가 draft 를 덮지 않음).
   useEffect(() => {
     if (openInfoConsumed.current || openInfoParam !== "1" || !infoLoaded) return;
     openInfoConsumed.current = true;
     prefillDrafts({ memo, category, amount }); // 로드 완료된 live 값(신규=빈 값)으로 채우고 연다
     setInfoModal(true);
   }, [openInfoParam, infoLoaded, memo, category, amount, prefillDrafts]);
   ```
   결과: 자동오픈 모달은 **로드가 끝난 뒤** 열리고, draft 는 그 시점 1회만 set → 이후 비동기 로드가 draft 를 건드리지 않는다.

> 에이전트 재량: `infoLoaded` 게이트 대신 동등한 다른 방법(예: 로드 `.then` 안에서 자동오픈을 직접 트리거)으로 구현해도 된다. **불변식**: (a) draft 는 오픈 시점에만 set, (b) 열린 모달의 사용자 입력을 비동기 `getInfo` resolve 가 절대 덮지 않음, (c) 신규 송장은 빈 draft 로 열림(정상).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

> ⚠️ 레이스 자체는 타이밍이라 jest 가 못 잡는다(P-12). dev build 스모크(ENGINEERING 체크리스트 #7①)는 step 15 게이트. 자동 AC 는 typecheck/test green.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 회귀 체크리스트:
   - 로드 효과(`getInfo(...).then`)가 **draft 를 set 하지 않는다**(live state 만).
   - 자동오픈은 **로드 완료 후** 열리고 그때 prefill 한다(열린 뒤 draft 를 덮는 비동기 경로 없음).
   - 헤더 `openInfo` 도 동일 `prefillDrafts` 사용·동작 동일(재오픈 시 미저장 편집 폐기 유지).
   - 금액 draft = 순수 숫자 문자열/`""`. 캡처 자동채움(ADR-045)·`setInfo`·서버/D1 무변경.
3. 결과에 따라 `phases/v1_1_3/index.json` 의 step 10 을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."`(생성/수정 파일·핵심 결정 한 줄).
   - 수정 3회 실패 → `"status": "error"`, `"error_message": "..."`.

## 금지사항

- 로드 효과에서 draft 를 무조건 미러하지 마라. 이유: 자동오픈 모달에 사용자가 타이핑 중일 때 늦은 `getInfo` resolve 가 입력을 덮는다(코드리뷰 #1·P-12 F4).
- 자동오픈을 로드 완료 전에 열지 마라. 이유: draft prefill 타이밍이 로드와 경합한다.
- 헤더 `openInfo` 의 재-prefill(재오픈 시 live 값으로 채움) 동작을 바꾸지 마라. 이유: 재오픈 미저장 편집 폐기 유지(ADR-046 회귀 락).
- 금액 draft 에 ₩·천단위 문자열을 넣지 마라. 이유: 입력 draft 는 순수 숫자 문자열.
- 저장(`setInfo`)·서버·D1·캡처 자동채움 경로를 건드리지 마라. 이유: surgical — 이 step 은 오픈 시 draft prefill 타이밍만.
- 기존 테스트를 깨뜨리지 마라.
