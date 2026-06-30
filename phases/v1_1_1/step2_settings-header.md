# Step 2: settings-header (#2 페이지 제목 고정)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-033**(페이지 제목(헤더)은 스크롤 영역 밖 고정 · 전 화면 통일) 전문.
- `/docs/UI_GUIDE.md` — "v1.1.1" 섹션의 "페이지 제목 고정(전 화면)" 회귀 락.
- `app/app/(tabs)/settings.tsx` — **이 step의 유일한 수정 대상.** 현재 `125` 줄 `return (` 아래 `127` `<ScrollView contentContainerStyle={styles.content}>` 바로 안에 제목 `<Text style={styles.title}>설정</Text>`(`129`)와 설명 `알림과 테마를 관리해요`(`131`)가 들어가 **함께 스크롤된다**.
- **고정 헤더 레퍼런스 패턴**: 이미 제목이 스크롤 밖에 고정된 화면을 1개 읽고 그 구조를 따른다 — `app/app/(tabs)/index.tsx`(택배함) 또는 `app/app/(tabs)/dashboard.tsx`. `<View style={header}>` 제목/설명 + 그 아래 `<ScrollView>` 콘텐츠 구조.

## 작업

`app/app/(tabs)/settings.tsx` **한 파일만** 수정한다.

- **제목 `설정` + 설명 `알림과 테마를 관리해요` 를 `ScrollView` 밖**(위)으로 빼서 **고정 헤더**(`<View style={...}>`)에 둔다. 그 아래 기존 설정 항목(알림/테마/개인정보/삭제/버전)만 `ScrollView` 안에 남긴다 — 택배함(`(tabs)/index.tsx`)·대시보드와 동일 패턴.
- 헤더의 간격·타이포·색은 **레퍼런스 화면(택배함)의 헤더 스타일 토큰을 그대로 차용**(spacing/fontSize/색 토큰 — UI_GUIDE 디자인 프리미티브). 새 디자인을 발명하지 마라.
- 스크롤 콘텐츠의 상단 패딩이 제목과 겹치지 않도록 `styles.content` 의 top 패딩만 필요 시 조정한다.

> 개인정보처리방침(`/privacy`)은 본문 제목 스크롤 허용(현행 유지) — 이 step은 **설정 화면만**.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처/회귀 체크리스트:
   - 제목/설명이 `ScrollView` **밖** 고정 `<View>` 에 있다(스크롤돼 사라지지 않음 — ADR-033 회귀 락).
   - 택배함/대시보드와 동일한 헤더 패턴·토큰을 따랐다(일관성).
   - 설정 항목의 동작/기능은 **무변경**(헤더 위치 이동만 — surgical).
3. 결과에 따라 `phases/v1_1_1/index.json` 의 step 2 를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."`.
   - 수정 3회 실패 → `"status": "error"`, `"error_message": "..."`.

## 금지사항

- 제목/설명을 다시 `ScrollView` 안에 넣지 마라. 이유: #2 가 고치려는 바로 그 비정합 재발(ADR-033 회귀 락).
- 설정 항목의 로직(알림 권한·테마 선택·데이터 삭제·시작 화면 등)을 건드리지 마라. 이유: 이 step은 헤더 위치만(surgical change).
- 헤더에 새 색/간격 값을 임의로 만들지 마라. 이유: 레퍼런스 화면 토큰을 차용(단일 출처 · UI_GUIDE 디자인 프리미티브).
- 기존 테스트를 깨뜨리지 마라.
