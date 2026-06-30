# Step 23: info-transfer (택배 정보 old→new id 이관 — 순수 스토어 함수 + test-first)

#4(ADR-027) "택배사·운송장번호 수정 = 클라이언트 재등록"의 데이터 무결성 핵심 조각을 먼저 만든다. 식별자를 바꾸면 새 `shipment.id` 가 생기므로, 로컬 택배 정보(메모·카테고리·금액)를 **old id → new id 로 이관**해야 보존된다. 이 step은 `src/lib/info.ts` 에 이관 함수 하나를 추가하고 **테스트 먼저** 작성한다 — info 스토어 한 모듈만 다룬다(화면은 step1).

## 읽어야 할 파일

먼저 아래를 읽고 info 스토어 계약·테스트 패턴을 파악하라:

- `/docs/ADR.md` — **ADR-027**(식별자 수정은 클라이언트 재등록 — info `old_id→new_id` 이관)
- `/docs/ARCHITECTURE.md` — "v1.1 추가 (2026-06-23): 식별자 수정 (재등록)" 중 **info 이관** 항목
- `/Users/jinni/Developments/unboxing/app/src/lib/info.ts` — 이 step의 유일한 대상. `loadInfo`·`getInfo`·`setInfo`·`pruneInfo`·`ShipmentInfo`·`InfoMap` 계약 확인. 특히 **`setInfo` 가 빈/미설정 필드를 어떻게 떨구는지**와 **amount 0 보존(`=== undefined` 판정)** 규칙.
- `/Users/jinni/Developments/unboxing/app/src/lib/info.test.ts` — 여기에 테스트를 **추가**한다(인메모리 `memStore()` 패턴 그대로 재사용).

## 배경 (확정 — ADR-027)

- 휴지통 복구(ADR-022)는 이미 "재등록 → **반환 shipment.id** 로 `setInfo` 복원" 패턴을 쓴다(`app/app/trash.tsx restoreOne`). 하지만 복구는 old 엔트리가 이미 휴지통(라이브 info 에 없음)이라 **old 제거가 필요 없다**.
- **수정(재등록)** 은 다르다: old 송장이 라이브에 **그대로 있다가** 새 id 로 갈아탄다. 따라서 **old id 의 info 를 new id 로 옮기고 old id 엔트리는 제거**해야 한다(안 그러면 old info 가 고아로 남아 `pruneInfo` 전까지 잔존).
- info 키는 `shipment.id` 라, carrier/번호가 바뀌어도 **id 이관**으로 보존된다(휴지통 복구의 info 복원과 동일 원리).

## 작업 — `app/src/lib/info.ts`

`setInfo` 인근에 순수(스토어 주입) 함수를 추가한다(시그니처):

```ts
/**
 * 택배 정보 이관 — oldId 의 정보를 newId 로 옮기고 oldId 엔트리를 제거(식별자 수정=재등록, ADR-027).
 * - oldId 에 정보가 있으면 newId 에 **그대로 복사**(memo·category·amount), oldId 삭제.
 * - oldId 에 정보가 없으면(빈 객체) newId 는 건드리지 않고 oldId 만(있다면) 정리 → 사실상 no-op.
 * - oldId === newId 면 아무것도 하지 않는다(자기 자신 삭제 방지).
 * 갱신된 맵 반환. amount 0 은 유효값이므로 보존된다(ShipmentInfo 계약).
 */
export async function transferInfo(
  oldId: string,
  newId: string,
  deps: { store: KeyValueStore },
): Promise<InfoMap>;
```

구현 지침(핵심 규칙 — 벗어나지 마라):
- **한 번 load → 맵 안에서 이동 → 한 번 save** 로 처리(중간에 두 번 저장하며 경합 만들지 말 것).
- old 엔트리를 newId 로 옮길 때 **객체를 그대로** 복사한다(필드 재가공·재검증 금지 — 이미 `setInfo` 로 정제돼 저장된 값이다. 특히 amount 0 을 falsy 로 떨구지 말 것).
- **oldId === newId 가드**: 같으면 즉시 현재 맵 반환(엔트리 삭제 금지). 이유: no-op 수정에서 자기 info 를 날리면 안 된다.
- newId 에 이미 정보가 있는 경우: 이번 재등록 흐름에선 newId 가 방금 생성된 새 송장이라 보통 비어 있다. 정책상 **old 의 정보로 덮어쓴다**(사용자가 수정 중인 그 택배의 정보가 진실). 단 old 가 비어 있으면 newId 를 덮어쓰지 않는다(위 규칙).

## 테스트 — `app/src/lib/info.test.ts`

`describe("info — transferInfo", ...)` 를 **추가**한다. 최소 다음을 단언(test-first → red → 구현 → green):

1. old 에 정보(메모+카테고리+금액) 있음 → new 로 이동, **new 가 old 의 값과 동일**, old 엔트리 사라짐.
2. **amount 0 보존**: old 의 amount 가 0 이어도 new 에 0 으로 이관(falsy 로 유실되지 않음).
3. old 에 정보 없음(빈) → new 변화 없음, old 도 없음(no-op).
4. `oldId === newId` → 맵 불변(자기 자신 삭제 안 함).
5. (선택) new 에 기존 정보가 있고 old 도 있음 → old 값으로 덮어씀.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 전부 green
```

## 검증 절차

1. AC 실행 green.
2. 체크리스트:
   - `transferInfo` 가 old→new 복사 + old 제거를 **1 load / 1 save** 로 하는가.
   - amount 0 이 이관에서 보존되는가(데이터 무결성).
   - `oldId === newId` 가드가 있는가(자기 info 삭제 방지).
   - `setInfo`·`pruneInfo` 등 기존 함수·테스트를 바꾸지 않았는가.
3. `phases/14-qa-v0-v11-detail-edit/index.json` 의 step0 갱신:
   - 성공 → `"status":"completed"`, `"summary"`: info.ts 에 transferInfo(old→new id 이관·old 제거·oldId===newId 가드·amount0 보존) 추가 + info.test 테스트 추가. npm run verify green. (step1 의 상세 "수정" 재등록이 createShipment 반환 id 로 이 함수를 호출.)
   - 실패(3회) → `"error"` + `error_message`
   - 사용자 개입 필요 → `"blocked"` + `blocked_reason`

## 금지사항

- 이관 시 필드를 재검증/재가공하지 마라(특히 `amount` 0 을 떨구지 말 것). 이유: 저장된 값은 이미 `setInfo` 로 정제됨 — 재가공은 데이터 손상 위험.
- old 와 new 가 같은 id 일 때 엔트리를 삭제하지 마라. 이유: no-op 수정에서 현재 택배의 info 가 통째로 사라진다.
- 화면(`shipment/[id].tsx`)·`trash.ts` 등 다른 파일을 이 step에서 건드리지 마라. 이유: scope 분리 — UI·재등록 오케스트레이션은 step1.
- 기존 통과 테스트를 깨뜨리지 마라.
