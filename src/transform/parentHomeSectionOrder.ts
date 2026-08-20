export const PARENT_HOME_SECTION_IDS = [
  "schedule",
  "ai_schedule",
  "children",
  "safety",
  "supplies",
  "memo",
  "shortcuts",
  "membership",
] as const;

export type ParentHomeSectionId = (typeof PARENT_HOME_SECTION_IDS)[number];

const SECTION_ID_SET = new Set<string>(PARENT_HOME_SECTION_IDS);

/** 저장값이 오래됐거나 깨져도 현재 섹션을 빠짐없이 한 번씩만 돌려준다. */
export function normalizeParentHomeSectionOrder(value: unknown): ParentHomeSectionId[] {
  const saved = Array.isArray(value)
    ? value.filter(
      (id): id is ParentHomeSectionId => typeof id === "string" && SECTION_ID_SET.has(id),
    )
    : [];
  const unique = [...new Set(saved)];
  return [
    ...unique,
    ...PARENT_HOME_SECTION_IDS.filter((id) => !unique.includes(id)),
  ];
}

/** source를 target 자리로 옮긴다. 드래그·키보드 재정렬이 같은 순수 함수를 쓴다. */
export function moveParentHomeSection(
  order: readonly ParentHomeSectionId[],
  source: ParentHomeSectionId,
  target: ParentHomeSectionId,
): ParentHomeSectionId[] {
  const normalized = normalizeParentHomeSectionOrder(order);
  const from = normalized.indexOf(source);
  const to = normalized.indexOf(target);
  if (from < 0 || to < 0 || from === to) return normalized;
  const next = [...normalized];
  next.splice(from, 1);
  next.splice(to, 0, source);
  return next;
}

export function parentHomeSectionOrderStorageKey(familyId: string): string {
  return `hyeni-parent-home-section-order-v1:${familyId}`;
}

/** 재정렬 사용법은 가족별 기기에서 최초 1회만 안내한다. */
export function parentHomeReorderHintStorageKey(familyId: string): string {
  return `hyeni-parent-home-reorder-hint-v1:${familyId}`;
}
