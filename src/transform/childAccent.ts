/**
 * 아이 테마색(내 색깔 고르기).
 *
 * 서버에 아이별 색상 컬럼이 없다(users·family_members·ai_parent_settings 어디에도).
 * 그래서 기기 로컬에만 저장한다 — 가족+아이 단위 키라 같은 기기를 다른 아이가 써도 섞이지 않는다.
 * 서버 저장이 아니므로 기기를 바꾸면 기본색(rose)으로 돌아간다(정직한 한계).
 *
 * 색 값 자체는 tokens.css 의 `[data-accent="…"]` 가 단일 출처다. 여기선 키/라벨/미리보기 색만 다룬다.
 */
import type { AccentKey } from "@/theme/theme";

export interface ChildAccentOption {
  key: AccentKey;
  label: string;
  /** 스와치 미리보기 색 — tokens.css 의 --hy-accent 와 같은 값. */
  color: string;
}

export const CHILD_ACCENTS: readonly ChildAccentOption[] = [
  { key: "rose", label: "핑크", color: "#F76BA6" },
  { key: "peach", label: "살구", color: "#FF9E7A" },
  { key: "lavender", label: "보라", color: "#A78BFA" },
  { key: "mint", label: "민트", color: "#31C48D" },
  { key: "sky", label: "하늘", color: "#4FB2E8" },
  { key: "lemon", label: "레몬", color: "#F5C542" },
];

export const DEFAULT_ACCENT: AccentKey = "rose";

const PREFIX = "hyeni-child-accent-v1";

export function isAccentKey(value: unknown): value is AccentKey {
  return typeof value === "string" && CHILD_ACCENTS.some((a) => a.key === value);
}

/** 가족+아이 단위 저장 키. 둘 중 하나라도 없으면 저장/복원하지 않는다(오귀속 방지). */
export function childAccentKey(familyId: string | null, userId: string | null): string | null {
  if (!familyId || !userId) return null;
  return `${PREFIX}:${familyId}:${userId}`;
}

export interface AccentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readChildAccent(
  storage: AccentStorage,
  familyId: string | null,
  userId: string | null,
): AccentKey | null {
  const key = childAccentKey(familyId, userId);
  if (!key) return null;
  try {
    const raw = storage.getItem(key);
    return isAccentKey(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeChildAccent(
  storage: AccentStorage,
  familyId: string | null,
  userId: string | null,
  accent: AccentKey,
): boolean {
  const key = childAccentKey(familyId, userId);
  if (!key || !isAccentKey(accent)) return false;
  try {
    storage.setItem(key, accent);
    return true;
  } catch {
    return false;
  }
}
