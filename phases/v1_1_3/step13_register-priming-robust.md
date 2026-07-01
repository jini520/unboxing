# Step 13: register-priming-robust (코드리뷰 #5 — priming 영속 실패가 등록 성공을 오인)

> 등록 성공 후 priming 경로에서 `AsyncStorage.setItem` 이 throw 하면 catch 로 떨어져 "등록 실패" 로 오인된다. 코드리뷰(xhigh) 검출 #5. **JS 전용.**

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-043** 전문 + 그 **"개정(2026-06-30 · 코드리뷰 #5 ...)"** 절(이 step 의 SoT). priming 우선 분기(priming > 멱등 `created:false` > 신규 Alert).
- `app/app/register.tsx` — **유일한 수정 대상.** `submit` 핸들러를 꼼꼼히 읽어라:
  - `try` 안: `ensureDeviceRegistered()` → `createShipment(...)` → `if (await shouldPrimePush()) { await AsyncStorage.setItem(PRIMED_KEY, "1"); router.replace("/onboarding"); return; }` → `if (!created) {...}` → 신규 `Alert.alert(...)`.
  - `catch (e)`: `ApiError` 분기(409/429/422) + else `setError("generic")`. `finally`: `setSubmitting(false)`.
- `app/src/lib/push.ts`(또는 `shouldPrimePush`/`PRIMED_KEY` 정의 위치) — `PRIMED_KEY` 상수·`shouldPrimePush()` 계약 확인.

## 문제 (왜 고치나)

`createShipment` 가 **이미 성공**(서버에 송장 등록)한 뒤 `await AsyncStorage.setItem(PRIMED_KEY, "1")` 가 throw 하면, 그 await 가 `submit` 의 `try` 안이라 **catch 로 떨어져 `setError("generic")`("등록하지 못했어요…")** 를 보이고 온보딩으로 못 간다. 사용자에겐 등록 실패로 보이지만 실제론 추적 중(재시도 시 멱등 `created:false` → 상세로, 정보입력 프롬프트도 건너뜀). 권한 유도(priming) 1회 기회도 날아간다.

## 작업

`app/app/register.tsx` **한 파일만** 수정한다. **PRIMED_KEY 영속을 best-effort 로** 만들어, 실패해도 priming 온보딩 네비게이션이 진행되게 한다.

- priming 분기의 `await AsyncStorage.setItem(PRIMED_KEY, "1")` 를 **자체 try/catch 로 감싼다**(실패 삼키고 진행):
  ```ts
  if (await shouldPrimePush()) {
    try {
      await AsyncStorage.setItem(PRIMED_KEY, "1");
    } catch {
      // 영속 실패는 무시 — 등록은 이미 성공. priming 은 best-effort(다음 등록에 다시 시도될 수 있음).
    }
    router.replace("/onboarding");
    return;
  }
  ```
- 다른 분기(멱등 `!created` → 상세 / 신규 → Alert)·catch·finally·우선순위는 **불변**.

> 주의: `shouldPrimePush()` 자체가 throw 하면(스토리지 읽기) 그건 등록 성공 후 분기 결정 실패라 별개 — 이 step 의 범위는 **setItem(쓰기) best-effort** 만. `shouldPrimePush` 가드는 surgical 하게 두고 건드리지 않는다(범위 밖). 단, 에이전트 판단상 동일 부류 위험이면 짧게 메모만 남기고 코드는 setItem 만.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

> register 흐름은 mock `createShipment`/`AsyncStorage` 로 단위테스트 대상일 수 있다. 기존 테스트 유지·필요시 "setItem reject 시 onboarding 진행" 케이스를 추가해도 됨(과하면 생략).

## 검증 절차

1. 위 AC 실행.
2. 회귀 체크리스트:
   - priming 분기의 `setItem` 이 자체 try/catch(실패해도 `router.replace("/onboarding")` 진행).
   - 분기 우선순위(priming > 멱등 > 신규 Alert)·catch 분기·`finally setSubmitting(false)` 불변.
   - 다른 흐름 무변경(surgical).
3. `phases/v1_1_3/index.json` step 13 갱신(성공 → completed + summary / 실패 → error).

## 금지사항

- 분기 우선순위나 멱등/신규 분기 동작을 바꾸지 마라. 이유: ADR-043 회귀 락 — 이 step 은 setItem 실패 처리만.
- `setItem` 실패를 사용자 오류(`setError`)로 노출하지 마라. 이유: 등록은 이미 성공 — 오인 메시지가 정확히 그 버그.
- `shouldPrimePush`/`createShipment`/서버 경로를 건드리지 마라. 이유: 범위 밖·surgical.
- 기존 테스트를 깨뜨리지 마라.
