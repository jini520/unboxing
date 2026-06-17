/**
 * 운송장별 메모(로컬 전용) — tracker.delivery 가 상품명을 주지 않으므로(조사 결론) 사용자가 "이게 무슨 택배인지"
 * 직접 적어 목록에서 식별한다. **서버에 보내지 않고 로컬 AsyncStorage 에만** 둔다(마찰 최소·서버 비영속 일관).
 * 단일 JSON 맵(shipmentId → text)으로 저장. store 주입(결정적 테스트) — cache.ts 의 KeyValueStore 재사용.
 * 빈/공백 메모는 저장하지 않는다(삭제). 송장 삭제분은 pruneMemos 로 정리(서버 목록 동기화 후).
 */
import { type KeyValueStore, cacheStore } from "./cache";

const MEMO_KEY = "unboxing.memos";

export type MemoMap = Record<string, string>;

/** 저장된 메모 맵(없으면 빈 객체). 손상 JSON 은 빈 객체로 안전 처리. */
export async function loadMemos(deps: { store: KeyValueStore }): Promise<MemoMap> {
  const raw = await deps.store.getItem(MEMO_KEY);
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as MemoMap) : {};
  } catch {
    return {};
  }
}

async function saveMemos(map: MemoMap, deps: { store: KeyValueStore }): Promise<void> {
  await deps.store.setItem(MEMO_KEY, JSON.stringify(map));
}

/** 메모 설정(공백이면 해당 id 삭제). 갱신된 맵을 반환. */
export async function setMemo(
  id: string,
  text: string,
  deps: { store: KeyValueStore },
): Promise<MemoMap> {
  const map = await loadMemos(deps);
  const t = text.trim();
  if (t) map[id] = t;
  else delete map[id];
  await saveMemos(map, deps);
  return map;
}

/** 송장 1건의 메모 삭제. */
export async function removeMemo(id: string, deps: { store: KeyValueStore }): Promise<void> {
  const map = await loadMemos(deps);
  if (id in map) {
    delete map[id];
    await saveMemos(map, deps);
  }
}

/** keepIds 에 없는(=삭제된 송장의) 메모를 정리. 갱신된 맵 반환(변경 없으면 그대로). */
export async function pruneMemos(
  keepIds: string[],
  deps: { store: KeyValueStore },
): Promise<MemoMap> {
  const map = await loadMemos(deps);
  const keep = new Set(keepIds);
  let changed = false;
  for (const id of Object.keys(map)) {
    if (!keep.has(id)) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) await saveMemos(map, deps);
  return map;
}

/** 전체 메모 폐기(모든 데이터 삭제 — ADR-017). */
export async function clearMemos(deps: { store: KeyValueStore }): Promise<void> {
  await deps.store.removeItem(MEMO_KEY);
}

/** 운영용 저장소 — cache 와 동일 AsyncStorage 인스턴스(키만 다름). */
export const memoStore = cacheStore;
