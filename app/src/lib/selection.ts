/**
 * 멀티선택 집합 관리 — 순수. 목록 화면의 선택 모드(롱프레스 진입) 상태를 비파괴로 갱신한다.
 * 입력 Set 을 변형하지 않고 매번 새 Set 을 반환(React 상태 갱신 안전). 선택 모드 = size>0 로 파생.
 */

/** 선택 토글 — 있으면 제거, 없으면 추가. 새 Set 반환. */
export function toggleSelected(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** 전체선택 — 현재 보이는 id 전부를 선택한 새 Set. */
export function selectAll(ids: Iterable<string>): Set<string> {
  return new Set(ids);
}

/** 보이는 id 가 모두 선택됐는지(전체선택 버튼 상태/판정용). 빈 목록은 false. */
export function allSelected(selected: ReadonlySet<string>, ids: readonly string[]): boolean {
  return ids.length > 0 && ids.every((id) => selected.has(id));
}

/**
 * 허상 선택 제거 — 목록 갱신(새로고침·다른 기기 삭제)으로 사라진 id 를 선택 집합에서 떨군다.
 * 남은 선택이 0이면 빈 Set(호출부가 size===0 으로 선택 모드 종료를 파생).
 */
export function pruneSelected(
  selected: ReadonlySet<string>,
  existingIds: Iterable<string>,
): Set<string> {
  const exist = new Set(existingIds);
  const next = new Set<string>();
  for (const id of selected) if (exist.has(id)) next.add(id);
  return next;
}
