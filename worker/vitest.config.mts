import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// 테스트를 workerd 런타임에서 실행 + wrangler.toml의 바인딩(D1 등) 제공
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      // CRITICAL: AI 바인딩([ai], v1.1.2)은 remote-only — remoteBindings(기본 true)면 테스트 풀이
      // wrangler 원격 프록시 세션을 띄우려 하고, Cloudflare 인증이 없는 CI 에선 worker 테스트 전체가
      // "No credentials found" 로 시작조차 못 한다. 테스트는 env.AI.run 을 호출하지 않으므로(실호출은
      // step 4 외부 경계 스모크) 원격 바인딩을 끈다. AI binding 은 로컬 placeholder 로만 존재.
      remoteBindings: false,
      // 테스트는 외부(tracker.delivery 등) 실호출을 하지 않는다(프로젝트 규칙) —
      // Worker 의 모든 outbound fetch 를 차단한다. 즉시 1회 track 은 best-effort 라
      // 차단돼도 등록은 그대로 진행된다(미등록 상태로 생성).
      miniflare: {
        outboundService: () => new Response(null, { status: 503 }),
        // tracker.delivery 자격증명을 빈 값으로 둬 등록 핫패스의 즉시 1회 track(tryTrack)을
        // creds 가드(index.ts)로 단락 = 완전 no-op(외부 fetch·토큰 재시도 0). 폴링 테스트는
        // 주입 mock fetch 가 토큰을 처리하므로 무관. (전역 fetch 바인딩 수정 후 등록 다건 시
        // 실 outbound 시도가 누적돼 CI 가 5s 타임아웃 나던 회귀 방지.)
        bindings: {
          DELIVERY_TRACKER_CLIENT_ID: "",
          DELIVERY_TRACKER_CLIENT_SECRET: "",
        },
      },
    }),
  ],
  test: {
    coverage: {
      // workerd 런타임은 v8 coverage(node:inspector/promises)를 지원하지 않음 →
      // 소스 변환 기반 istanbul provider 사용.
      provider: "istanbul",
      include: ["src/**"],
      reporter: ["text-summary", "text"],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 88,
        branches: 80,
      },
    },
  },
});
