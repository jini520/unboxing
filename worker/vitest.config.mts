import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// 테스트를 workerd 런타임에서 실행 + wrangler.toml의 바인딩(D1 등) 제공
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      // 테스트는 외부(tracker.delivery 등) 실호출을 하지 않는다(프로젝트 규칙) —
      // Worker 의 모든 outbound fetch 를 차단한다. 즉시 1회 track 은 best-effort 라
      // 차단돼도 등록은 그대로 진행된다(미등록 상태로 생성).
      miniflare: {
        outboundService: () => new Response(null, { status: 503 }),
      },
    }),
  ],
});
