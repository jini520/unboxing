# Step 1: card-chip (#2 송장 카드 카테고리 칩을 하단 행 우측으로 — 4줄 → 3줄)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-041**(카테고리 칩을 독립 줄 → 택배사·번호 줄 우측 끝, 3줄 고정) 전문.
- `/docs/UI_GUIDE.md` — "**송장 카드 해부**" 섹션 전체(단계 배지·메모·택배사·번호·**카테고리 칩 = 하단 행 우측** 회귀 락) + "택배 정보(메모+카테고리+금액)"의 "카드 카테고리 칩" 항. **이 카드의 회귀 락을 반드시 숙지** — 메모 표시 규칙(중단·좌측·`primary`·대체문구·1줄)은 불변.
- `app/src/components/ShipmentCard.tsx` — **이 step의 유일한 수정 대상.** 현재 `styles.body` 안 위→아래 구조:
  - `160~175` 단계 배지 행(topRow): `<StageBadge>`(161) + 우측 음소거 종·상대시간.
  - `177~180` 메모 줄: `<Text style={styles.memo}>`.
  - `181~194` **카테고리 칩(현재 독립 줄)**: `category ?` 조건부, `<View style={styles.chip}>` 안 `<Tag size={12}/>`(184) + `<Text style={styles.chipText}>`.
  - `195~198` 택배사·운송장번호 줄: `<Text style={styles.carrier}>{carrierName(...)} · {trackingNo}</Text>`.
  - 스타일: `styles.memo`(374~378), `styles.chip`(380~390·현재 `alignSelf:"flex-start"`·`marginTop:spacing.sm`), `styles.chipText`(391~394), `styles.carrier`(396~400).
- `app/src/theme/layout.ts`·`app/src/theme/tokens.ts` — 간격·색 토큰(칩 배경 `bg.secondary`·글리프/텍스트 `text.secondary` 유지).

## 작업

`app/src/components/ShipmentCard.tsx` **한 파일만** 수정한다. 목표: 카드를 **3줄 고정**(단계 배지 행 · 메모 · [택배사·번호 + 칩]).

- 현재 **독립 줄인 카테고리 칩(`181~194`)** 을 제거하고, **택배사·번호 줄(`195~198`)과 같은 행**으로 합친다.
- 하단 행을 `<View>` 로 감싸 `flexDirection:"row", alignItems:"flex-end", justifyContent:"space-between"`:
  - **좌측**: 택배사·번호 `<Text style={styles.carrier}>`(`flex:1`, 길면 줄바꿈 유지 — `numberOfLines` 제거/현행).
  - **우측**: 카테고리 칩(`category ?` 조건부, `flexShrink:0`, **하단 정렬**). 칩 미설정이면 **우측 비움**(좌측 택배사·번호가 그대로 전체 폭 사용).
- 칩 스타일(`styles.chip`)에서 `alignSelf:"flex-start"`·줄 사이 `marginTop` 은 행 배치에 맞게 조정(행 안에서 우측·하단 정렬이므로 독립 줄 여백 제거). 칩 시각(배경 `bg.secondary`·`Tag` 12px·`chipText` 11px·`text.secondary`)은 유지.

**핵심 규칙:**
- 결과 카드는 **칩 유무와 무관하게 3줄**(과거 칩이 독립 줄이라 4줄로 늘던 것 해소).
- **메모 표시 규칙 불변**: 중단·좌측 정렬·`primary` 색·대체문구(`defaultMemoText`)·1줄. 칩은 보조 — 메모 줄에 붙이거나 메모 규칙을 건드리지 마라.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처/회귀 체크리스트:
   - 카테고리 칩이 **택배사·번호 줄과 같은 행의 우측**(독립 줄 아님). 칩 미설정 시 우측 비고 좌측만.
   - 택배사·번호가 길어 줄바꿈돼도 칩이 `flexShrink:0` 으로 안 찌그러지고 우측 하단 정렬 유지.
   - 메모 줄(중단·좌측·`primary`·대체문구·1줄)·단계 배지·양방향 스와이프 등 **다른 카드 인터랙션 불변**.
   - 칩 색은 토큰(`bg.secondary`/`text.secondary`)만.
3. 결과에 따라 `phases/v1_1_3/index.json` 의 step 1 을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."`.
   - 수정 3회 실패 → `"status": "error"`, `"error_message": "..."`.

## 금지사항

- 칩을 다시 독립 줄로 빼거나 메모 줄에 붙이지 마라. 이유: ADR-041·UI_GUIDE 회귀 락 — 4줄로 되돌아가거나 메모 규칙과 충돌.
- 메모 표시 규칙(위치·정렬·색·대체문구·1줄)을 바꾸지 마라. 이유: 칩은 보조 정보일 뿐, 메모는 카드의 1차 식별 정보(회귀 락).
- 단계 배지·스와이프·음소거 등 다른 줄을 손대지 마라. 이유: surgical — 이 step은 칩↔택배사/번호 행 재배치만.
- 기존 테스트를 깨뜨리지 마라.
