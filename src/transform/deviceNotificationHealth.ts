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
  detail: string;
}

export interface DeviceNotificationHealthOptions {
  now?: Date;
  /** 아이 계정의 서버 notification_settings.child_enabled. 조회 전/실패는 null. */
  childScheduleEnabled?: boolean | null;
  childScheduleLoadState?: "loading" | "error" | "ready";
}

export type DeviceOverallSafetyLabel = "양호" | "주의 필요" | "확인 중";

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

export function deviceOverallSafetyLabel(
  lowBattery: boolean,
  notificationState: DeviceNotificationHealthState,
  locationState: DeviceNotificationHealthState,
  networkConnected: boolean | null | undefined,
): DeviceOverallSafetyLabel {
  if (
    lowBattery
    || networkConnected === false
    || notificationState === "attention"
    || locationState === "attention"
  ) {
    return "주의 필요";
  }
  if (
    networkConnected !== true
    || notificationState === "unknown"
    || locationState === "unknown"
  ) {
    return "확인 중";
  }
  return "양호";
}

/**
 * 아이 Android가 보고한 실제 OS 표시 상태와 아이 계정의 일정 알림 설정을 함께 본다.
 * 이 값은 전달 성공 증명이 아니므로 "수신 정상"이라고 단정하지 않는다.
 */
export function deviceNotificationHealthView(
  health: DeviceNotificationHealthInput | null | undefined,
  options: DeviceNotificationHealthOptions = {},
): DeviceNotificationHealthView {
  const now = options.now ?? new Date();
  if (options.childScheduleEnabled === false) {
    return {
      state: "attention",
      label: "일정 알림 설정 확인 필요",
      detail: "아이 앱의 일정 알림 설정이 꺼져 있어요.",
    };
  }
  if (health?.postPermissionGranted === false) {
    return {
      state: "attention",
      label: "알림 확인 필요",
      detail: "마지막 보고에서 아이 기기의 알림 권한이 꺼져 있어요.",
    };
  }
  if (health?.notificationsEnabled === false) {
    return {
      state: "attention",
      label: "알림 확인 필요",
      detail: "마지막 보고에서 아이 기기의 앱 알림이 꺼져 있어요.",
    };
  }
  if (health?.requiredChannelsEnabled === false) {
    return {
      state: "attention",
      label: "알림 확인 필요",
      detail: "마지막 보고에서 아이 기기의 필수 알림 채널 중 꺼진 항목이 있어요.",
    };
  }
  if (health?.fullScreenIntentAllowed === false) {
    return {
      state: "attention",
      label: "긴급 알림 전체 화면 확인 필요",
      detail: "마지막 보고에서 잠금화면 전체 표시가 꺼져 있어 긴급 알림이 heads-up 팝업으로만 표시돼요.",
    };
  }
  if (health?.remoteListenChannelEnabled === false) {
    return {
      state: "attention",
      label: "주변 소리 요청 알림 확인 필요",
      detail: "마지막 보고에서 아이 기기의 주변 소리 요청 알림 채널이 꺼져 있어요.",
    };
  }
  if (health?.postNotif === false) {
    return {
      state: "attention",
      label: "알림 확인 필요",
      detail: "마지막 보고에서 아이 기기의 알림 권한 또는 필수 채널이 꺼져 있어요.",
    };
  }
  if (!isRecentDeviceReport(health, now)) {
    return {
      state: "unknown",
      label: "알림 상태 확인 대기",
      detail: health
        ? "아이 기기 상태가 오래돼 현재 알림 표시 가능 여부를 확인할 수 없어요. 새로고침해 주세요."
        : "아이 기기에서 새 상태를 받으면 알림 권한과 필수 채널을 확인할 수 있어요.",
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
        label: "일정 알림 설정 확인 실패",
        detail: "아이 일정 알림 설정을 불러오지 못했어요. 네트워크 연결 후 다시 확인해 주세요.",
      };
    }
    if (options.childScheduleEnabled !== true) {
      return {
        state: "unknown",
        label: "일정 알림 설정 확인 중",
        detail: "기기 알림 표시는 켜져 있지만 아이 일정 알림 설정을 확인 중이에요.",
      };
    }
    return {
      state: "ready",
      label: "알림 표시 설정 정상",
      detail: "최근 보고 기준으로 알림 권한·필수 채널·잠금화면 전체 표시·요청 채널과 일정 알림 설정이 켜져 있어요.",
    };
  }
  return {
    state: "unknown",
    label: "알림 상태 확인 대기",
    detail: "아이 기기의 알림 권한과 필수 채널 전체 상태를 아직 확인하지 못했어요.",
  };
}

/** 아이 기기의 위치 권한·백그라운드 제한·서비스·네트워크를 정직하게 요약한다. */
export function deviceLocationHealthView(
  health: DeviceLocationHealthInput | null | undefined,
  now: Date = new Date(),
): DeviceNotificationHealthView {
  const backgroundLocationGranted = typeof health?.backgroundLocationGranted === "boolean"
    ? health.backgroundLocationGranted
    : health?.locationOk;

  if (backgroundLocationGranted === false) {
    return {
      state: "attention",
      label: "위치 권한 확인 필요",
      detail: "마지막 보고에서 아이 기기의 항상 허용 위치 권한이 꺼져 있어요.",
    };
  }
  if (health?.backgroundRestricted === true) {
    return {
      state: "attention",
      label: "백그라운드 제한 확인 필요",
      detail: "마지막 보고에서 아이 기기의 백그라운드 사용이 제한되어 있어요.",
    };
  }
  if (health?.locationServiceRunning === false) {
    return {
      state: "attention",
      label: "위치 전송 확인 필요",
      detail: "마지막 보고에서 혜니캘린더 위치 서비스가 멈춰 있어요.",
    };
  }
  if (health?.networkConnected === false) {
    return {
      state: "attention",
      label: "기기 오프라인",
      detail: "마지막 보고에서 아이 기기가 오프라인이라 위치를 전송할 수 없었어요.",
    };
  }
  if (!isRecentDeviceReport(health, now)) {
    return {
      state: "unknown",
      label: "위치 상태 확인 대기",
      detail: health
        ? "아이 기기 상태가 오래돼 현재 위치 전송 가능 여부를 확인할 수 없어요. 새로고침해 주세요."
        : "아이 기기에서 새 상태를 받으면 위치 권한과 전송 서비스를 확인할 수 있어요.",
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
      label: "위치 전송 설정 정상",
      detail: "최근 보고 기준으로 항상 허용 위치 권한과 전송 서비스가 켜져 있어요.",
    };
  }
  return {
    state: "unknown",
    label: "위치 상태 확인 대기",
    detail: "아이 기기의 위치 권한과 전송 서비스 전체 상태를 아직 확인하지 못했어요.",
  };
}
