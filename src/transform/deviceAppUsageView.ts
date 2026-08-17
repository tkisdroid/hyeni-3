import type { IntlShape } from "react-intl";
import { withDefaultIntl } from "../i18n/defaultIntl.ts";

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

function appUsageTimeLabelFrom(
  ms: number | null | undefined,
  intl: IntlShape,
): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  const totalMin = Math.max(1, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) {
    return intl.formatMessage({ id: "parent.device.hoursMinutes" }, { hours: h, minutes: m });
  }
  if (h > 0) return intl.formatMessage({ id: "parent.device.hours" }, { hours: h });
  return intl.formatMessage({ id: "parent.device.minutes" }, { minutes: m });
}

function normalizeAppText(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function canonicalAppText(value: string | null | undefined): string {
  return normalizeAppText(value).normalize("NFKC").replace(/\s+/g, "");
}

function cleanRecentAppLabel(value: string | null | undefined): string {
  const label = (value || "").trim();
  if (!label || label.includes("권한 필요") || isSystemRecentApp(label)) return "";
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

// 혜니캘린더 자신은 "오늘 많이 쓴 앱" 대상이 아니다 — 부모가 보고 싶은 건 다른 앱 사용이고,
// 아이가 이 앱으로 위치·일정을 확인한 시간이 1위를 차지하면 신호가 묻힌다.
// 구버전 아이 기기 리포트에도 적용되도록 서버/네이티브가 아니라 표시 계층에서 거른다.
const OWN_APP_PACKAGE = "com.hyeni.calendar";
const OWN_APP_NAMES = new Set(["혜니캘린더", "hyeni calendar", "hyenicalendar"]);
const SYSTEM_SURFACE_NAMES = new Set([
  "시스템자녀보호기능",
  "systemparentalcontrols",
  "시스템ui",
  "systemui",
  "설정",
  "settings",
  "권한관리자",
  "permissioncontroller",
  "패키지설치프로그램",
  "packageinstaller",
  "설정마법사",
  "setupwizard",
]);
// 제조사 패키지를 끝없이 나열하지 않는다. Android OS 표면의 역할명과 정확한
// 패키지 세그먼트만 판별해 새 제조사에서도 동작하고 launcherpro 같은 앱은 보존한다.
const SYSTEM_SURFACE_PACKAGES = new Set([
  "android",
  "com.android.bluetooth",
  "com.android.externalstorage",
  "com.android.nfc",
  "com.android.networkstack",
  "com.android.phone",
  "com.android.providers.media",
  "com.android.shell",
  "com.android.webview",
  "com.google.android.gms",
  "com.google.android.networkstack",
  "com.google.android.webview",
]);
const SYSTEM_SURFACE_PACKAGE_SEGMENTS = new Set([
  "aod",
  "aodservice",
  "chooser",
  "devicecare",
  "documentsui",
  "home",
  "ime",
  "inputmethod",
  "intentresolver",
  "keyguard",
  "keyboard",
  "launcher",
  "lockscreen",
  "managedprovisioning",
  "nexuslauncher",
  "packageinstaller",
  "permissioncontroller",
  "provision",
  "provisioning",
  "quickstep",
  "recents",
  "resolver",
  "securitycenter",
  "settings",
  "setupwizard",
  "smartmanager",
  "systemmanager",
  "systemui",
  "trebuchet",
  "wallpaperpicker",
]);
const NUMBERED_SYSTEM_SURFACE_SEGMENTS = ["home", "launcher", "wallpaperpicker"] as const;

function isNumberedSystemSurfaceSegment(segment: string): boolean {
  return NUMBERED_SYSTEM_SURFACE_SEGMENTS.some((prefix) => {
    if (!segment.startsWith(prefix)) return false;
    const suffix = segment.slice(prefix.length);
    return suffix.length === 0 || /^\d+$/.test(suffix);
  });
}

function isSystemSurfacePackage(value: string | null | undefined): boolean {
  const packageName = normalizeAppText(value);
  if (!packageName) return false;
  if (SYSTEM_SURFACE_PACKAGES.has(packageName)) return true;
  return packageName
    .split(".")
    .some((segment) => SYSTEM_SURFACE_PACKAGE_SEGMENTS.has(segment)
      || isNumberedSystemSurfaceSegment(segment));
}

function isSystemSurfaceName(value: string | null | undefined): boolean {
  return SYSTEM_SURFACE_NAMES.has(canonicalAppText(value));
}

function isPackageLikeAppText(value: string | null | undefined): boolean {
  return /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(normalizeAppText(value));
}

function isSystemRecentApp(value: string | null | undefined): boolean {
  return isSystemSurfaceName(value)
    || isPackageLikeAppText(value);
}

function isUnresolvedPackageLabel(row: DeviceAppUsageInput): boolean {
  if (!isPackageLikeAppText(row.name)) return false;
  const packageName = normalizeAppText(row.packageName);
  return !packageName || normalizeAppText(row.name) === packageName;
}

function isSystemSurfaceRow(row: DeviceAppUsageInput): boolean {
  return isSystemSurfaceName(row.name)
    || isSystemSurfacePackage(row.packageName)
    || isSystemSurfacePackage(row.name)
    || isUnresolvedPackageLabel(row);
}

function isOwnAppRow(row: DeviceAppUsageInput): boolean {
  if (normalizeAppText(row.packageName) === OWN_APP_PACKAGE) return true;
  return OWN_APP_NAMES.has(normalizeAppText(row.name));
}

export function buildDeviceAppUsageView(
  health: DeviceAppUsageHealthInput,
  maxRows = 3,
  providedIntl?: IntlShape,
): DeviceAppUsageView {
  const intl = withDefaultIntl(providedIntl);
  const recent = cleanRecentAppLabel(health.recentApp);
  const rows = Array.isArray(health.appUsage) ? health.appUsage : [];
  const visibleRows = rows.filter((row) => !isOwnAppRow(row) && !isSystemSurfaceRow(row));
  const hasFilteredAppRows = visibleRows.length !== rows.length;
  const topApps = visibleRows
    .map((row, index) => {
      const name = (row.name || row.packageName || "").trim();
      const usageMs = typeof row.usageMs === "number" && Number.isFinite(row.usageMs) ? row.usageMs : 0;
      const timeLabel = appUsageTimeLabelFrom(usageMs, intl);
      if (!name || !timeLabel) return null;
      const packageName = (row.packageName || "").trim();
      return {
        id: `${packageName || name}-${index}`,
        name,
        timeLabel,
        percent: hasFilteredAppRows ? null : cleanPercent(row.percent),
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
