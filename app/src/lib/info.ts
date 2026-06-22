/**
 * 택배 정보(메모·카테고리·금액) 로컬 스토어 — 기존 메모를 확장(ADR-024, 로컬 전용·서버 미전송).
 * docs/ARCHITECTURE.md "로컬 스토어"(키 unboxing.shipment_info v2)·"마이그레이션(메모→택배 정보)"·"v1.1 설계 보강 ⑥·⑦".
 *
 * - 형태: Record<shipmentId, ShipmentInfo>. memo·category·amount 모두 **선택**(미설정=키 없음).
 * - 카테고리: 미설정 = 값 없음(별도 "미지정" 의사값 두지 않음, 보강⑥). 고정 목록의 `기타` 는 실제 catch-all.
 *   목록 외 레거시 값도 저장·표시 허용(검증으로 거르지 않음).
 * - 금액: 검증은 amount.ts parseAmount(0 이상 정수) — 이 스토어는 number 면 그대로 저장(0 포함).
 * - 구 메모 스토어(unboxing.memos, Record<string,string>)에서 1회·멱등·무손실 마이그레이션(migrateMemosToInfo).
 *   ⚠️ 표시용 메모 API(defaultMemoText 등)는 memo.ts 에 그대로 둔다(회귀 금지 — 카드·상세가 import).
 * - store 주입(결정적 테스트) — cache.ts 의 KeyValueStore 재사용. 손상 JSON 은 빈 객체로 안전 처리(loadMemos 규칙).
 */
import { type KeyValueStore, cacheStore } from "./cache";

const INFO_KEY = "unboxing.shipment_info";
/** 구 메모 키(마이그레이션 원천). memo.ts MEMO_KEY 와 동일 문자열을 미러 — memo.ts 를 건드리지 않기 위해 로컬 선언. */
const LEGACY_MEMO_KEY = "unboxing.memos";

/** 택배 정보 — trash.ts TrashInfo 와 구조 호환(복구 시 양방향 할당). 모든 필드 선택. */
export interface ShipmentInfo {
  memo?: string;
  category?: string;
  amount?: number;
}

export type InfoMap = Record<string, ShipmentInfo>;

/**
 * 카테고리 고정 목록(택배 정보 모달의 선택지·단일 출처) — docs/PRD.md "v1.1 기능 명세 4".
 * **선택 안 함이 기본(미설정=값 없음·칩 없음)** — 별도 "미지정" 의사값을 두지 않는다(보강⑥).
 * 마지막 `기타` 는 실제 catch-all 카테고리이지 "미설정" 이 아니다. 목록 외 레거시 값도 표시는 허용.
 */
export const CATEGORIES = [
  "식품",
  "생활용품",
  "의류·패션",
  "뷰티",
  "전자·디지털",
  "도서·문구",
  "가구·인테리어",
  "유아·반려",
  "기타",
] as const;

/** 저장된 정보 맵(없으면 빈 객체). 손상 JSON·비객체는 빈 객체로 안전 처리. */
export async function loadInfo(deps: { store: KeyValueStore }): Promise<InfoMap> {
  const raw = await deps.store.getItem(INFO_KEY);
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as InfoMap) : {};
  } catch {
    return {};
  }
}

async function saveInfo(map: InfoMap, deps: { store: KeyValueStore }): Promise<void> {
  await deps.store.setItem(INFO_KEY, JSON.stringify(map));
}

/** 송장 1건의 정보(없으면 빈 객체). */
export async function getInfo(id: string, deps: { store: KeyValueStore }): Promise<ShipmentInfo> {
  const map = await loadInfo(deps);
  return map[id] ?? {};
}

/**
 * 정보 설정 — 빈 메모는 memo 필드 삭제, 미설정 category/amount 는 미저장(키 자체 없음).
 * 모든 필드가 빈/미설정이면 해당 id 엔트리를 제거한다. 갱신된 맵 반환.
 * amount 는 0 이 유효값이라 `=== undefined` 로만 미설정 판정(falsy 금지 — 0 보존).
 */
