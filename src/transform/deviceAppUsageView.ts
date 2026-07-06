export interface DeviceAppUsageInput {
  name?: string | null;
  packageName?: string | null;
  usageMs?: number | null;
  percent?: number | null;
  lastTimeUsed?: number | null;
}

export interface DeviceAppUsageHealthInput {
  recentApp?: string | null;
  appUsage?: readonly DeviceAppUsageInput[] | null;
}

export interface DeviceAppUsageItemView {
  id: string;
  name: string;
  timeLabel: string;
  percent: number | null;
  isLatest: boolean;
}

export interface DeviceAppUsageView {
  recentAppLabel: string | null;
  mostUsedApp: DeviceAppUsageItemView | null;
  topApps: DeviceAppUsageItemView[];
}

function appUsageTimeLabelFrom(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  const totalMin = Math.max(1, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h}시간 ${m}분`;
  if (h > 0) return `${h}시간`;
  return `${m}분`;
}

function normalizeAppText(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function cleanRecentAppLabel(value: string | null | undefined): string {
  const label = (value || "").trim();
  if (!label || label.includes("권한 필요")) return "";
  return label;
}

function appRowMatchesRecent(row: DeviceAppUsageInput, recent: string): boolean {
  if (!recent) return false;
  const normalizedRecent = normalizeAppText(recent);
  return normalizeAppText(row.name) === normalizedRecent
    || normalizeAppText(row.packageName) === normalizedRecent;
}

function cleanPercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function buildDeviceAppUsageView(
  health: DeviceAppUsageHealthInput,
  maxRows = 3,
): DeviceAppUsageView {
  const recent = cleanRecentAppLabel(health.recentApp);
  const rows = Array.isArray(health.appUsage) ? health.appUsage : [];
  const topApps = rows
    .map((row, index) => {
      const name = (row.name || row.packageName || "").trim();
      const usageMs = typeof row.usageMs === "number" && Number.isFinite(row.usageMs) ? row.usageMs : 0;
      const timeLabel = appUsageTimeLabelFrom(usageMs);
      if (!name || !timeLabel) return null;
      const packageName = (row.packageName || "").trim();
      return {
        id: `${packageName || name}-${index}`,
        name,
        timeLabel,
        percent: cleanPercent(row.percent),
        isLatest: appRowMatchesRecent(row, recent),
        usageMs,
        lastTimeUsed: typeof row.lastTimeUsed === "number" && Number.isFinite(row.lastTimeUsed)
          ? row.lastTimeUsed
          : 0,
        originalIndex: index,
      };
    })
    .filter((row): row is DeviceAppUsageItemView & {
      usageMs: number;
      lastTimeUsed: number;
      originalIndex: number;
    } => row !== null)
    .sort((a, b) => b.usageMs - a.usageMs || b.lastTimeUsed - a.lastTimeUsed || a.originalIndex - b.originalIndex)
    .slice(0, maxRows)
    .map((row) => ({
      id: row.id,
      name: row.name,
      timeLabel: row.timeLabel,
      percent: row.percent,
      isLatest: row.isLatest,
    }));

  return {
    recentAppLabel: recent || null,
    mostUsedApp: topApps[0] ?? null,
    topApps,
  };
}
