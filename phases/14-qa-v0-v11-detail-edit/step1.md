# Step 1: detail-edit-reregister (상세 헤더 아이콘 2개 분리 + 운송장 수정=재등록)

#2(상세 헤더 "택배 정보"/"수정" 아이콘 분리)와 #4(택배사·운송장번호 수정 = 클라이언트 재등록, ADR-027)를 상세 화면에 함께 구현한다. 두 변경은 **같은 헤더의 진입점**을 다루므로 한 step에서 처리한다(분리하면 Pencil 이 빈 모달을 여는 깨진 중간 상태가 생김). 대상은 `app/app/shipment/[id].tsx` + 신규 아이콘 `FileText`(`src/components/icons/icons.tsx`).

## 읽어야 할 파일

먼저 아래를 정독하고 현재 상세 화면 구조·재등록 패턴·디자인 규칙을 파악하라:

- `/docs/ADR.md` — **ADR-027**(식별자 수정=재등록·서버 PATCH 아님) + **ADR-026**(택배사 자동선택, 수정 모달도 동일 정책)
- `/docs/ARCHITECTURE.md` — "v1.1 추가 (2026-06-23): 식별자 수정 (재등록)" 흐름·순서·엣지 케이스 표(수정 4행)
- `/docs/UI_GUIDE.md` — "상세"(헤더 아이콘 2개 분리)·"운송장 수정 (택배사·번호)"·"택배 정보 모달(FileText)" 섹션, 상태별 UI 표
- `/docs/PRD.md` — "v1.1 추가 #2·#4" + 톤(코드/기술 메시지 비노출)
- `/Users/jinni/Developments/unboxing/app/app/shipment/[id].tsx` — **주 대상.** 현재 헤더 단일 `Pencil`(line 196~206) → `openInfo`, 택배 정보 모달(line 285~397), `confirmDelete`, 메모 기반 헤더 타이틀(`headerTitle`).
- `/Users/jinni/Developments/unboxing/app/app/trash.tsx` — `restoreOne`(line 102~108): **재등록 패턴 레퍼런스**(`createShipment` → 반환 `shipment.id` 로 info 복원 → 정리). 같은 골격을 수정에 쓴다.
- `/Users/jinni/Developments/unboxing/app/src/components/CarrierSelect.tsx` — **phase 13 에서 추출된 공유 택배사 선택 컴포넌트.** 수정 모달이 이걸 재사용한다. **없으면 phase 13(13-qa-v0-v11-carrier-select)을 먼저 실행하라.**
- `/Users/jinni/Developments/unboxing/app/src/lib/carrier.ts` — `estimateCarriers`·`autoPickCarrier`(phase 13)·`carrierName`·`CARRIERS`.
- `/Users/jinni/Developments/unboxing/app/src/lib/info.ts` — `transferInfo`(이 phase step0)·`getInfo`·`setInfo`·`infoStore`.
- `/Users/jinni/Developments/unboxing/app/src/lib/api.ts` — `createShipment`(반환 `{shipment, created}` — created=false 는 dedupe 멱등 200)·`deleteShipment`·`ApiError`.
- `/Users/jinni/Developments/unboxing/app/src/lib/tracking.ts` — `isValidTrackingNumber`·`normalizeTrackingNumber`.
- `/Users/jinni/Developments/unboxing/app/src/components/icons/icons.tsx` — 아이콘 정의(여기 `FileText` 추가, 배럴 `index.ts` 는 `export *` 라 자동 노출).

이전 step(step0)에서 `transferInfo` 가, phase 13 에서 `autoPickCarrier`·`CarrierSelect` 가 만들어졌다. 그것들을 재사용한다.

## 작업 A — `FileText` 아이콘 추가 (`src/components/icons/icons.tsx`)

기존 아이콘 패턴(`rootProps` + `IconProps` + Feather 라인 path, strokeWidth 1.5)을 그대로 따라 `FileText` 를 추가한다(문서 글리프). 제안 path(Feather file-text·MIT):

```tsx
/** 택배 정보(문서) — 상세 헤더 "택배 정보" 진입(메모·카테고리·금액). UI_GUIDE 신규 글리프 FileText. */
export function FileText({ size = 20, color, strokeWidth = 1.5, ...a11y }: IconProps) {
  return (
    <Svg {...rootProps(size, color, strokeWidth)} {...a11y}>
      <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <Path d="M14 2v6h6" />
      <Path d="M16 13H8" />
      <Path d="M16 17H8" />
      <Path d="M10 9H8" />
    </Svg>
  );
}
```

`Pencil` 은 이미 있으니 재사용(수정 진입). `index.ts` 는 수정 불필요(`export *`).

## 작업 B — 헤더 아이콘 2개 분리 (#2, `shipment/[id].tsx`)

현재 `ScreenHeader` 의 `right` 는 `Pencil` 1개로 `openInfo` 를 연다. 이를 **아이콘 2개**로 바꾼다(헤더 우측에 나란히):

