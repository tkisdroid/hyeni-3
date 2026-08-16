import type { IntlShape } from "react-intl";
import { withDefaultIntl } from "../i18n/defaultIntl.ts";

export interface DeviceNotificationHealthInput {
  lastReportedAt?: string | null;
  updatedAt?: string | null;
  postNotif?: boolean | null;
  postPermissionGranted?: boolean | null;
  notificationsEnabled?: boolean | null;
  requiredChannelsEnabled?: boolean | null;
  fullScreenIntentAllowed?: boolean | null;
  remoteListenChannelEnabled?: boolean | null;
}

export interface DeviceLocationHealthInput extends DeviceNotificationHealthInput {
  backgroundLocationGranted?: boolean | null;
  /** 구버전 네이티브 보고의 백그라운드 위치 권한 종합값. */
  locationOk?: boolean | null;
  locationServiceRunning?: boolean | null;
  backgroundRestricted?: boolean | null;
  networkConnected?: boolean | null;
}

export type DeviceNotificationHealthState = "ready" | "attention" | "unknown";

export interface DeviceNotificationHealthView {
  state: DeviceNotificationHealthState;
  label: string;
  /** 홈 컴팩트 칩용 짧은 라벨. 상세 안내는 label/detail 을 사용한다. */
  shortLabel: string;
  detail: string;
}

export interface DeviceNotificationHealthOptions {
  now?: Date;
  /** 아이 계정의 서버 notification_settings.child_enabled. 조회 전/실패는 null. */
  childScheduleEnabled?: boolean | null;
  childScheduleLoadState?: "loading" | "error" | "ready";
}

export type DeviceOverallSafetyState = DeviceNotificationHealthState;

const DEVICE_HEALTH_FRESH_MS = 10 * 60 * 1000;

function isRecentDeviceReport(
  health: DeviceNotificationHealthInput | null | undefined,
  now: Date,
): boolean {
  const raw = health?.lastReportedAt ?? health?.updatedAt;
  if (!raw) return false;
  const reportedAt = new Date(raw).getTime();
  if (!Number.isFinite(reportedAt)) return false;
  return Math.max(0, now.getTime() - reportedAt) <= DEVICE_HEALTH_FRESH_MS;
}

export function deviceOverallSafetyState(
  lowBattery: boolean,
  notificationState: DeviceNotificationHealthState,
  locationState: DeviceNotificationHealthState,
  networkConnected: boolean | null | undefined,
): DeviceOverallSafetyState {
  if (
    lowBattery
    || networkConnected === false
    || notificationState === "attention"
    || locationState === "attention"
  ) {
    return "attention";
  }
  if (
    networkConnected !== true
    || notificationState === "unknown"
    || locationState === "unknown"
  ) {
    return "unknown";
  }
  return "ready";
}

export function deviceOverallSafetyLabel(
  lowBattery: boolean,
  notificationState: DeviceNotificationHealthState,
  locationState: DeviceNotificationHealthState,
  networkConnected: boolean | null | undefined,
  providedIntl?: IntlShape,
): string {
  const intl = withDefaultIntl(providedIntl);
  const state = deviceOverallSafetyState(
    lowBattery,
    notificationState,
    locationState,
    networkConnected,
  );
  return intl.formatMessage({ id: `parent.device.safety.${state}` });
}

/**
 * 아이 Android가 보고한 실제 OS 표시 상태와 아이 계정의 일정 알림 설정을 함께 본다.
 * 이 값은 전달 성공 증명이 아니므로 "수신 정상"이라고 단정하지 않는다.
 */
