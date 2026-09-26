import { parseServerTimestamp } from "./locationView.ts";

/** 서버 "위치가 N분째 갱신되지 않아요" 알림(location_stale)과 같은 20분 기준. */
export const CHILD_DEVICE_SILENT_MS = 20 * 60 * 1000;
/** 이 이하로 보고한 뒤 끊기면 방전 가능성을 알린다(아이 폰은 5%에서 부모에게 저전력 알림을 보낸다). */
export const CHILD_LOW_BATTERY_PERCENT = 15;
/** 꺼질 때 배터리가 이 이하면 "배터리가 다 돼서 꺼졌어요"로 본다. */
export const CHILD_DEAD_BATTERY_PERCENT = 3;

/** 무응답 원인 — 전원 종료 신호·배터리 기록이 있을 때만 단정하고, 없으면 unknown 이다. */
export type ChildDeviceSilenceCause = "batteryDead" | "poweredOff" | "lowBattery" | "unknown";

export interface ChildDeviceHealthSnapshot {
  lastReportedAt?: string | null;
  updatedAt?: string | null;
  batteryLevel?: number | null;
  isCharging?: boolean | null;
  shutdownAt?: string | null;
  shutdownBatteryLevel?: number | null;
}

export interface ChildDeviceSilence {
  /** 마지막 연락(위치·기기 보고 중 늦은 쪽). 전원 종료면 꺼진 시각. */
  since: Date;
  cause: ChildDeviceSilenceCause;
  /** 마지막으로 알고 있는 배터리(꺼질 때 값이 있으면 그 값). */
  batteryLevel: number | null;
}

function percent(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null;
}

/**
 * 아이 폰이 위치도 기기 상태 보고도 보내지 않은 지 20분이 넘었으면 마지막 연락 시각과 짐작되는 원인을 돌려준다.
 *
 * 2026-09-26 실사례(razr): 성당 도착(18:55) 뒤 폰이 응답하지 않았고, 부모 Safari 화면은 "마지막 확인 · 2시간 전"만
 * 보여 줘서 "실시간이 안 된다"로 읽혔다. 서버·푸시는 정상 발송 중이었다 — 폰이 연결되지 않은 상태를 그대로 말한다.
 * 같은 날 "배터리가 닳아서 꺼져도 알 수 없다"는 제보로, 아이 폰의 전원 종료 신호(shutdownAt·그때 배터리)와 마지막
 * 배터리 보고로 원인을 구분한다. 둘 중 하나라도 최근이면(위치만 멈춘 경우 등) 폰 연결 문제로 단정하지 않는다.
 */
export function childDeviceSilence(input: {
  locationUpdatedAt?: string | null;
  health?: ChildDeviceHealthSnapshot | null;
  now: Date;
}): ChildDeviceSilence | null {
  const health = input.health ?? null;
  const times = [input.locationUpdatedAt, health?.lastReportedAt ?? health?.updatedAt]
    .map((value) => parseServerTimestamp(value ?? null))
    .filter((value): value is Date => value !== null);
  if (times.length === 0) return null;
  const latest = new Date(Math.max(...times.map((value) => value.getTime())));
  if (input.now.getTime() - latest.getTime() < CHILD_DEVICE_SILENT_MS) return null;

  const lastBattery = percent(health?.batteryLevel);
  const shutdownAt = parseServerTimestamp(health?.shutdownAt ?? null);
  // 전원 종료 신호가 마지막 연락 무렵(5분 전 이후)에 왔으면 그 끊김의 원인이다.
  if (shutdownAt && shutdownAt.getTime() >= latest.getTime() - 5 * 60 * 1000) {
    const shutdownBattery = percent(health?.shutdownBatteryLevel);
    const battery = shutdownBattery ?? lastBattery;
    // 꺼질 때 배터리(새 앱)가 있으면 그 값으로, 없으면(이전 앱) 마지막 보고가 저전력이었는지로 판단한다.
    const dead = health?.isCharging !== true && (shutdownBattery !== null
      ? shutdownBattery <= CHILD_DEAD_BATTERY_PERCENT
      : lastBattery !== null && lastBattery <= CHILD_LOW_BATTERY_PERCENT);
    return { since: shutdownAt, cause: dead ? "batteryDead" : "poweredOff", batteryLevel: battery };
  }
  if (lastBattery !== null && lastBattery <= CHILD_LOW_BATTERY_PERCENT && health?.isCharging !== true) {
    return { since: latest, cause: "lowBattery", batteryLevel: lastBattery };
  }
  return { since: latest, cause: "unknown", batteryLevel: lastBattery };
}

/** 이전 호출부 호환 — 마지막 연락 시각만 필요할 때. */
export function childDeviceSilentSince(input: {
  locationUpdatedAt?: string | null;
  deviceReportedAt?: string | null;
  now: Date;
}): Date | null {
  return childDeviceSilence({
    locationUpdatedAt: input.locationUpdatedAt,
    health: { updatedAt: input.deviceReportedAt ?? null },
    now: input.now,
  })?.since ?? null;
}

/** "오후 6:55"(같은 날) / "9월 26일 오후 6:55"(다른 날) — 가족 시간대 기준. */
export function childDeviceSilenceTimeLabel(
  since: Date,
  now: Date,
  locale: string,
  timeZone: string,
): string {
  const day = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const sameDay = day(since) === day(now);
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    ...(sameDay ? { timeStyle: "short" as const } : { dateStyle: "medium" as const, timeStyle: "short" as const }),
  }).format(since);
}
