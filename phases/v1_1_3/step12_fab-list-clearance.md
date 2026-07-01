# Step 12: fab-list-clearance (코드리뷰 #4 — FAB 가 스크롤 마지막 항목을 가림)

> 등록 FAB(ADR-042)가 `absolute` 우하단이라 스크롤 끝에서 마지막 카드/콘텐츠를 덮는다. 코드리뷰(xhigh) 검출 #4. **JS 전용.**

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-042** 전문 + 그 **"개정(2026-06-30 · 코드리뷰 #4 ...)"** 절(이 step 의 SoT). **ADR-041**(칩·운송장번호가 카드 하단 우측으로 이동 — FAB 와 겹치는 영역).
- `/docs/ENGINEERING.md` — (참고) P-12 는 이 step 과 무관(레이아웃 이슈).
- `app/src/components/Fab.tsx` — FAB 치수·위치(`SIZE = 56`, `right: spacing.lg`, `bottom: insets.bottom + spacing.lg`). **읽기만**(수정 금지).
- `app/src/theme/layout.ts` — `spacing` 값(`lg` 등) 확인.
- `app/app/(tabs)/dashboard.tsx` — `ScrollView` `contentContainerStyle={styles.content}`(현재 `{ padding: spacing.lg }`). FAB 무조건 노출.
- `app/app/(tabs)/index.tsx` — `FlatList` `contentContainerStyle={styles.list}`(현재 `{ padding: spacing.lg }`). FAB 는 송장 있고 비선택 모드만.

## 작업

두 스크롤 컨테이너의 콘텐츠가 FAB 위로 스크롤되도록 **하단 패딩을 늘린다**(다른 변경 없음).

- `dashboard.tsx` 의 `styles.content` 와 `index.tsx` 의 `styles.list` 에 **`paddingBottom`** 을 더한다. 값은 **FAB 높이(56) + 여유(`spacing.lg`)** 정도 — 즉 기존 `padding: spacing.lg` 의 상/좌/우는 유지하고 `paddingBottom` 만 키운다. 예:
  ```ts
  // content / list:
  { padding: spacing.lg, paddingBottom: spacing.lg + 56 + spacing.lg }
  ```
  (정확한 상수는 에이전트 재량 — 핵심: 끝까지 스크롤해도 마지막 카드의 칩·운송장번호·탭 타깃이 FAB 에 안 가리게. 토큰/프리미티브 사용, 매직넘버는 FAB `SIZE` 와 일관되게.)
- FAB 자체(`Fab.tsx`)·노출 조건·`right`/`bottom` 은 **건드리지 않는다**.
- 빈 상태(중앙 CTA)는 FAB 가 안 뜨거나(목록) 콘텐츠가 짧아 무관 — 패딩 추가가 빈 상태 레이아웃을 해치지 않는지 확인(짧은 콘텐츠는 패딩이 보여도 무해).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

> ⚠️ 실제 가림 여부는 시뮬/실기기에서 끝까지 스크롤해 확인(네이티브 레이아웃). dev build 스모크(ENGINEERING #7④)는 step 15 게이트.

## 검증 절차

1. 위 AC 실행.
2. 회귀 체크리스트:
   - `dashboard` `content`·`index` `list` 둘 다 `paddingBottom` 증가(FAB 높이+여유).
   - `Fab.tsx`·FAB 노출 조건·위치 무변경.
   - 다른 스타일·로직 무변경(surgical).
3. `phases/v1_1_3/index.json` step 12 갱신(성공 → completed + summary / 실패 → error).

## 금지사항

- `Fab.tsx` 의 위치(`right`/`bottom`/`SIZE`)나 노출 조건을 바꾸지 마라. 이유: 이 step 은 콘텐츠 하단 여백만(FAB 동작 불변·ADR-042).
- `paddingBottom` 외 다른 스타일/레이아웃을 건드리지 마라. 이유: surgical.
- 하드코딩 색·새 컴포넌트를 추가하지 마라. 이유: 범위 밖.
- 기존 테스트를 깨뜨리지 마라.