export async function setInfo(
  id: string,
  info: ShipmentInfo,
  deps: { store: KeyValueStore },
): Promise<InfoMap> {
  const map = await loadInfo(deps);
  const next: ShipmentInfo = {};
  const memo = info.memo?.trim();
  if (memo) next.memo = memo;
  if (typeof info.category === "string" && info.category !== "") next.category = info.category;
  if (info.amount !== undefined) next.amount = info.amount;

  if (Object.keys(next).length === 0) delete map[id];
  else map[id] = next;
  await saveInfo(map, deps);
  return map;
}

/** keepIds 에 없는(=삭제된 송장의) 정보를 정리. 갱신된 맵 반환(변경 없으면 그대로). */
export async function pruneInfo(
  keepIds: string[],
  deps: { store: KeyValueStore },
): Promise<InfoMap> {
  const map = await loadInfo(deps);
  const keep = new Set(keepIds);
  let changed = false;
  for (const id of Object.keys(map)) {
    if (!keep.has(id)) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) await saveInfo(map, deps);
  return map;
}

/** 전체 정보 폐기(모든 데이터 삭제 — ADR-017, wipeAllData 가 호출). */
export async function clearInfo(deps: { store: KeyValueStore }): Promise<void> {
  await deps.store.removeItem(INFO_KEY);
}

/**
 * 순수 변환: 구 메모 맵(문자열 값) → 신 정보 맵. 비문자 값은 스킵(손상 안전), 문자열은 trim·빈값 스킵.
 * 분리된 순수 함수라 단위 테스트로 변환 규칙만 검증한다(저장소 무관).
 */
export function memosToInfoMap(memos: Record<string, unknown>): InfoMap {
  const info: InfoMap = {};
  for (const [id, val] of Object.entries(memos)) {
    if (typeof val !== "string") continue;
    const t = val.trim();
    if (t) info[id] = { memo: t };
  }
  return info;
}

/**
 * 구 메모(unboxing.memos) → 신 택배 정보(unboxing.shipment_info) 1회·멱등·무손실 마이그레이션(보강⑦).
 * bootstrap 에서 1회 호출(목록·info 첫 읽기 전). 갱신된 신 맵 반환.
 *
 * 규칙:
 * - 신 키 존재 → 신 우선(그대로). 구 키가 있으면 정리(신·구 동시 케이스).
 * - 신 키 없고 구 키 존재 → `{id:text}` → `{id:{memo:text}}` 변환·신 키 기록·구 키 제거.
 * - 둘 다 없음 → no-op(빈 맵). 손상 구 JSON·비문자 값 → 안전(빈/스킵).
 * 멱등: 1회 변환 후 구 키가 사라지므로 2회째는 신 키만 보고 데이터를 바꾸지 않는다.
 */
export async function migrateMemosToInfo(deps: { store: KeyValueStore }): Promise<InfoMap> {
  const newRaw = await deps.store.getItem(INFO_KEY);
  if (newRaw !== null) {
    // 신 키 존재 → 신 우선. 구 키가 남아 있으면 정리(중복 표시·재변환 방지).
    if ((await deps.store.getItem(LEGACY_MEMO_KEY)) !== null) {
      await deps.store.removeItem(LEGACY_MEMO_KEY);
    }
    return loadInfo(deps);
  }

  const legacyRaw = await deps.store.getItem(LEGACY_MEMO_KEY);
  if (legacyRaw === null) return {}; // 둘 다 없음 → no-op.

  let legacyMap: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(legacyRaw) as unknown;
    if (parsed && typeof parsed === "object") legacyMap = parsed as Record<string, unknown>;
  } catch {
    legacyMap = {}; // 손상 구 JSON → 빈 맵(안전).
  }

  const info = memosToInfoMap(legacyMap);
  await saveInfo(info, deps);
  await deps.store.removeItem(LEGACY_MEMO_KEY);
  return info;
}

/** 운영용 저장소 — cache 와 동일 AsyncStorage 인스턴스(키만 다름). */
export const infoStore = cacheStore;