- **수정**: `Pencil` → 새 `openEdit`(아래 작업 C 모달). a11y 라벨 "운송장 수정".
- **택배 정보**: `FileText` → 기존 `openInfo`(메모·카테고리·금액 모달, **그대로 유지**). a11y 라벨 "택배 정보".

두 Pressable 각각 터치 타깃 ≥44(기존 `headerEdit` 스타일 패딩 수준), `hitSlop`. 색은 `tokens.text.primary`. 순서·간격은 재량(예: 수정·택배정보 순, gap).

## 작업 C — 운송장 수정 모달 + 재등록 (#4, `shipment/[id].tsx`)

기존 택배 정보 모달과 **별개**의 모달을 추가한다(인라인 박스 금지·헤더 진입 규칙 유지 — 회귀 락). 상태(드래프트)·핸들러 추가:

```ts
const [editModal, setEditModal] = useState(false);
const [carrierDraft, setCarrierDraft] = useState<string | null>(null); // 명시 택배사 선택(picked)
const [trackingDraft, setTrackingDraft] = useState("");
const [carrierListOpen, setCarrierListOpen] = useState(false);
const saving = useRef(false);
```

**openEdit**: 모달 열 때 현재 송장으로 프리필 — `carrierDraft = shipment.carrier`, `trackingDraft = shipment.trackingNo`.

**모달 내용**:
- 운송장 번호 `TextInput`(number-pad), `trackingDraft` 편집. 무효(`!isValidTrackingNumber`)면 인라인 안내 + 저장 차단.
- 택배사 선택은 **`CarrierSelect` 재사용**(phase 13). 호출부에서 정책 적용:
  ```ts
  const editCandidates = estimateCarriers(trackingDraft);
  const editCarrierId = carrierDraft ?? autoPickCarrier(editCandidates); // ADR-026 동일 정책
  // <CarrierSelect candidates={editCandidates} value={editCarrierId} onChange={setCarrierDraft}
  //   open={carrierListOpen} onToggleOpen={() => setCarrierListOpen(v=>!v)} />
  ```
- **고지 카피 한 줄**(PRD 톤·코드 비노출): 예) "번호를 바꾸면 새 운송장으로 다시 추적해요." (식별자 변경 시 이전 타임라인이 새 번호로 새로 시작됨을 알린다.)
- 액션: 취소 / 저장. **저장 버튼은 `!isValidTrackingNumber(trackingDraft) || !editCarrierId || saving` 이면 비활성**.

**saveEdit — 재등록 오케스트레이션(ADR-027, 순서 = 등록-먼저·삭제-나중). 아래 분기를 정확히 지켜라:**

```
const newNo = normalizeTrackingNumber(trackingDraft);
const newCarrier = editCarrierId;            // 비활성 가드로 non-null 보장
const oldId = id;

// 1) no-op: 택배사·정규화 번호가 현재와 동일 → 호출 없이 모달 닫기.
if (newCarrier === shipment.carrier && newNo === shipment.trackingNo) { setEditModal(false); return; }

if (saving.current) return; saving.current = true;
try {
  // 2) 등록 먼저(실패하면 기존 구독 유지·삭제 안 함).
  const { shipment: created, created: isNew } = await createShipment(newCarrier, newNo, apiDeps);

  // 3a) 반환 id 가 현재와 같으면(서버가 같은 행으로 멱등 처리) 자기 자신 삭제 금지 → 닫고 새로고침만.
  if (created.id === oldId) { setEditModal(false); await load(); return; }

  // 3b) 이미 추적 중(기존에 갖고 있던 다른 송장으로 dedupe hit) → 새 구독 안 만듦·old 자동삭제 안 함·그 상세로 이동.
  if (!isNew) { setEditModal(false); Alert.alert("이미 추적 중인 운송장이에요", "해당 운송장으로 이동할게요."); router.replace(`/shipment/${created.id}`); return; }

  // 3c) 새 구독 생성됨(정상 재등록): info 이관(old→new) → old 구독 해제 → 새 상세로 교체.
  await transferInfo(oldId, created.id, { store: infoStore });
  try { await deleteShipment(oldId, apiDeps); } catch { /* old 잔류 — 다음 sync/reconcile 에서 정리. 진행은 계속. */ }
  setEditModal(false);
  router.replace(`/shipment/${created.id}`);
} catch (e) {
  // 등록 실패(429/409/422/NETWORK 등): 기존 송장·구독 그대로, 모달 유지·값 보존, 친근한 안내(코드 비노출).
  saving.current = false;
  Alert.alert("수정하지 못했어요", reregisterErrorCopy(e));  // trash.tsx restoreErrorCopy 패턴 참고(409=미지원 안내, 그 외=일시 오류)
}
```

