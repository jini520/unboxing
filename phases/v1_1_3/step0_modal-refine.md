# Step 0: modal-refine (#1 입력 모달 디자인 정련 — 택배 정보·운송장 수정 공통)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/app/AGENTS.md` — **Expo는 바뀌었다. v56 문서를 코드 작성 전 확인.** 특히 `Modal`·`KeyboardAvoidingView`·`Keyboard`·`Pressable`.
- `/docs/ADR.md` — **ADR-040**(입력 모달 정련: 중앙 카드 유지 + 제목/닫기 헤더·구분선·채움형 저장 버튼) 전문. **ADR-034**(바깥 탭으로 안 닫힘 + 키보드 회피 — 이 step에서 **보존해야 할** 동작).
- `/docs/UI_GUIDE.md` — "v1.1.3 — 모달 정련·등록 FAB·등록 후 정보입력" 섹션의 **입력 모달 정련** 항(헤더 행·구분선·채움형 저장·회귀 금지)과 "디자인 프리미티브".
- `/docs/ENGINEERING.md` — **P-9**(`KeyboardAvoidingView` 를 `<Modal>` 안에 둘 때 iOS 가림 — 이 step이 **보존**해야 하는 키보드 회피).
- `app/app/shipment/[id].tsx` — **이 step의 유일한 수정 대상.** 현재 상태를 꼼꼼히 읽어라:
  - `432~568`: infoModal(택배 정보) `<Modal>`. `571~649`: editModal(운송장 수정) `<Modal>`. 둘 다 `modalBackdrop`(689) > `modalAvoider`(691·`KeyboardAvoidingView`) > `modalCard`(692) 구조 공유.
  - `692` `modalCard` 스타일(현재 `borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md`), `693` `modalTitle`, `716` `modalActions`, `717` `modalCancel`, `718` `modalSave`.
  - 취소/저장 버튼: infoModal `545~564`(취소 `546~548`, 저장 `549~563`), editModal `625~645`(취소 `626~628`, 저장 `629~644`).
  - `84` `const [infoModal, setInfoModal]`, `94` `setEditModal`.
- `app/src/theme/tokens.ts` — `accent`·`onAccent`·`bg.secondary`·`text.secondary`·`text.disabled`·`border` 시맨틱 색.
- `app/src/theme/layout.ts` — `spacing`(lg=16·md=12·sm=8)·`radius`(md=8·lg=12)·`fontSize`(title3=17)·`fontWeight`(semibold).
- `app/src/components/icons/icons.tsx` — 닫기 글리프는 **`Close`**(`X` 아님, `65~72`). 배럴 `app/src/components/icons` 에서 import. 색은 `color` prop으로 토큰 주입(**hex 하드코딩 금지**).

이전 코드(특히 두 모달이 공유하는 `modalCard`/`modalActions`)를 이해한 뒤 작업하라.

## 작업

`app/app/shipment/[id].tsx` **한 파일만** 수정한다. 두 모달이 `modalCard`/`modalActions` 스타일을 공유하므로 **스타일 변경 한 번 + 각 모달 JSX 헤더 추가**로 둘 다 정련된다. ADR-040 ①~④:

### ① 제목 + 닫기(✕) 헤더 행
- 각 모달 카드 최상단에 **제목 텍스트 + 우측 `Close` 버튼** 행을 둔다. 제목은 모달별 문구(택배 정보 / 운송장 수정 — 기존 제목 문구 재사용).
- `Close` 버튼 `onPress` = **그 모달의 취소와 동일 동작**(`setInfoModal(false)`/`setEditModal(false)`). `hitSlop` 부여, a11y 라벨 "닫기". 우측 정렬(헤더 행 `justifyContent:"space-between"`).
- 제목 타이포는 `fontSize.title3` + `fontWeight.semibold`(`modalTitle` 갱신).

### ② 헤더 아래 구분선
- 헤더 행 바로 아래 **1px 가로 구분선**(`borderBottomWidth:1` 또는 별도 View, 색은 `tokens.border`).

### ③ 채움형 저장 버튼
- 하단 `modalActions` 를 **취소(텍스트·`tokens.text.secondary`) + 채움형 저장 버튼**으로. 저장 버튼: 배경 `tokens.accent`, 라벨 `tokens.onAccent`, `borderRadius: radius.md`, 적절한 패딩, 우측 배치.
- **비활성 상태**(예: 금액 무효 등 기존 저장 비활성 조건): 배경 `tokens.bg.secondary` + 라벨 `tokens.text.disabled`. 기존 비활성 판정 로직은 그대로 두고 **색만** 분기.

### ④ 간격·타이포 통일
- 카드 패딩·필드 간격은 `layout.ts` 프리미티브(`spacing.*`)로 통일. 새 수치 하드코딩 금지.

**핵심 규칙(설계 의도 — 위반 금지):**
- **ADR-034 동작 보존**: backdrop(`modalBackdrop`) `onPress` 는 지금처럼 **`Keyboard.dismiss()` 만**(모달 `setVisible(false)` 금지). `modalAvoider`(`KeyboardAvoidingView`) 래퍼 유지(P-9).
- **중앙 카드 유지**: 바텀시트로 바꾸지 마라(키보드 회피 실기기 검증 P-9 보존).
- 저장 버튼 색은 **`accent` 고정** — 단계색(`stage.*`)이나 그라데이션/네온 사용 금지(AI 슬롭 안티패턴).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

> ⚠️ `verify`(jest/typecheck)는 **키보드 회피·모달 시각 동작을 못 잡는다**(네이티브 레이아웃 — P-9). 자동 AC는 typecheck/test green까지. 실 동작은 step 5 스모크.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처/회귀 체크리스트:
   - 두 backdrop `onPress` 가 여전히 `Keyboard.dismiss()` 뿐(모달 닫기 금지 — ADR-034 회귀 락).
   - `KeyboardAvoidingView`(`modalAvoider`) 래퍼·중앙 카드 레이아웃 유지(바텀시트 전환 없음).
   - 저장 버튼 배경이 `tokens.accent`(하드코딩 hex·`stage.*`·그라데이션 없음).
   - 색·간격·타이포가 전부 토큰/프리미티브(tokens.ts·layout.ts) 경유.
3. 결과에 따라 `phases/v1_1_3/index.json` 의 step 0 을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약(실기기 키보드 스모크는 step 5에 남음 명시)"`.
   - 수정 3회 실패 → `"status": "error"`, `"error_message": "..."`.

## 금지사항

- backdrop `onPress` 를 모달 닫기(`setInfoModal(false)` 등)로 되돌리지 마라. 이유: 입력 중 오터치로 모달이 닫혀 입력이 날아가는 사고 재발(ADR-034·사용자 보고).
- 중앙 카드를 바텀시트로 전환하지 마라. 이유: 키보드 회피(P-9) 실기기 검증을 깨뜨린다 — 범위 밖(ADR-040).
- 저장 버튼에 그라데이션·네온·`stage.*` 색을 쓰지 마라. 이유: 디커플링 규칙 — 1차 액션 색은 `accent` 고정.
- 모달 외 상세 화면 섹션(상태·타임라인·삭제·헤더 아이콘)을 "개선"하지 마라. 이유: surgical — 이 step은 두 모달의 헤더/구분선/버튼/간격만.
- 기존 테스트를 깨뜨리지 마라.
