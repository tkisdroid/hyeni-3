export const SHOWN_PUSH_ID_LIMIT = 100;

export function shownPushLedgerKey(familyId: string, userId: string, pushId: string): string {
  const family = familyId.trim();
  const user = userId.trim();
  const push = pushId.trim();
  return family && user && push ? `${family}:${user}:${push}` : "";
}

export function mergeShownPushIds(existing: unknown, pushId: string): string[] {
  const normalized = Array.isArray(existing)
    ? existing.reduce<string[]>((ids, value) => {
      if (typeof value !== "string") return ids;
      const id = value.trim();
      if (id && !ids.includes(id)) ids.push(id);
      return ids;
    }, [])
    : [];
  const nextId = pushId.trim();
  if (!nextId) return normalized.slice(-SHOWN_PUSH_ID_LIMIT);
  return [...normalized.filter((id) => id !== nextId), nextId]
    .slice(-SHOWN_PUSH_ID_LIMIT);
}