규칙(반드시):
- **등록-먼저·삭제-나중.** `createShipment` 가 throw 하면 `deleteShipment` 를 절대 부르지 마라(기존 구독 보존 — 휴지통 삭제의 "스냅샷 먼저"와 동형).
- **`created.id === oldId` 면 `deleteShipment(oldId)` 금지**(현재 보던 송장을 지워버림 — 데이터 무결성 치명).
- **dedupe hit(`!isNew`, id 다름)** 은 old 자동삭제·info 이관을 **하지 않는다**(타깃은 이미 자기 정보가 있음). 안내 후 그 상세로 이동만.
- `deleteShipment` 실패는 **삼킨다**(이미 새 구독 성공 — old 는 reconcile 로 정리). 사용자엔 성공으로 진행.
- 서버 code/기술 메시지 노출 금지(PRD 톤). 에러 카피는 친근한 한국어.

## 회귀 금지 (기존 상세 인터랙션 불변)

- **택배 정보 모달(메모·카테고리·금액)** 동작·저장 계약 그대로(트리거만 `FileText` 로 이동).
- **삭제 버튼**·확인 다이얼로그, **타임라인 영역 내부 스크롤**(페이지 전체 스크롤 아님), **헤더 타이틀=메모 파생**(`headerTitle`/`defaultMemoText`), 상단 고정 섹션 레이아웃 — 모두 불변.
- 상세 본문에 메모/식별자 **인라인 박스 금지**(편집은 헤더 아이콘 → 모달에서만 — UI_GUIDE 회귀 락).
- 색 토큰만(하드코딩 금지), 신규 모달·아이콘도 a11y 라벨 부여.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 전부 green
```

## 검증 절차

1. AC 실행 green.
2. 체크리스트:
   - 헤더에 **수정(Pencil)·택배 정보(FileText)** 2개 아이콘이 각각 다른 모달을 여는가(택배 정보 모달은 FileText 로 이동, 동작 불변).
   - 수정 모달이 `CarrierSelect`(phase 13)와 `autoPickCarrier` 정책을 재사용하는가(후보 ≥2 면 자동선택 없음·저장 비활성).
   - 재등록 순서가 **POST 먼저 → (성공 시) transferInfo → DELETE old → router.replace** 인가.
   - **no-op**(동일 carrier+번호)·**created.id===oldId**(자기 삭제 금지)·**dedupe hit(!isNew)**(old 자동삭제·이관 없이 그 상세로) 분기가 모두 구현됐는가.
   - 등록 실패 시 `deleteShipment` 미호출 + 모달 유지 + 값 보존 + 코드 비노출 안내인가.
   - `FileText` 아이콘이 기존 아이콘 패턴(rootProps·strokeWidth 1.5·토큰 색)을 따르는가.
   - 삭제 버튼·타임라인 스크롤·메모 타이틀·인라인 박스 없음 등 회귀 없음.
3. `phases/14-qa-v0-v11-detail-edit/index.json` 의 step1 갱신:
   - 성공 → `"status":"completed"`, `"summary"`: shipment/[id].tsx 헤더 아이콘 2분리(Pencil=수정/FileText=택배정보) + 수정 모달(CarrierSelect 재사용·고지 카피) + 재등록(POST먼저→transferInfo→DELETE old→replace, no-op·자기삭제금지·dedupe hit 분기·등록실패 보존) + icons.tsx FileText 추가. npm run verify green. **외부 경계 실호출·시뮬 재캡처는 사용자 몫(아래 금지/주의).**
   - 실패(3회) → `"error"` + `error_message`
   - 사용자 개입 필요 → `"blocked"` + `blocked_reason`

## 금지사항

- `createShipment` 실패 후 `deleteShipment` 를 부르지 마라. 이유: 등록 실패인데 기존 구독을 지우면 사용자가 추적을 통째로 잃는다(등록-먼저·삭제-나중의 핵심).
- `created.id === oldId` 일 때 `deleteShipment(oldId)` 를 부르지 마라. 이유: 서버가 같은 행으로 멱등 처리한 경우 현재 보던 송장을 삭제해버린다.
- dedupe hit(`!isNew`, id≠old)에서 old 를 자동 삭제하거나 info 를 덮어쓰지 마라. 이유: ADR-027 — 타깃은 이미 자기 info 가 있고, old 유지/삭제는 사용자 판단.
- 서버에 새 "수정" 엔드포인트(PATCH carrier/tracking_no)를 만들지 마라. 이유: ADR-027 — 행은 `UNIQUE(carrier,tracking_no)`·다기기 공유라 PATCH 시 타 기기 전파·충돌. 기존 `POST`/`DELETE` 재사용.
- 택배 정보 모달(메모·카테고리·금액)을 수정 모달과 합치거나 인라인 박스로 본문에 노출하지 마라. 이유: UI_GUIDE 회귀 락(헤더 아이콘 → 모달에서만 편집).
- `worker/` 의 D1·API 를 건드리지 마라. 이유: 이 정정은 클라이언트 전용(서버 무변경).
- 기존 통과 테스트를 깨뜨리지 마라.
