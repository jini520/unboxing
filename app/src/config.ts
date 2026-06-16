/**
 * 앱 설정 — 서버 베이스 URL은 빌드 시 EXPO_PUBLIC_API_URL 로 주입(docs/ARCHITECTURE "환경변수").
 * 하드코딩 금지. EXPO_PUBLIC_ 접두어는 번들 인라인되므로 비밀을 넣지 않는다(Worker URL은 공개).
 * 미설정 시 로컬 Worker dev 기본값(wrangler 기본 포트 8787)만 허용 — 프로덕션 빌드는 반드시 설정할 것.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";
