/**
 * 로컬 표시 설정(서버 무관 — ADR-025): 시작 화면 + 택배함 "완료 숨기기" 필터.
 * docs/ARCHITECTURE.md "로컬 스토어"(unboxing.home_screen·unboxing.list_filter).
 *
 * - 시작 화면 기본 = 택배함("list"). 대시보드 선호 시 "dashboard"(콜드스타트 초기 탭, resolveInitialRoute).
 * - 필터 기본 = 완료 숨기기 off. **상태 칩은 세션 UI 상태라 비지속**(여기 저장 안 함 — "완료 숨기기"만 지속).
 * - 미설정·손상값은 기본값으로 폴백(앱 안전). 서버 동기화 없음 — 로컬 전용(Phase 2 계정).
 * - store 주입(결정적 테스트) — cache.ts 의 KeyValueStore 재사용.
 */
import { type KeyValueStore, cacheStore } from "./cache";

const HOME_KEY = "unboxing.home_screen";
const FILTER_KEY = "unboxing.list_filter";

/** 콜드스타트 시작 화면. 기본 "list"(택배함). */
export type HomePref = "list" | "dashboard";

/** 지속되는 택배함 필터 — "완료 숨기기"만(상태 칩은 비지속). */
export interface ListFilterPref {
  hideCompleted: boolean;
}

const DEFAULT_HOME: HomePref = "list";
const DEFAULT_FILTER: ListFilterPref = { hideCompleted: false };

/** 시작 화면 preference(미설정·손상 → "list"). */
export async function loadHomePref(deps: { store: KeyValueStore }): Promise<HomePref> {
  const raw = await deps.store.getItem(HOME_KEY);
  return raw === "list" || raw === "dashboard" ? raw : DEFAULT_HOME;
}

export async function saveHomePref(pref: HomePref, deps: { store: KeyValueStore }): Promise<void> {
  await deps.store.setItem(HOME_KEY, pref);
}

export async function clearHomePref(deps: { store: KeyValueStore }): Promise<void> {
  await deps.store.removeItem(HOME_KEY);
}

/** 택배함 필터 preference(미설정·손상 → 완료 숨기기 off). */
export async function loadListFilter(deps: { store: KeyValueStore }): Promise<ListFilterPref> {
  const raw = await deps.store.getItem(FILTER_KEY);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") {
        const hide = (parsed as Record<string, unknown>).hideCompleted;
        if (typeof hide === "boolean") return { hideCompleted: hide };
      }
    } catch {
      // 손상 JSON → 기본값.
    }
  }
  return { ...DEFAULT_FILTER };
}

export async function saveListFilter(
  pref: ListFilterPref,
  deps: { store: KeyValueStore },
): Promise<void> {
  await deps.store.setItem(FILTER_KEY, JSON.stringify({ hideCompleted: pref.hideCompleted }));
}

export async function clearListFilter(deps: { store: KeyValueStore }): Promise<void> {
  await deps.store.removeItem(FILTER_KEY);
}

/** 운영용 저장소 — cache 와 동일 AsyncStorage 인스턴스(키만 다름). */
export const prefsStore = cacheStore;
