# Step 7: onboarding-settings (온보딩·설정 화면)

푸시 권한 온보딩(priming)과 설정 화면. 설정에는 알림 토글·테마 선택·개인정보처리방침 링크·**모든 데이터 삭제**·앱 버전.

## 읽어야 할 파일

- `/docs/PRD.md` — "핵심 기능" 7·9(온보딩·설정), "권한 & 온보딩", "데이터 삭제 UX"
- `/docs/UI_GUIDE.md` — "화면 구성 → 온보딩·설정", "설정 / About 화면"
- `/docs/ARCHITECTURE.md` — "HTTP API 계약"(`DELETE /me`), "앱 아키텍처"
- `/docs/ADR.md` — ADR-016(테마 시스템/라이트/다크), ADR-017(데이터 삭제 경로), ADR-018(거래성 알림)
- step0 `app/src/theme/`(`useTheme().setPreference`), step1 `app/src/lib/device.ts`, step2 `api.deleteMe`, step3 `cache.clearCache`, step4 `app/src/lib/push.ts`
- **https://docs.expo.dev/versions/v56.0.0/sdk/constants/** — 앱 버전(expo-constants), **/sdk/linking/** — 외부 링크

## 작업

라우트:
- `app/app/onboarding.tsx`(또는 모달) — 푸시 권한 **사전 안내(priming)** → `push.registerForPush`. 첫 등록 직후 등 가치 시점에 노출. 강제 튜토리얼 금지.
- `app/app/settings.tsx` — 항목:
  - 알림 켜기/끄기
  - 테마(시스템·라이트·다크) → `useTheme().setPreference`
  - 개인정보처리방침(외부 링크)
  - **모든 데이터 삭제**(빨강=`예외` 색·확인 다이얼로그·복구 불가 명시)
  - 앱 버전(expo-constants)

순수/오케스트레이션 `app/src/lib/wipe.ts`(+ `wipe.test.ts`):

```ts
/** 모든 데이터 삭제: 서버(DELETE /me) + 로컬(device_id·캐시) 폐기. */
export function wipeAllData(deps: { deleteMe: () => Promise<void>; clearCache: () => Promise<void>; deleteDeviceId: () => Promise<void> }): Promise<void>;
```

## 핵심 규칙 (벗어나면 안 됨)

- **모든 데이터 삭제**는 `DELETE /me`(서버) + 로컬 device_id·캐시 폐기를 함께 수행. 확인 다이얼로그 + 복구 불가 명시 필수. 이유: ADR-017 스토어 정책, 개인정보 비영속.
- 테마 기본은 **시스템 추종**. 사용자가 라이트/다크 고정 선택 가능. 이유: ADR-016.
- 푸시 권한은 priming 후 요청, 거부해도 앱 동작(강제 금지). 이유: PRD·스토어 정책.
- 광고성/마케팅 알림 설정을 넣지 마라. 이유: ADR-018(거래성만).
- 색은 토큰만(삭제 버튼=`예외` 색 토큰). 이유: UI_GUIDE.

## 테스트

- `wipeAllData`: 주입된 `deleteMe`·`clearCache`·`deleteDeviceId` 가 모두 호출되는지(순서·실패 처리). 인메모리/스파이로 검증.

> 화면 렌더 테스트는 Phase 2 보류. typecheck + `wipe.test.ts` 로 검증.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트: 모든 데이터 삭제가 서버+로컬 동시 폐기? 확인 다이얼로그·복구불가 명시? 테마 시스템 기본+선택? 푸시 비강제? 광고 토글 부재?
3. `phases/app-ui/index.json` 의 step 7 업데이트(규칙은 step0 동일).

## 금지사항

- "모든 데이터 삭제"에서 로컬만 또는 서버만 지우지 마라. 이유: 둘 다 폐기해야 ADR-017 충족.
- 확인 없이 즉시 삭제하지 마라. 이유: 파괴적·복구 불가(PRD 데이터 삭제 UX).
- 마케팅 알림 토글·광고 설정을 추가하지 마라. 이유: ADR-018.
- 기존 테스트를 깨뜨리지 마라.
