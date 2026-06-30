# Step 10: 알림 기록 화면 (/notifications)

서버가 발송한 배송 알림을 시간 역순으로 보여주는 화면을 추가한다 — **앱이 꺼져 있을 때 받은 알림까지** 포함(서버 SOT + 로컬 캐시, ADR-023). 항목 탭 → 해당 택배 상세 딥링크, 정리된 택배면 안내. 미읽음/읽음 계산은 phase 08 `unreadCount`/`markSeen` 이 제공하고, 조회 엔드포인트는 phase 07 `GET /notifications` 가 제공한다 — **소비**한다.

## 읽어야 할 파일

- `/docs/UI_GUIDE.md` — "알림 기록 화면(`/notifications`)"(line 185~189), 상태별 UI 표(line 207~212), 헤더 알림 종(line 181~183)
- `/docs/PRD.md` — "v1.1 기능 명세" 3(알림 기록), 신규 제안 "알림 모두읽음 + 날짜 그룹 헤더"(line 229)
- `/docs/ARCHITECTURE.md` — "HTTP API 계약" `GET /notifications`(line 88), "v1.1 설계 보강 ⑤"(읽음 첫 실행 now 초기화, line 323~324), 앱 에러 매트릭스(알림 조회 실패·딥링크 대상 없음, line 381·383), 엣지(line 279)
- `/docs/ADR.md` — ADR-023(알림 기록 SOT+로컬 캐시·읽음 로컬)
- `/docs/QA.md` — E-4 에러 카탈로그 E9(딥링크 대상 정리됨)·E20(구버전 서버 404)
- **08 산출물**: `app/src/lib/notif.ts`(`unreadCount`·`markSeen`·lastSeen 스토어·배지 99+)
- 코드: `app/src/lib/api.ts`(api 클라이언트 패턴·`ApiError`), `app/src/components/ScreenHeader.tsx`, `app/src/components/StageBadge.tsx`(단계 글리프 재사용), `app/src/lib/carrier.ts`(`carrierName` 한글 변환), `app/src/lib/time.ts`(상대시간), `app/src/lib/cache.ts`(로컬 캐시), `app/src/components/icons/`, `app/src/theme/`

## 작업

### 1. API 클라이언트 — `app/src/lib/api.ts`
- `listNotifications(deps, { limit? }): Promise<NotificationItem[]>` → `GET /notifications`(서버 응답 `{notifications:[{id,shipmentId?,carrier,last4,body,stage,sentAt}]}`).
- graceful: **404(구버전 서버)·5xx·오프라인 → 빈 목록 또는 로컬 캐시**(에러 코드 비노출, E20). 성공분은 `cacheStore` 에 캐시(오프라인 표시용).

### 2. 화면 — `app/app/notifications.tsx`
- `ScreenHeader`(뒤로 + title "알림" + 우측 **"모두 읽음"** 액션). 시간 역순 리스트 + **날짜 구분 헤더**(오늘/어제/날짜).
- 항목: 좌측 단계 아이콘(StageBadge 글리프 재사용·의미색) + 본문 **택배사 한글명(`carrierName(carrier)`) · 상태 문구(`body`)** + 우측 상대시간(`time.ts`). **미읽음**은 좌측 점 또는 굵게(색 단독 금지).
- 탭 → 해당 상세 딥링크(`/shipment/[id]`, `shipmentId` 사용). **대상 정리됨**(`shipmentId` null 또는 상세 404) → 항목 비활성 + 토스트 "정리된 택배예요"(목록 항목 표시는 유지, E9).
- 빈 상태: 알림 권한 **꺼짐** → "알림이 꺼져 있어요 — 켜면 배송 알림이 여기 쌓여요"(설정 유도) / 권한 **켜짐인데 없음** → "받은 알림이 없어요". 오프라인 → 로컬 캐시 표시 + 조용히(코드 비노출).
- 읽음 처리: 화면 **열람 시** 및 **"모두 읽음"** 탭 시 `markSeen(store, now, 최신 sentAt)` → 헤더 배지 0. **첫 실행은 `now` 초기화**(08 규칙 — 기존 기록이 한꺼번에 미읽음으로 폭주하지 않음).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차
1. 위 AC 실행(화면 통합 테스트는 보류 가능[E-3]; `listNotifications` graceful 분기는 api mock 으로 가능). typecheck·기존 테스트 무파손.
2. 체크리스트: 택배사 한글명은 **앱**(`carrierName`)에서 변환(서버 carrier=carrierId) / 딥링크 대상 정리됨 안내(목록 유지) / 첫 실행 `now` 초기화 / 구버전 404·오프라인 graceful(코드 비노출) / 색 단독 미읽음 표현 아님.
3. `phases/09-ui-v0-v11-screens/index.json` step 2 업데이트(성공→completed+summary / 실패→error / 외부개입→blocked).

## 금지사항
- 택배사 한글명 변환을 서버에 요구하지 마라. 이유: notifications.carrier 는 carrierId 저장, 표시 변환은 앱 책임(이슈 #9 와 동일 원칙).
- 에러 코드·HTTP status·기술 메시지를 화면에 노출하지 마라. 이유: PRD 톤(친근한 한국어·내부 code 는 로그만).
- 첫 실행 시 기존 기록을 전부 미읽음으로 처리하지 마라. 이유: 보강 ⑤ — `now` 초기화로 배지 폭주 방지.
- 미읽음을 색 단독으로 표현하지 마라(점/굵기 동반). 기존 테스트를 깨뜨리지 마라.
