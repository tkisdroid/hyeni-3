import type { WebPushState } from "@/lib/webPush";

export type WebPushDeliveryReason =
  | "checking"
  | "ready"
  | "unsupported"
  | "check_failed"
  | "not_configured"
  | "permission_denied"
  | "account_not_registered"
  | "not_subscribed";

export interface WebPushDeliveryView {
  reason: WebPushDeliveryReason;
  ready: boolean;
  canSubscribe: boolean;
  canRegisterAccount: boolean;
  canUnsubscribe: boolean;
  title: string;
  detail: string;
  configuredLabel: string;
  permissionLabel: string;
  subscriptionLabel: string;
  accountRegistrationLabel: string;
}

export interface WebPushDeliveryEnvironment {
  iosHomeScreenInstallRequired?: boolean;
}

function permissionLabel(permission: WebPushState["permission"]): string {
  if (permission === "granted") return "허용됨";
  if (permission === "denied") return "차단됨";
  if (permission === "default") return "허용 전";
  return "확인 불가";
}

/** 브라우저 권한만으로 성공을 단정하지 않고 서버 설정·실제 PushSubscription까지 함께 판정한다. */
export function webPushDeliveryView(
  state: WebPushState | null,
  environment: WebPushDeliveryEnvironment = {},
): WebPushDeliveryView {
  if (!state) {
    return {
      reason: "checking",
      ready: false,
      canSubscribe: false,
      canRegisterAccount: false,
      canUnsubscribe: false,
      title: "알림 확인 중",
      detail: "웹 알림 연결을 확인하고 있어요.",
      configuredLabel: "확인 중",
      permissionLabel: "확인 중",
      subscriptionLabel: "확인 중",
      accountRegistrationLabel: "확인 중",
    };
  }

  if (environment.iosHomeScreenInstallRequired) {
    return {
      reason: "unsupported",
      ready: false,
      canSubscribe: false,
      canRegisterAccount: false,
      canUnsubscribe: false,
      title: "iPhone 홈 화면 앱에서 알림을 켜 주세요",
      detail: "Safari 공유 버튼에서 ‘홈 화면에 추가’한 뒤 웹 알림을 켜 주세요.",
      configuredLabel: "확인 안 함",
      permissionLabel: "홈 화면 앱 필요",
      subscriptionLabel: "등록 전",
      accountRegistrationLabel: "등록 전",
    };
  }

  const labels = {
    configuredLabel: state.configured ? "설정됨" : "설정 필요",
    permissionLabel: permissionLabel(state.permission),
    subscriptionLabel: state.subscribed ? "켜짐" : "꺼짐",
    accountRegistrationLabel: state.accountRegistered === true
      ? "연결됨"
      : state.accountRegistered === false
        ? "연결 안 됨"
        : "확인 실패",
  };
  if (!state.supported) {
    return {
      reason: "unsupported",
      ready: false,
      canSubscribe: false,
      canRegisterAccount: false,
      canUnsubscribe: false,
      title: "이 브라우저에서는 알림을 못 받아요",
      detail: "지금 브라우저에서는 웹 알림을 쓸 수 없어요.",
      configuredLabel: "확인 안 함",
      permissionLabel: "지원 안 됨",
      subscriptionLabel: "지원 안 됨",
      accountRegistrationLabel: "지원 안 됨",
    };
  }
  if (state.configCheckFailed) {
    return {
      reason: "check_failed",
      ready: false,
      canSubscribe: false,
      canRegisterAccount: false,
      canUnsubscribe: state.subscribed,
      title: "알림 서버를 확인하지 못했어요",
      detail: "서버 확인에 실패했어요. 남은 알림은 끌 수 있어요.",
      ...labels,
    };
  }
  if (!state.configured) {
    return {
      reason: "not_configured",
      ready: false,
      canSubscribe: false,
      canRegisterAccount: false,
      canUnsubscribe: state.subscribed,
      title: "알림 서버가 아직 준비되지 않았어요",
      detail: "서버가 아직이라 이 기기를 연결할 수 없어요.",
      ...labels,
    };
  }
  if (state.permission === "denied") {
    return {
      reason: "permission_denied",
      ready: false,
      canSubscribe: false,
      canRegisterAccount: false,
      canUnsubscribe: state.subscribed,
      title: "브라우저 알림이 차단됐어요",
      detail: "사이트 설정에서 알림을 허용한 뒤 다시 확인해 주세요.",
      ...labels,
    };
  }
  if (state.permission === "granted" && state.subscribed && state.accountRegistered === false) {
    return {
      reason: "account_not_registered",
      ready: false,
      canSubscribe: false,
      canRegisterAccount: true,
      canUnsubscribe: true,
      title: "이 계정에 알림을 연결해 주세요",
      detail: "브라우저 알림은 있지만 이 계정에는 연결되지 않았어요.",
      ...labels,
    };
  }
  if (
    state.permission === "granted"
    && state.subscribed
    && state.accountRegistered === true
    && state.contextSynchronized === true
  ) {
    return {
      reason: "ready",
      ready: true,
      canSubscribe: false,
      canRegisterAccount: true,
      canUnsubscribe: true,
      title: "웹 알림을 받을 수 있어요",
      detail: "권한·연결·계정이 모두 확인됐어요.",
      ...labels,
    };
  }
  if (state.permission === "granted" && state.subscribed) {
    return {
      reason: "check_failed",
      ready: false,
      canSubscribe: false,
      canRegisterAccount: true,
      canUnsubscribe: true,
      title: "알림 연결을 확인하지 못했어요",
      detail: "알림은 있지만 계정 연결을 다시 확인해야 해요.",
      ...labels,
    };
  }
  return {
    reason: "not_subscribed",
    ready: false,
    canSubscribe: true,
    canRegisterAccount: true,
    canUnsubscribe: false,
    title: "웹 알림을 켜 주세요",
    detail:
      state.permission === "granted"
        ? "권한은 허용됐지만 아직 이 계정에 연결되지 않았어요."
        : "버튼을 누르면 권한을 요청하고 이 계정에 연결해요.",
    ...labels,
  };
}
