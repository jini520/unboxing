# Step 3: 휴지통 화면 (/trash)

삭제한 택배를 30일 안에 되살리거나 완전히 지우는 화면을 추가한다(**기기 로컬** 소프트 삭제, ADR-022). 복구는 멱등 **재등록**으로 현재 상태를 되살리고, 영구 삭제는 로컬에서만 제거한다(서버 호출 없음 — 삭제 시 이미 구독 해제). 휴지통 스토어·정보 스토어는 phase 08 이 제공한다 — **소비**한다.

## 읽어야 할 파일

- `/docs/UI_GUIDE.md` — "휴지통 화면(`/trash`)"(line 191~194), 상태별 UI 표(line 207~212), 신규 글리프(복구 `Restore`/`ArrowCounterClockwise`, line 281)
- `/docs/PRD.md` — "v1.1 기능 명세" 2(휴지통·복구·영구삭제·일괄)
- `/docs/ARCHITECTURE.md` — "데이터 흐름"(복구=재등록·영구삭제 로컬, line 245~246), "v1.1 설계 보강 ④"(복구는 반환 id 로 info 귀속·실패 시 유지·`pruneTrash`, line 317~321), 엣지(복구 429/409/오프라인, line 275~278·287)
- `/docs/ADR.md` — ADR-022(휴지통·멱등 재등록 복구)
- `/docs/QA.md` — E-4 에러 카탈로그 E1(429)·E2(409 CARRIER_UNSUPPORTED)·E3(오프라인 NETWORK)
- **08 산출물**: `app/src/lib/trash.ts`(`loadTrash`·`removeTrash`·`pruneTrash`), `app/src/lib/info.ts`(`setInfo` — 복구 후 반환 id 로 라이브 복원)
- 코드: `app/src/lib/api.ts`(`createShipment` 재등록·멱등 200·`ApiError` status), `app/src/components/ScreenHeader.tsx`·`StageBadge.tsx`(카드 축약), `app/src/lib/selection.ts`(멀티선택 재사용), `app/src/lib/carrier.ts`·`time.ts`, `app/src/components/icons/`, `app/src/theme/`

## 작업

### 1. 화면 — `app/app/trash.tsx`
- `ScreenHeader`(뒤로 + title "휴지통" + 선택적 "일괄" 액션). 진입 시 `loadTrash` + **`pruneTrash(now)`**(30일 경과·상한 정리).
- 항목 = 송장 카드 **축약**(단계 배지 + 메모/대체문구 + 택배사·번호) + **"N일 후 영구 삭제"** 캡션(`text/secondary`, 임박 시 `예외` 색 — 색+텍스트). `deletedAt + 30일` 기준 D-day 계산.
- 행 액션: **복구**(`accent` 텍스트/버튼, 복구 글리프) · **영구 삭제**(`예외` 색 · **확인 다이얼로그**). 멀티선택(롱프레스, `selection.ts` 재사용) → **일괄 복구 / 일괄 영구 삭제**(영구 삭제는 확인 다이얼로그·**Undo 없음** — 택배함 일괄삭제와 동일 규칙).
- 빈 상태: "휴지통이 비었어요".

### 2. 복구 (재등록) 흐름
- `createShipment({ carrier, trackingNo }, deps)` 재등록(서버 멱등 dedupe + 즉시 track) → 성공 시 **반환된 `shipment.id` 로** info 라이브 복원(`setInfo(반환 id, 스냅샷 info)`) → `removeTrash(key)`.
- 실패: `429`(레이트·상한, E1)·`409 CARRIER_UNSUPPORTED`(E2)·오프라인 NETWORK(E3) → **항목 유지 + 안내**("잠시 후 다시"·딥링크 폴백 안내). **일괄 복구는 순차 처리·실패분만 휴지통에 남김**.
- 복구의 즉시 track 은 `prev==stored`(등록 직후 규칙)라 푸시·알림 기록을 만들지 않는다(중복 알림 없음).

### 3. 영구 삭제 흐름
- `removeTrash(key)` + 해당 info 스냅샷 로컬 제거. **서버 호출 없음**(삭제 시 이미 구독 해제됨).

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

## 검증 절차
1. 위 AC 실행(복구 실패 분기는 api mock 으로 테스트 가능[E-3]; 휴지통은 로컬이라 오프라인 무관). typecheck·기존 테스트 무파손.
2. 체크리스트: 복구는 **반환 id** 로 info 귀속(옛 id 아님) / 복구 실패 시 항목 유지(일괄은 실패분만) / 영구 삭제는 서버 호출 없음 / 진입 시 `pruneTrash` / 임박 캡션 색+텍스트(색 단독 아님) / 색 토큰만.
3. `phases/09-ui-v0-v11-screens/index.json` step 3 업데이트(성공→completed+summary / 실패→error / 외부개입→blocked).

## 금지사항
- 영구 삭제 시 서버를 호출하지 마라. 이유: 삭제 시 이미 구독 해제 — 휴지통은 로컬 전용(ADR-022).
- 복구 실패(429/409/오프라인) 항목을 휴지통에서 제거하지 마라. 이유: 유지 + 안내해야 사용자가 다시 시도한다(일괄은 실패분만 유지).
- info 를 휴지통의 **옛** shipment id 로 복원하지 마라. 이유: orphan 정리로 서버 행 id 가 바뀔 수 있어 **재등록이 반환한 id** 로 귀속해야 정확(보강 ④).
- 임박을 색 단독으로 표현하지 마라(색+텍스트). 기존 테스트를 깨뜨리지 마라.
