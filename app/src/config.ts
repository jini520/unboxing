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
 * TODO(배포): docs/PRIVACY_POLICY.md 를 이 URL 에 호스팅한 뒤 실제 라이브 URL 로 확정한다.
 *   (#12 — repo 산출물 완료, 호스팅은 배포 시 외부 작업. 조용한 placeholder 가 아니라 명시적 미배포 표시.)
 */
export const PRIVACY_POLICY_URL = "https://unboxing.app/privacy";