export function deviceNotificationHealthView(
  health: DeviceNotificationHealthInput | null | undefined,
  options: DeviceNotificationHealthOptions = {},
  providedIntl?: IntlShape,
): DeviceNotificationHealthView {
  const intl = withDefaultIntl(providedIntl);
  const now = options.now ?? new Date();
  if (options.childScheduleEnabled === false) {
    return {
      state: "attention",
      label: intl.formatMessage({ id: "parent.device.notification.scheduleAttentionLabel" }),
      shortLabel: intl.formatMessage({ id: "parent.device.notification.attentionShort" }),
      detail: intl.formatMessage({ id: "parent.device.notification.scheduleDisabledDetail" }),
    };
  }
  if (health?.postPermissionGranted === false) {
    return {
      state: "attention",
      label: intl.formatMessage({ id: "parent.device.notification.attentionLabel" }),
      shortLabel: intl.formatMessage({ id: "parent.device.notification.attentionShort" }),
      detail: intl.formatMessage({ id: "parent.device.notification.permissionDisabledDetail" }),
    };
  }
  if (health?.notificationsEnabled === false) {
    return {
      state: "attention",
      label: intl.formatMessage({ id: "parent.device.notification.attentionLabel" }),
      shortLabel: intl.formatMessage({ id: "parent.device.notification.attentionShort" }),
      detail: intl.formatMessage({ id: "parent.device.notification.appDisabledDetail" }),
    };
  }
  if (health?.requiredChannelsEnabled === false) {
    return {
      state: "attention",
      label: intl.formatMessage({ id: "parent.device.notification.attentionLabel" }),
      shortLabel: intl.formatMessage({ id: "parent.device.notification.attentionShort" }),
      detail: intl.formatMessage({ id: "parent.device.notification.channelsDisabledDetail" }),
    };
  }
  if (health?.fullScreenIntentAllowed === false) {
    return {
      state: "attention",
      label: intl.formatMessage({ id: "parent.device.notification.fullScreenAttentionLabel" }),
      shortLabel: intl.formatMessage({ id: "parent.device.notification.attentionShort" }),
      detail: intl.formatMessage({ id: "parent.device.notification.fullScreenDisabledDetail" }),
    };
  }
  if (health?.remoteListenChannelEnabled === false) {
    return {
      state: "attention",
      label: intl.formatMessage({ id: "parent.device.notification.remoteAudioAttentionLabel" }),
      shortLabel: intl.formatMessage({ id: "parent.device.notification.attentionShort" }),
      detail: intl.formatMessage({ id: "parent.device.notification.remoteAudioDisabledDetail" }),
    };
  }
  if (health?.postNotif === false) {
    return {
      state: "attention",
      label: intl.formatMessage({ id: "parent.device.notification.attentionLabel" }),
      shortLabel: intl.formatMessage({ id: "parent.device.notification.attentionShort" }),
      detail: intl.formatMessage({ id: "parent.device.notification.permissionOrChannelDetail" }),
    };
  }
  if (!isRecentDeviceReport(health, now)) {
    return {
      state: "unknown",
      label: intl.formatMessage({ id: "parent.device.notification.waitingLabel" }),
      shortLabel: intl.formatMessage({ id: "parent.device.notification.checkingShort" }),
      detail: health
        ? intl.formatMessage({ id: "parent.device.notification.staleDetail" })
        : intl.formatMessage({ id: "parent.device.notification.awaitingReportDetail" }),
    };
  }
  if (
    health?.postPermissionGranted === true
    && health.notificationsEnabled === true
    && health.requiredChannelsEnabled === true
    && health.fullScreenIntentAllowed === true
    && health.remoteListenChannelEnabled === true
  ) {
    if (options.childScheduleLoadState === "error") {
      return {
        state: "unknown",
        label: intl.formatMessage({ id: "parent.device.notification.scheduleLoadFailedLabel" }),
        shortLabel: intl.formatMessage({ id: "parent.device.notification.checkingShort" }),
        detail: intl.formatMessage({ id: "parent.device.notification.scheduleLoadFailedDetail" }),
      };
    }
    if (options.childScheduleEnabled !== true) {
      return {
        state: "unknown",
        label: intl.formatMessage({ id: "parent.device.notification.scheduleCheckingLabel" }),
        shortLabel: intl.formatMessage({ id: "parent.device.notification.checkingShort" }),
        detail: intl.formatMessage({ id: "parent.device.notification.scheduleCheckingDetail" }),
      };
    }
    return {
      state: "ready",
      label: intl.formatMessage({ id: "parent.device.notification.readyLabel" }),
      shortLabel: intl.formatMessage({ id: "parent.device.notification.readyShort" }),
      detail: intl.formatMessage({ id: "parent.device.notification.readyDetail" }),
    };
  }
  return {
    state: "unknown",
    label: intl.formatMessage({ id: "parent.device.notification.waitingLabel" }),
    shortLabel: intl.formatMessage({ id: "parent.device.notification.checkingShort" }),
    detail: intl.formatMessage({ id: "parent.device.notification.partialDetail" }),
  };
}

