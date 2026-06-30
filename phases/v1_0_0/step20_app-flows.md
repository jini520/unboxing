# Step 20: app-flows (앱 플로우·UI 사양 QA)

앱의 로직 플로우와 UI 사양 준수를 테스트 가능한 범위에서 검증하고, 화면 런스루는 수동 플랜으로 넘긴다. (발견·기록만 — 수정 금지.)

> **QA 철칙: 버그를 고치지 마라.** 갭은 `it.todo`/`.skip` + `docs/QA_FINDINGS.md`. verify green 유지. UI 컴포넌트 렌더 테스트는 문서상 Phase 2 보류 — 여기선 **로직 플로우 + 정적 감사**까지.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — "앱 아키텍처 (Expo)", "에러 처리 매트릭스 → 앱"
- `/docs/ADR.md` — ADR-014(서버 SOT·캐시)·016(테마)·007(device_id)
- `/docs/UI_GUIDE.md` — "AI 슬롭 안티패턴", "시맨틱 토큰", "색 단독 금지", "마이크로카피"
- `/Users/jinni/Developments/unboxing/app/src/lib/*`(device·api·cache·push·time·sort·carrier·wipe), `app/src/theme/*`, `app/app/*.tsx`, `app/src/components/*`
- `/Users/jinni/Developments/unboxing/phases/qa-mvp/step0.md`~`step3.md` 산출 + `docs/QA_FINDINGS.md`

## 작업

`app/src/lib/__qa__/flows.test.ts`(또는 기존 위치) — 로직 플로우 테스트(주입 mock):

1. **device_id 영속·재사용**(getDeviceId 멱등), **api 에러 매핑**(비-2xx/네트워크 → ApiError, 코드 비노출), **cache 오프라인 라운드트립**, **wipe 오케스트레이션**(서버→캐시→device_id 순, 부분 실패 처리), **routeForNotification 딥링크**, **theme resolveTokens**.
2. **데드락 후속(QA-001 연결)**: 앱이 푸시와 무관하게 device를 등록하는 경로가 있는지 확인 — 없으면 FINDINGS에 "앱측 원인" 연결 기록.

정적 감사(grep):

3. **UI_GUIDE 안티패턴**: 글래스모피즘(expo-blur)·그라데이션 텍스트·보라/인디고 브랜드색·글로우·하드코딩 hex(컴포넌트에 `#`)·과한 그림자.
4. **색 단독 금지**: 단계 표시가 색+아이콘+텍스트인지(StageBadge).
5. **에러 코드 비노출**: 화면에 서버 `code`/기술 메시지가 안 뜨는지.
6. **EXPO_PUBLIC 비밀 금지**: `EXPO_PUBLIC_*`에 비밀이 없는지(URL만), 서버 URL 하드코딩 없는지(config.ts 경유).

갭을 `QA_FINDINGS.md`에 기록.

## 핵심 규칙 (벗어나면 안 됨)

- 로직은 주입 mock으로 테스트(실 네트워크·네이티브 호출 금지). UI 렌더 테스트는 보류(수동 플랜으로).
- 갭은 todo/skip + FINDINGS. 코드 수정 금지.

## Acceptance Criteria

```bash
npm run verify
```

## 검증 절차

1. AC 실행. 2. 체크리스트: 핵심 플로우(device·api·cache·wipe·딥링크·테마)가 검증되는가? UI_GUIDE 안티패턴·색단독·에러코드·EXPO_PUBLIC 감사 결과가 FINDINGS에 기록됐는가? 3. `phases/qa-mvp/index.json` step 4 업데이트.

## 금지사항

- 발견된 갭을 고치지 마라. 이유: QA 전용.
- UI 컴포넌트 렌더 테스트 인프라(RNTL)를 새로 도입하지 마라 — 문서상 Phase 2 보류. 이유: 범위 밖.
- 갭을 실패 단언으로 verify를 깨지 마라. 기존 테스트 깨뜨리지 마라.
