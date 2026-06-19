/**
 * 앱 설정 — 서버 베이스 URL은 빌드 시 EXPO_PUBLIC_API_URL 로 주입(docs/ARCHITECTURE "환경변수").
 * 하드코딩 금지. EXPO_PUBLIC_ 접두어는 번들 인라인되므로 비밀을 넣지 않는다(Worker URL은 공개).
 * 미설정 시 로컬 Worker dev 기본값(wrangler 기본 포트 8787)만 허용 — 프로덕션 빌드는 반드시 설정할 것.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";

/**
 * 개인정보처리방침(한글) 공개 URL — Apple·Google 스토어 메타데이터 필수.
 * settings(웹에서 보기)·privacy(인앱 화면 하단 링크) 양쪽이 이 단일 출처를 참조한다.
 * 방침 본문은 docs/PRIVACY_POLICY.md(SoT) → app/src/content/privacyPolicy.ts 로 번들된다.
 * 호스팅: 같은 데이터를 Worker 가 GET /privacy 로 HTML 렌더(worker/src/index.ts). 아래는 그 라이브 URL.
 */
export const PRIVACY_POLICY_URL = "https://unboxing-worker.dev-jinni520.workers.dev/privacy";
