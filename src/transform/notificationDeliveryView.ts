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

function permissionLabel(permission: WebPushState["permission"]): string {
  if (permission === "granted") return "허용됨";
  if (permission === "denied") return "차단됨";
  if (permission === "default") return "허용 전";
  return "확인 불가";
}

/** 브라우저 권한만으로 성공을 단정하지 않고 서버 설정·실제 PushSubscription까지 함께 판정한다. */
export function webPushDeliveryView(state: WebPushState | null): WebPushDeliveryView {
  if (!state) {
    return {
      reason: "checking",
      ready: false,
      canSubscribe: false,
      canRegisterAccount: false,
      canUnsubscribe: false,
      title: "웹 알림 상태 확인 중",
      detail: "서버 설정과 이 브라우저의 구독 상태를 확인하고 있어요.",
      configuredLabel: "확인 중",
      permissionLabel: "확인 중",
      subscriptionLabel: "확인 중",
      accountRegistrationLabel: "확인 중",
    };
  }

  const labels = {
    configuredLabel: state.configured ? "설정됨" : "설정 필요",
    permissionLabel: permissionLabel(state.permission),
    subscriptionLabel: state.subscribed ? "구독됨" : "구독 안 됨",
    accountRegistrationLabel: state.accountRegistered === true
      ? "현재 계정 등록됨"
      : state.accountRegistered === false
        ? "현재 계정 등록 안 됨"
        : "확인 실패",
  };
  if (!state.supported) {
    return {
      reason: "unsupported",
      ready: false,
      canSubscribe: false,
      canRegisterAccount: false,
      canUnsubscribe: false,
      title: "웹 푸시를 사용할 수 없어요",
      detail: "이 브라우저 또는 현재 설치 상태는 웹 푸시를 지원하지 않아요.",
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
      title: "웹 푸시 서버 상태를 확인하지 못했어요",
      detail: "서버 상태 확인에 실패했지만 남아 있는 이 기기 구독은 끌 수 있어요.",
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
      title: "웹 푸시 서버 설정이 필요해요",
      detail: "VAPID 설정이 완료되지 않아 이 기기를 알림 수신 기기로 등록할 수 없어요.",
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
      detail: "주소창의 사이트 설정에서 알림을 허용한 뒤 상태를 다시 확인해 주세요.",
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
      title: "현재 계정 알림 등록이 필요해요",
      detail: "브라우저 구독은 남아 있지만 현재 계정의 알림 수신 기기로 등록되지 않았어요.",
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
      title: "현재 계정 웹 알림 준비 완료",
      detail: "브라우저 권한·구독·현재 계정 등록과 알림 연결 정보가 모두 확인됐어요.",
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
      title: "현재 계정 알림 연결을 확인하지 못했어요",
      detail: "구독은 남아 있지만 현재 계정 등록 또는 알림 연결 정보 확인이 필요해요.",
      ...labels,
    };
  }
  return {
    reason: "not_subscribed",
    ready: false,
    canSubscribe: true,
    canRegisterAccount: true,
    canUnsubscribe: false,
    title: "웹 알림 구독이 필요해요",
    detail:
      state.permission === "granted"
        ? "브라우저 권한은 허용됐지만 이 계정의 알림 수신 기기로 아직 등록되지 않았어요."
        : "버튼을 누르면 브라우저 권한을 요청하고 이 계정의 알림 수신 기기로 등록해요.",
    ...labels,
  };
}
