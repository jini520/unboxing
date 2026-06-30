# Step 33: home-page — 택배함(메인): + 버튼·전체번호·상태변경시각·양방향 스와이프·멀티선택 일괄삭제

메인(목록) 화면을 개편한다. 화면 파일은 step1에서 `app/app/(tabs)/index.tsx` 로 이동돼 있다.

## 읽어야 할 파일
- `app/AGENTS.md` — Expo SDK 56. https://docs.expo.dev/versions/v56.0.0/ 확인.
- `/docs/UI_GUIDE.md` — "송장 카드 해부", "인터랙션"(스와이프 삭제+Undo), "상태별 UI", "접근성"(터치타깃 44·스크린리더·reduce motion)
- `/docs/PRD.md` — "UX 세부"(Undo·상대시간·정렬), "알림 정책"
- `phases/06-ui-v0-redesign-pages/step1.md` 의 summary(라우트·api 시그니처: `muteShipment`, `Shipment.statusChangedAt/muted`)
- `app/app/(tabs)/index.tsx`(현 목록 — 단일 좌스와이프 삭제+Undo 토스트 로직), `app/src/components/ShipmentCard.tsx`(PanResponder 스와이프), `app/src/lib/sort.ts`, `app/src/lib/time.ts`(`relativeTime`), `app/src/lib/api.ts`(`deleteShipment`, `muteShipment`), `app/src/components/icons/`(`Plus`,`Trash`,`Bell`,`BellOff`,`Check`)

## 의존성 & 제스처 기반
- `cd app && npx expo install react-native-gesture-handler` (직접 의존성 승격 — 현재 transitive). 루트 `app/app/_layout.tsx` 를 `GestureHandlerRootView`(flex:1)로 감싼다(v56 문서 확인).
- 양방향 스와이프는 gesture-handler의 `Swipeable`(`renderLeftActions`/`renderRightActions`)로 구현(현 PanResponder 대체). 이유: 양방향 + 액션 노출 + 멀티선택 롱프레스와의 제스처 조정이 PanResponder보다 견고.

## 작업

### 1. 상단 헤더: 설정 자리 → **＋ 버튼**
- 설정은 이제 하단 탭이므로, 기존 우상단 "설정" 텍스트를 **`Plus` 아이콘 버튼**으로 교체 → `router.push("/register")`. `accessibilityLabel="운송장 추가"`, 터치 ≥44.
- "택배" 제목/마지막 업데이트 표기는 유지(또는 UI_GUIDE 타이포 따름). 빈 상태 CTA 유지.

### 2. 카드: **운송장 번호 전체 표시** + **업데이트=상태 변경 시각**
- `ShipmentCard`: 기존 `trackingNo.slice(-4)` → **전체 번호** 표시(사용자 본인 데이터). 긴 번호(12~13자리) 줄바꿈/오버플로 처리(한 줄, 필요 시 `numberOfLines`/`ellipsizeMode` 또는 래핑 허용 — 잘림 없이).
- 상대시간 소스를 `shipment.createdAt` → **`shipment.statusChangedAt`** 으로 변경(`relativeTime(shipment.statusChangedAt, now)`). 의미: "상태가 바뀐 지 N시간 전". a11y 라벨도 갱신.
- **푸시 title 의 끝4자리 표기는 이 step 범위 아님**(worker `buildMessage`) — 잠금화면 노출 최소화 위해 그대로 둔다.

### 3. **양방향 스와이프 — 버튼 노출 후 실행** (Swipeable)
인터랙션 모델: **첫 스와이프는 즉시 동작하지 않고 액션 버튼을 "노출"만** 한다(열린 정지 상태). 실행은 **(a) 노출된 버튼 탭** 또는 **(b) 한 번 더(끝까지) 스와이프** 로 일어난다. iOS Mail 식 reveal 패턴.

- **좌측 스와이프(콘텐츠가 왼쪽으로, 오른쪽에 버튼 노출) = 삭제 버튼**:
  - 버튼: `Trash` + "삭제"(예외 색). `renderRightActions` 로 렌더.
  - 실행(버튼 탭 또는 추가 스와이프) → **낙관적 삭제 + Undo 토스트**(`doDelete`→`commitDelete`, UNDO_WINDOW_MS). reveal 자체가 의도 확인 게이트이므로 **별도 확인 다이얼로그는 두지 않는다**(reveal + Undo 로 오삭제 방지·복구). 실행 후 행 닫기.
- **우측 스와이프(콘텐츠가 오른쪽으로, 왼쪽에 버튼 노출) = 음소거 버튼**:
  - 버튼: 음소거 중이면 `Bell` + "알림 켜기", 아니면 `BellOff` + "알림 끄기"(중립 색). `renderLeftActions` 로 렌더.
  - 실행(버튼 탭 또는 추가 스와이프) → `muteShipment(id, !muted)` **낙관적 토글**(카드 muted 즉시 반영) → 실패 시 롤백 + 토스트("알림을 껐어요/켰어요"). 실행 후 행 닫기.
  - 카드에 음소거 상태 표시: muted면 카드 한 켠에 `BellOff` 아이콘(작게, 색 단독 아님).
