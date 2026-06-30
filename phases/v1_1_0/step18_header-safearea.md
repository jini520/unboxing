# Step 18: header-safearea (B2 — 알림·휴지통 헤더 상단 여백 과다)

알림 기록 화면과 휴지통 화면의 상단 여백 이중 적용을 고친다. 작은 변경이지만 화면(모듈)이 dashboard/list/settings 와 달라 별도 step으로 격리한다.

## 읽어야 할 파일

- `/Users/jinni/Developments/unboxing/app/src/components/ScreenHeader.tsx` — `paddingTop: insets.top` 을 **내부에서 직접** 적용함을 확인
- `/Users/jinni/Developments/unboxing/app/app/notifications.tsx` — 대상 1
- `/Users/jinni/Developments/unboxing/app/app/trash.tsx` — 대상 2
- `/Users/jinni/Developments/unboxing/app/app/register.tsx` 와 `/Users/jinni/Developments/unboxing/app/app/shipment/[id].tsx` — 동일하게 `ScreenHeader` 를 쓰는 화면의 `SafeAreaView edges` 설정을 확인(통일 기준)

## 배경 (확정된 버그 B2)

`notifications.tsx`·`trash.tsx` 가 화면을 `SafeAreaView edges={["top"]}` 로 감싸는데, 그 안의 `ScreenHeader` 도 `paddingTop: insets.top` 을 적용한다 → **top safe-area inset 이중 적용**으로 헤더 위 여백이 과도하다. `ScreenHeader` 를 쓰는 다른 화면(register/detail)은 `edges={["bottom"]}` 라 정상이다.

## 작업

- `notifications.tsx` 의 최상위 `<SafeAreaView ... edges={["top"]}>` → **`edges={["bottom"]}`** 로 변경.
- `trash.tsx` 의 최상위 `<SafeAreaView ... edges={["top"]}>` → **`edges={["bottom"]}`** 로 변경.
- 먼저 register/detail 이 실제로 `edges={["bottom"]}` 인지 확인해 통일 기준이 맞는지 검증한 뒤 적용한다(만약 다르면 summary 에 차이를 기록).
- 그 외 스타일·로직은 건드리지 않는다(top 여백은 `ScreenHeader` 의 `insets.top` 이 단독으로 책임진다).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test green (코드 변경이 작아도 회귀 확인)
```

## 검증 절차

1. AC 실행 green.
2. 두 파일 모두 `edges={["bottom"]}` 인지, 다른 `edges`/스타일을 바꾸지 않았는지 확인.
3. (가능하면) 시뮬레이터: 알림·휴지통 진입 시 헤더 위 여백이 register/detail 과 동일한 수준인지 재캡처. 자동 구동 불가 시 코드 근거로 summary 에 기록 + 사용자 최종 확인 남김.
4. `index.json` step3 갱신:
   - 성공 → `"status":"completed"`, `"summary"`: notifications·trash 의 SafeAreaView edges top→bottom(ScreenHeader insets.top 이중 적용 해소), register/detail 과 통일 확인.
   - 실패(3회) → `"error"` + `error_message` / 사용자 개입 → `"blocked"` + `blocked_reason`

## 금지사항

- `ScreenHeader.tsx` 를 수정하지 마라. 이유: 다른 화면(register/detail)이 공유하는 공용 컴포넌트이고, 그쪽은 정상 동작 중이다. 버그는 화면의 `edges` 중복이므로 화면 쪽만 고친다.
- `edges` 외의 스타일을 손대지 마라. 이유: 변경 범위 추적성(모든 변경 줄이 B2에 직결돼야 한다).
- 기존 테스트를 깨뜨리지 마라.
