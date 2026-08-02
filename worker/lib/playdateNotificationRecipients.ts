export interface PlaydateNotificationSettingRow {
  user_id?: unknown;
  playdate_enabled?: unknown;
}

function settingEnabled(value: unknown): boolean {
  if (value == null) return true;
  if (value === false || value === 0) return false;
  const text = String(value).trim().toLowerCase();
  return text !== "false" && text !== "0";
}

export function collectPlaydateNotificationParentIds(
  rows: PlaydateNotificationSettingRow[] | null | undefined,
): string[] {
  return (rows ?? [])
    .filter((row) => settingEnabled(row.playdate_enabled))
    .map((row) => (typeof row.user_id === "string" ? row.user_id.trim() : ""))
    .filter(Boolean);
}