- 방향 매핑(사용자 사양): **좌측 스와이프 = 삭제, 우측 스와이프 = 음소거**. (현행 좌=삭제와 같은 방향이지만, 즉시 삭제 → "버튼 노출 후 탭/추가 스와이프 실행"으로 인터랙션 변경.)
- "추가 스와이프로 실행"은 더 큰 임계(예: 카드 폭의 일정 비율)를 넘겨 열렸을 때 자동 실행으로 구현(gesture-handler `onSwipeableOpen`/임계). 일반 스와이프는 버튼만 노출(정지).
- reduce motion 시 스와이프/열림 애니메이션 축소(시스템 설정 존중).
- **UI_GUIDE 갱신**: "인터랙션 > 스와이프 삭제"의 "확인 다이얼로그 + Undo" 를 **"버튼 노출 → 탭/추가 스와이프 실행 + Undo"** 로 수정한다(좌=삭제/우=음소거 명시).

### 4. **롱프레스 멀티선택 + 일괄 삭제**
- 카드 롱프레스 → **선택 모드** 진입. 선택 모드 상태(`selectedIds: Set<string>`)를 목록 화면이 보유.
- 선택 모드 UI:
  - 각 카드 좌측에 체크박스(`Check` 아이콘 토글, 색 단독 아님). 카드 **탭=선택 토글**(상세 이동 아님). 스와이프 제스처 **비활성**(선택 중 오작동 방지).
  - 헤더가 "N개 선택"으로 바뀌고 **전체선택**·**취소**·**일괄삭제**(`Trash`, 예외 색) 노출. 롱프레스한 카드는 즉시 선택됨.
- 일괄 삭제:
  - **확인 다이얼로그**: "선택한 N개를 삭제할까요?" → 삭제. **일괄 삭제는 Undo 없음**(N건 복원 복잡 — 단건 스와이프 삭제만 Undo 유지). 이 결정을 코드 주석에 남겨라.
  - 실행: 선택된 id들에 `deleteShipment` 병렬 호출. **부분 실패 처리**: 실패한 id는 목록에 복원 + "일부를 삭제하지 못했어요" 토스트. 전부 성공 시 선택 모드 종료.
- 선택 모드 종료: 취소 버튼 / 전부 해제 / 삭제 완료 시.

### 5. 정렬·상태별 UI 보존
- 기존 `sortShipments`(진행 중 우선) 유지. 음소거 여부는 정렬에 영향 없음(표시만). 오프라인 배너·빈 상태·당겨서 새로고침·캐시 우선 렌더 유지.

## 엣지케이스 / 에러 핸들링 (반드시 처리)
- 음소거 토글 중 네트워크 실패 → 낙관적 상태 롤백 + 토스트(코드/기술 메시지 비노출).
- 선택 모드에서 당겨서 새로고침/포커스 복귀로 목록이 갱신될 때, 삭제·사라진 id는 `selectedIds`에서 제거(허상 선택 방지).
- 단건 스와이프 삭제 Undo 창이 열린 상태에서 선택 모드 진입 시 대기 삭제 먼저 확정(`flushPending`).
- 전체선택 후 일부만 서버에서 사라진 경우(다른 기기 삭제) 삭제 호출 404는 "성공"으로 간주(이미 없음 → 멱등).

## 금지사항
- 좌/우 스와이프 의미를 바꾸지 마라(좌=삭제, 우=음소거 — 사용자 사양).
- 첫 스와이프에서 즉시 삭제/음소거하지 마라 — **버튼을 먼저 노출**하고, 버튼 탭 또는 한 번 더(끝까지) 스와이프 시 실행.
- 일괄 삭제에 Undo를 억지로 넣지 마라(과설계). 단건 스와이프 삭제의 Undo는 유지.
- 선택 모드에서 탭이 상세로 이동하게 두지 마라(선택 토글이어야 함).
- 서버 에러 코드/기술 메시지를 토스트에 노출하지 마라(PRD 톤).
- 끝4자리로 되돌리지 마라 — 카드엔 전체 번호.
- 기존 테스트를 깨뜨리지 마라.

## Acceptance Criteria
```bash
npm run verify
```
- 순수 로직(선택 집합 관리·정렬·시간 소스)은 단위 테스트 가능한 형태로 분리하고 테스트를 추가(예: `selectedIds` reducer/헬퍼, statusChangedAt 사용).

## 검증 절차
1. AC 실행.
2. 체크리스트: ＋버튼→등록 / 전체 번호 / 업데이트=statusChangedAt / 좌스와이프=삭제버튼 노출→탭·추가스와이프 실행(+Undo)·우스와이프=음소거버튼 노출→탭·추가스와이프 토글(낙관+롤백) / 첫 스와이프는 버튼 노출만 / 롱프레스 멀티선택+일괄삭제(확인·부분실패 처리·Undo없음) / muted 카드 표시(아이콘) / 터치44·reduce motion / 토큰 색만.
3. `phases/06-ui-v0-redesign-pages/index.json` step 2 업데이트.
