/**
 * 휴지통(로컬 소프트 삭제) 스토어 — 삭제한 택배를 30일 안에 되살린다(ADR-022, 서버 무관·로컬 전용).
 * docs/ARCHITECTURE.md "로컬 스토어"(키 unboxing.trash)·"v1.1 설계 보강 ④"(스냅샷 먼저·reconcile·복구 id 귀속·30일·용량 상한).
 *
 * 삭제 시: 서버 DELETE /shipments/:id(구독 해제 — 추적 즉시 중단) + 여기에 스냅샷(info 포함) 적재.
 * 복구 = POST /shipments 재등록(멱등 dedupe + 즉시 track) → info 라이브 복원 → removeTrash (09 phase 화면).
 * 휴지통은 **기기 로컬에만** 둔다 — 서버 전송 금지(ADR-022). 30일·용량 정리는 now 주입(고정 시계)로 결정적.
 * 키 = dedupe 키 (carrier:trackingNo) — 복구 재등록 시 orphan 정리로 행 id 가 바뀔 수 있어 ephemeral id 를 쓰지 않는다.
 */
import { type KeyValueStore, cacheStore } from "./cache";
import type { Stage } from "./api";

const TRASH_KEY = "unboxing.trash";
const DAY = 86_400_000;
const RETENTION_MS = 30 * DAY;

/** 무한 증식 방지 용량 상한(보강 ④) — 초과 시 오래된 것부터 정리. */
export const MAX_TRASH = 200;

/** dedupe 키 "carrier:trackingNo". 키=ephemeral id 가 아니라 이 값(복구 재등록 시 행 id 가 바뀜). */
export type TrashKey = string;

/**
 * 휴지통에 보관하는 택배 정보(메모·카테고리·금액) 스냅샷 — step 2 ShipmentInfo 와 구조 호환.
 * 복구 시 라이브 정보 스토어로 그대로 복원한다(보강 ④). info 스토어는 step 2 라 여기선 의존 역전을
 * 피해 구조적 호환 타입을 둔다(두 타입은 필드가 같아 양방향 할당 가능).
 */
export interface TrashInfo {
  memo?: string;
  category?: string;
  amount?: number;
}

/** 삭제 직전 송장 스냅샷(deletedAt 제외) — addTrash 입력. */
export interface TrashSnapshot {
  carrier: string;
  trackingNo: string;
  status: Stage;
  createdAt: number;
  statusChangedAt: number;
  info?: TrashInfo;
}

/** 적재된 휴지통 항목 = 스냅샷 + 삭제 시각(로컬 시각, now 주입). */
export interface TrashEntry extends TrashSnapshot {
  deletedAt: number;
}

export type TrashMap = Record<TrashKey, TrashEntry>;

/** dedupe 키 생성. */
export function trashKey(carrier: string, trackingNo: string): TrashKey {
  return `${carrier}:${trackingNo}`;
}

/** 저장된 휴지통 맵(없으면 빈 객체). 손상 JSON·비객체는 빈 객체로 안전 처리(loadMemos 규칙). */
export async function loadTrash(deps: { store: KeyValueStore }): Promise<TrashMap> {
  const raw = await deps.store.getItem(TRASH_KEY);
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as TrashMap) : {};
  } catch {
    return {};
  }
}

async function saveTrash(map: TrashMap, deps: { store: KeyValueStore }): Promise<void> {
  await deps.store.setItem(TRASH_KEY, JSON.stringify(map));
}

/**
 * 삭제 스냅샷 적재. 키=carrier:trackingNo·deletedAt=now. 같은 키 재삭제는 덮어쓴다(최신 deletedAt).
 * 보강 ④: 스냅샷은 라이브 info 정리(pruneInfo)보다 **먼저** 기록돼야 info 유실이 없다(호출 순서는 09 화면).
 */
export async function addTrash(
  snapshot: TrashSnapshot,
  deps: { store: KeyValueStore; now: number },
): Promise<TrashMap> {
  const map = await loadTrash(deps);
  map[trashKey(snapshot.carrier, snapshot.trackingNo)] = { ...snapshot, deletedAt: deps.now };
  await saveTrash(map, deps);
  return map;
}

/**
 * 30일 경과분 영구 제거 + 용량 상한 초과 시 오래된 것부터 정리(보강 ④). bootstrap·휴지통 열람 시 호출.
 * 만료·상한 모두 로컬 시각(now 주입) 기준 — 시계 급변 시 경계가 어긋날 수 있음(로컬 편의 기능, 문서화됨).
 */
export async function pruneTrash(deps: { store: KeyValueStore; now: number }): Promise<TrashMap> {
  const map = await loadTrash(deps);
  let changed = false;

  // ① 30일 경과(deletedAt < now-30일) 제거.
  const cutoff = deps.now - RETENTION_MS;
  for (const key of Object.keys(map)) {
    if (map[key].deletedAt < cutoff) {
      delete map[key];
      changed = true;
    }
  }

  // ② 용량 상한 초과 시 오래된(deletedAt 작은) 것부터 제거.
  const keys = Object.keys(map);
  if (keys.length > MAX_TRASH) {
    keys.sort((a, b) => map[a].deletedAt - map[b].deletedAt);
    for (const key of keys.slice(0, keys.length - MAX_TRASH)) {
      delete map[key];
      changed = true;
    }
  }

  if (changed) await saveTrash(map, deps);
  return map;
}

/**
 * 서버 목록에 다시 나타난 키 제거(E4) — 수동 재등록·타 기기 복구로 라이브에 있는 항목을 휴지통서 비워
 * 중복 표시를 막는다. serverKeys 는 호출부가 목록에서 trashKey 로 만든다.
 */
export async function reconcileTrash(
  serverKeys: Set<TrashKey>,
  deps: { store: KeyValueStore },
): Promise<TrashMap> {
  const map = await loadTrash(deps);
  let changed = false;
  for (const key of Object.keys(map)) {
    if (serverKeys.has(key)) {
      delete map[key];
      changed = true;
    }
  }
  if (changed) await saveTrash(map, deps);
  return map;
}

/** 항목 1건 제거(영구삭제 또는 복구 성공 후). */
export async function removeTrash(key: TrashKey, deps: { store: KeyValueStore }): Promise<void> {
  const map = await loadTrash(deps);
  if (key in map) {
    delete map[key];
    await saveTrash(map, deps);
  }
}

/** 전체 휴지통 폐기(모든 데이터 삭제 — ADR-017, 09 의 wipeAllData 가 호출). */
export async function clearTrash(deps: { store: KeyValueStore }): Promise<void> {
  await deps.store.removeItem(TRASH_KEY);
}

/** 운영용 저장소 — cache 와 동일 AsyncStorage 인스턴스(키만 다름). */
export const trashStore = cacheStore;
