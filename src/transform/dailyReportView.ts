export type DailyReportSourceState = "ready" | "loading" | "error";
export type DailyReportStatus = "safe" | "attention" | "danger" | "empty" | "unavailable";
export type FreshnessStatus = "live" | "recent" | "stale" | "unknown";

export interface DailyReportAlertInput {
  alert_type: string;
  severity?: string | null;
  created_at: string;
}

export interface DailyReportStatusInput {
  sourceState: DailyReportSourceState;
  hasActiveChild: boolean;
  alerts: DailyReportAlertInput[];
  locationFreshness: FreshnessStatus;
  deviceSafetyLabel: string;
  deviceHasData: boolean;
  now?: Date;
}

export interface DailyReportStatusView {
  status: DailyReportStatus;
  title: string;
  description: string;
}

export interface DailySupplySummaryItem {
  label: string;
  done: boolean;
}

export interface DailySupplySummary {
  total: number;
  done: number;
  remaining: number;
  remainingLabels: string[];
}

const DANGER_ALERT_TYPES = new Set(["sos", "emergency", "sos_followup"]);
const ATTENTION_ALERT_TYPES = new Set(["not_arrived", "danger_zone", "danger_zone_entry", "danger_zone_exit"]);

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function isToday(value: string, now: Date): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return localDateKey(date) === localDateKey(now);
}

function hasAlert(
  alerts: DailyReportAlertInput[],
  now: Date,
  match: (alert: DailyReportAlertInput) => boolean,
): boolean {
  return alerts.some((alert) => isToday(alert.created_at, now) && match(alert));
}

export function deriveDailyReportStatus(input: DailyReportStatusInput): DailyReportStatusView {
  if (input.sourceState === "error") {
    return {
      status: "unavailable",
      title: "안심 데이터를 확인하지 못했어요",
      description: "안전 알림, 위치, 기기 상태를 다시 확인해 주세요.",
    };
  }

  if (input.sourceState === "loading") {
    return {
      status: "unavailable",
      title: "안심 데이터를 확인하고 있어요",
      description: "안전 알림, 위치, 기기 상태를 불러오고 있어요.",
    };
  }

  if (!input.hasActiveChild) {
    return {
      status: "empty",
      title: "연결된 아이가 없어요",
      description: "아이를 연결하면 오늘의 안심 리포트를 볼 수 있어요.",
    };
  }

  const now = input.now ?? new Date();
  const hasDanger = hasAlert(input.alerts, now, (alert) => {
    const type = alert.alert_type.toLowerCase();
    const severity = (alert.severity ?? "").toLowerCase();
    return DANGER_ALERT_TYPES.has(type) || severity === "emergency" || severity === "critical";
  });
  if (hasDanger) {
    return {
      status: "danger",
      title: "긴급 알림이 있었어요",
      description: "오늘 발생한 긴급 알림을 확인해 주세요.",
    };
  }

  const hasAttentionAlert = hasAlert(input.alerts, now, (alert) => {
    const type = alert.alert_type.toLowerCase();
    const severity = (alert.severity ?? "").toLowerCase();
    return ATTENTION_ALERT_TYPES.has(type) || severity === "warning" || severity === "urgent";
  });
  const needsDeviceCheck = !input.deviceHasData || input.deviceSafetyLabel === "주의 필요";
  const needsLocationCheck = input.locationFreshness === "stale" || input.locationFreshness === "unknown";
  if (hasAttentionAlert || needsDeviceCheck || needsLocationCheck) {
    return {
      status: "attention",
      title: "확인이 필요한 항목이 있어요",
      description: "위치, 기기 상태, 안전 알림을 한 번 더 확인해 주세요.",
    };
  }

  return {
    status: "safe",
    title: "안전하게 확인 중이에요",
    description: "오늘 아이의 흐름에 특별한 위험 신호가 없어요.",
  };
}

export function summarizeDailySupplies(items: DailySupplySummaryItem[]): DailySupplySummary {
  const normalized = items.filter((item) => item.label.trim());
  const done = normalized.filter((item) => item.done).length;
  const remainingLabels = normalized
    .filter((item) => !item.done)
    .map((item) => item.label.trim())
    .slice(0, 3);
  return {
    total: normalized.length,
    done,
    remaining: Math.max(0, normalized.length - done),
    remainingLabels,
  };
}