/** 아이 기기의 위치 권한·백그라운드 제한·서비스·네트워크를 정직하게 요약한다. */
export function deviceLocationHealthView(
  health: DeviceLocationHealthInput | null | undefined,
  now: Date = new Date(),
  providedIntl?: IntlShape,
): DeviceNotificationHealthView {
  const intl = withDefaultIntl(providedIntl);
  const backgroundLocationGranted = typeof health?.backgroundLocationGranted === "boolean"
    ? health.backgroundLocationGranted
    : health?.locationOk;

  if (backgroundLocationGranted === false) {
    return {
      state: "attention",
      label: intl.formatMessage({ id: "parent.device.location.permissionAttentionLabel" }),
      shortLabel: intl.formatMessage({ id: "parent.device.location.attentionShort" }),
      detail: intl.formatMessage({ id: "parent.device.location.permissionDisabledDetail" }),
    };
  }
  if (health?.backgroundRestricted === true) {
    return {
      state: "attention",
      label: intl.formatMessage({ id: "parent.device.location.backgroundAttentionLabel" }),
      shortLabel: intl.formatMessage({ id: "parent.device.location.attentionShort" }),
      detail: intl.formatMessage({ id: "parent.device.location.backgroundRestrictedDetail" }),
    };
  }
  if (health?.locationServiceRunning === false) {
    return {
      state: "attention",
      label: intl.formatMessage({ id: "parent.device.location.serviceAttentionLabel" }),
      shortLabel: intl.formatMessage({ id: "parent.device.location.attentionShort" }),
      detail: intl.formatMessage({ id: "parent.device.location.serviceStoppedDetail" }),
    };
  }
  if (health?.networkConnected === false) {
    return {
      state: "attention",
      label: intl.formatMessage({ id: "parent.device.location.offlineLabel" }),
      shortLabel: intl.formatMessage({ id: "parent.device.location.offlineLabel" }),
      detail: intl.formatMessage({ id: "parent.device.location.offlineDetail" }),
    };
  }
  if (!isRecentDeviceReport(health, now)) {
    return {
      state: "unknown",
      label: intl.formatMessage({ id: "parent.device.location.waitingLabel" }),
      shortLabel: intl.formatMessage({ id: "parent.device.location.checkingShort" }),
      detail: health
        ? intl.formatMessage({ id: "parent.device.location.staleDetail" })
        : intl.formatMessage({ id: "parent.device.location.awaitingReportDetail" }),
    };
  }
  if (
    backgroundLocationGranted === true
    && health?.backgroundRestricted === false
    && health.locationServiceRunning === true
    && health.networkConnected === true
  ) {
    return {
      state: "ready",
      label: intl.formatMessage({ id: "parent.device.location.readyLabel" }),
      shortLabel: intl.formatMessage({ id: "parent.device.location.readyShort" }),
      detail: intl.formatMessage({ id: "parent.device.location.readyDetail" }),
    };
  }
  return {
    state: "unknown",
    label: intl.formatMessage({ id: "parent.device.location.waitingLabel" }),
    shortLabel: intl.formatMessage({ id: "parent.device.location.checkingShort" }),
    detail: intl.formatMessage({ id: "parent.device.location.partialDetail" }),
  };
}
