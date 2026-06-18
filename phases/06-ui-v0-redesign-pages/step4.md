# Step 4: settings-privacy — 설정 탭 정리 + 개인정보처리방침 인앱 화면(+호스팅 URL)

설정 화면은 step1에서 하단 탭(`app/app/(tabs)/settings.tsx`)으로 이동됐다. 개인정보처리방침을 **인앱 화면으로도 제공**하고(번들된 방침 렌더), **호스팅 URL 링크도 병행**한다.

> **정책 근거**: Apple·Google 모두 **공개 호스팅 정책 URL을 스토어 메타데이터로 필수** 요구한다 → 호스팅 URL은 어느 방식이든 필요. 인앱 화면은 추가 제공(오프라인·링크 깨짐에 견고). 사용자 결정: "호스팅 URL + 인앱 화면 둘 다".

## 읽어야 할 파일
- `app/AGENTS.md` — Expo SDK 56. https://docs.expo.dev/versions/v56.0.0/ 확인.
- `/docs/PRIVACY_POLICY.md` — **방침 본문 단일 출처(SoT)**. 인앱 화면은 이 내용을 표시한다.
- `/docs/PRD.md` — "스토어 정책 & 컴플라이언스"(개인정보처리방침 URL 필수·인앱 데이터 삭제), `/docs/ADR.md` — ADR-017(데이터 삭제)
- `/docs/UI_GUIDE.md` — "설정 / About 화면", "접근성"
- `phases/06-ui-v0-redesign-pages/step1.md`(라우트·헤더 규칙)
- `app/app/(tabs)/settings.tsx`(현 설정 — `PRIVACY_POLICY_URL`, 개인정보처리방침 Pressable, 알림/테마/데이터삭제/버전), `app/src/components/icons/`

## 작업

### 1. 설정 화면 헤더/구조 정리
- 탭으로 이동했으므로 `Stack.Screen options={{ title: "설정" }}` 제거(헤더 title 없음 — step1 규칙). 기존 항목(알림·테마·개인정보처리방침·모든 데이터 삭제·버전)·로직 유지.
- 화면 내 행의 우측 `›`(유니코드)·테마 선택 `✓` 등 **글리프를 step0 SVG 아이콘으로 교체**(`ChevronRight` 필요 시 step0에 추가, `Check`). OS 글리프 잔존 금지.

### 2. 개인정보처리방침 인앱 화면 — `app/app/privacy.tsx`(신규 stack 화면)
- 설정의 "개인정보처리방침" 행 탭 → **인앱 화면으로 push**(외부 브라우저 즉시 열기에서 변경). 화면 하단/상단에 **"웹에서 보기"** 링크로 `PRIVACY_POLICY_URL`(`Linking.openURL`) 병행.
- 본문 렌더: `docs/PRIVACY_POLICY.md` 내용을 **번들된 데이터로 표시**한다. **마크다운 라이브러리 추가 금지**(과의존) — 방침을 구조화 데이터(섹션 제목+문단 배열)로 `app/src/content/privacyPolicy.ts` 에 두고 `Text` 컴포넌트로 렌더(토큰 색·타이포). ScrollView, 가독성 라인하이트.
- **동기화 주의(드리프트 방지)**: `app/src/content/privacyPolicy.ts` 상단에 "출처: docs/PRIVACY_POLICY.md — 변경 시 함께 갱신" 주석 + `lastUpdated` 날짜. 두 곳이 어긋나지 않게 한다.

### 3. URL 상수 정리
- `PRIVACY_POLICY_URL` 은 settings/privacy 양쪽에서 쓰이므로 단일 출처(`app/src/config.ts` 또는 공용 상수)로. 현재 placeholder(`https://unboxing.app/privacy`, 미호스팅)임을 주석 유지 — 실제 호스팅은 배포 시 외부 작업(#12).

## 엣지케이스 / 에러 핸들링
- 오프라인에서 "개인정보처리방침" 탭 → 인앱 화면은 **항상** 열림(번들 내용). "웹에서 보기"만 네트워크 필요(실패 시 조용히/토스트).
- 다이내믹 타입/긴 본문 → ScrollView로 스크롤 가능, 잘림 없음.

## 금지사항
- 마크다운 렌더 라이브러리를 추가하지 마라(과의존) — 구조화 Text 렌더.
- 인앱 화면만 두고 호스팅 URL을 없애지 마라 — 스토어 메타데이터 URL 필수.
- 방침 본문을 `docs/PRIVACY_POLICY.md` 와 다르게 임의 수정하지 마라(SoT 일치).
- OS 글리프(`› ✓` 등)를 남기지 마라 — SVG 교체.
- 기존 데이터 삭제(`DELETE /me`)·알림·테마 로직을 바꾸지 마라.
- 기존 테스트를 깨뜨리지 마라.

## Acceptance Criteria
```bash
npm run verify
```
- `grep -RnE "[›✓✕▾▴]" app/app/(tabs)/settings.tsx app/app/privacy.tsx` 결과 비어야 함(글리프 잔존 없음).

## 검증 절차
1. AC 실행 + grep.
2. 체크리스트: 설정 헤더 title 없음 / 개인정보처리방침 인앱 화면 + 웹에서 보기 링크 병행 / 방침 본문 SoT 일치+동기화 주석 / 마크다운 라이브러리 미추가 / OS 글리프 제거.
3. `phases/06-ui-v0-redesign-pages/index.json` step 4 업데이트.
