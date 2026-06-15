/**
 * unboxing Worker
 *  - fetch:     Expo 앱용 HTTP API (송장 등록/조회/삭제)
 *  - scheduled: 15분 cron — 활성 송장 배치 폴링 → 상태 정규화 → Expo Push
 * 설계 기준: ../../docs/design.md
 */

export interface Env {
  DB: D1Database;
  /** 스마트택배 개발자 키 (wrangler secret) */
  SWEETTRACKER_API_KEY: string;
}

export default {
  // 앱 → Worker HTTP API
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // TODO 라우팅:
    //   POST   /shipments        운송장 등록 (택배사 자동인식 → subscriptions 연결, dedupe)
    //   GET    /shipments        기기의 송장 목록 + 정규화 상태
    //   DELETE /shipments/:id    구독 해제
    switch (url.pathname) {
      case "/health":
        return Response.json({ ok: true });
      default:
        return new Response("Not Found", { status: 404 });
    }
  },

  // cron 트리거 (*/15 * * * *) — due 기반 단일 배치 폴링
  async scheduled(controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // TODO 배치 폴링:
    //   1. due 조회: active AND now >= last_polled_at + interval(stage)   (적응형 폴링 표)
    //   2. 청크(외부호출 ≤50/실행) 단위로 스마트택배 폴링
    //   3. 원문 상태 → 표준 단계 정규화(매핑 테이블)
    //   4. last_normalized_status 변경 시에만 Expo Push (멱등) — '이동중'은 무알림
    //   5. 배송완료 → 알림 후 삭제 / 미등록·예외 7일·전체 30일 만료
    console.log("scheduled tick:", controller.cron, new Date(controller.scheduledTime).toISOString());
  },
} satisfies ExportedHandler<Env>;
