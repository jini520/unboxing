# Step 1: detail-screen (#1 게이트 와이어링 + #3 모달 바깥탭 닫힘방지 + #4 키보드 회피)

## 읽어야 할 파일

먼저 아래를 읽고 설계 의도를 파악하라:

- `/app/AGENTS.md` — **Expo는 바뀌었다. v56 문서(https://docs.expo.dev/versions/v56.0.0/)를 코드 작성 전 반드시 확인**하라. 특히 `KeyboardAvoidingView`·`Modal`·`Keyboard` API.
- `/docs/ADR.md` — **ADR-032**(수취인 표시 게이트)·**ADR-034**(입력 모달: 바깥 탭으로 닫지 않음 + 키보드 회피) 전문.
- `/docs/ENGINEERING.md` — **P-9**(`KeyboardAvoidingView` 를 `<Modal>` 안에 둘 때 iOS 가림/오프셋 — 증상·수정·회귀 락).
- `/docs/UI_GUIDE.md` — "v1.1.1 — …" 섹션의 **회귀 금지** 3항(수취인·헤더·모달).
- `app/src/lib/recipient.ts` — **step 0 산출물** `displayRecipientName`. 이 step에서 호출한다.
- `app/app/shipment/[id].tsx` — **이 step의 유일한 수정 대상.** 현재 상태를 꼼꼼히 읽어라:
  - `318~331` 줄: 수취인 라인 — 현재 `recipient?.name ? (... 받는 분 {recipient.name} ...) : null` 로 **게이트 없이 직접 렌더**(ADR-032가 금지한 회귀 패턴).
  - `391~503` 줄: `infoModal`(택배 정보) — `<Modal>` > backdrop `<Pressable onPress={() => setInfoModal(false)}>` > 카드 `<Pressable onPress={() => {}}>`.
  - `506~578` 줄: `editModal`(운송장 수정) — 동일 구조, backdrop `onPress={() => setEditModal(false)}`.
- step 0 의 import 경로는 같은 파일의 기존 `api`/lib import 상대경로 규칙을 그대로 따른다.

## 작업

`app/app/shipment/[id].tsx` **한 파일만** 수정한다. 세 가지를 처리한다.

### (#1) 수취인 게이트 와이어링
- `displayRecipientName` 을 import 하고, 수취인 라인을 **게이트 통과 시에만** 렌더한다:
  ```tsx
  const recipientName = displayRecipientName(recipient?.name);
  // ...
  {recipientName ? (<Text ...>받는 분 {recipientName}</Text>) : null}
  ```
- 표시 텍스트·스타일(`styles.recipientInline`·`numberOfLines`)·레이아웃은 **현행 유지**. 게이트 판정만 추가.

### (#3) 모달 바깥(backdrop) 탭으로 닫지 않음 — 두 모달 공통
- 두 모달의 backdrop `<Pressable>` `onPress` 를 `setInfoModal(false)`/`setEditModal(false)` → **`Keyboard.dismiss()` 만** 수행하도록 바꾼다(`react-native` 의 `Keyboard` import).
- 모달 닫기는 **취소 버튼**(기존 `onPress={() => setInfoModal(false)}` 등 유지)과 **Android 하드웨어 뒤로**(`<Modal onRequestClose={...}>` 기존 유지)로만.
- 카드 내부 `<Pressable onPress={() => {}}>`(이벤트 전파 차단)는 그대로 둔다.

### (#4) 키보드 회피 — 두 모달 공통
- 두 모달의 **카드 콘텐츠를 `KeyboardAvoidingView` 로 감싼다**: iOS `behavior="padding"`, Android `behavior="height"`(`Platform.select`). 중앙 정렬(`justifyContent:"center"`)이라 가용 영역 축소 시 카드가 자연히 위로 재중앙 정렬된다.
- iOS 에서 헤더/세이프에어리어 때문에 하단이 여전히 가리면 `keyboardVerticalOffset` 를 조정한다(실기기 스모크는 step 3).
- 구조 권장: `<Modal>` > `<Pressable backdrop onPress={Keyboard.dismiss}>` > `<KeyboardAvoidingView ...>` > `<Pressable 카드 onPress={()=>{}}>`. P-9 의 "모달은 별도 호스트 뷰라 바깥 화면 키보드 회피가 적용 안 됨"을 전제로 한다.

## Acceptance Criteria

```bash
npm run verify   # typecheck + test (app + worker + harness) 모두 통과
```

> ⚠️ `verify`(jest/typecheck)는 **#4 키보드 회피·#3 런타임 동작을 못 잡는다**(네이티브 레이아웃 경계 — P-9). 자동 AC는 typecheck/test green까지. 실 동작은 step 3 스모크.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처/회귀 체크리스트:
   - 수취인을 `recipient?.name` 으로 **게이트 없이** 렌더하지 않는다(반드시 `displayRecipientName` 경유 — ADR-032 회귀 락).
   - 두 backdrop `onPress` 가 `setModal(false)` 가 **아니다**(키보드만 접음 — ADR-034 회귀 락).
   - 수취인은 여전히 **미저장 패스스루**(ADR-005) — 저장/전송 로직 추가 금지(표시만).
   - Expo v56 문서대로 `KeyboardAvoidingView`/`Keyboard` 사용.
3. 결과에 따라 `phases/v1_1_1/index.json` 의 step 1 을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."`(실기기 스모크가 step 3에 남았음을 명시).
   - 수정 3회 실패 → `"status": "error"`, `"error_message": "..."`.

## 금지사항

- backdrop `onPress` 를 `() => setInfoModal(false)`/`setEditModal(false)` 로 되돌리지 마라. 이유: 입력 중 오터치로 모달이 닫혀 입력이 날아가는 사고 재발(ADR-034·사용자 보고).
- 수취인 줄을 `recipient?.name` 으로 바로 렌더하지 마라. 이유: 택배사가 `"받는 분"` 라벨을 이름으로 보내 `받는 분 받는 분` 중복 표기됨(ADR-032).
- `app/src/lib/recipient.ts` 의 게이트 로직을 이 파일에 다시 구현하지 마라. 이유: step 0 순수 함수를 재사용한다(단일 출처).
- 상세 화면의 다른 섹션(상태·타임라인·삭제·정보/수정 저장 로직)을 "개선"하지 마라. 이유: surgical change — 이 step은 수취인 라인 + 두 모달 래퍼만.
- 기존 테스트를 깨뜨리지 마라.
