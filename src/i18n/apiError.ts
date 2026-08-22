import type { IntlShape } from "react-intl";
import type { MessageId } from "./generated/messageIds";
import { isApiError } from "../lib/api/errors.ts";
import { isBillingError } from "../lib/native/billingError.ts";

export type ApiErrorTone = "formal" | "child";

const CODE_MESSAGES: Readonly<Record<string, Readonly<Record<ApiErrorTone, MessageId>>>> = {
  invalid_credentials: {
    formal: "core.error.api.invalidCredentials.formal",
    child: "core.error.api.invalidCredentials.child",
  },
  invalid_login_credentials: {
    formal: "core.error.api.invalidCredentials.formal",
    child: "core.error.api.invalidCredentials.child",
  },
  active_device_session_exists: {
    formal: "core.error.api.activeDeviceSession.formal",
    child: "core.error.api.activeDeviceSession.child",
  },
  device_identity_required: {
    formal: "core.error.api.deviceIdentityRequired.formal",
    child: "core.error.api.deviceIdentityRequired.child",
  },
  invalid_pair_code: {
    formal: "core.error.api.invalidPairCode.formal",
    child: "core.error.api.invalidPairCode.child",
  },
  pair_code_expired: {
    formal: "core.error.api.expiredPairCode.formal",
    child: "core.error.api.expiredPairCode.child",
  },
  parent_cannot_join_as_child: {
    formal: "core.error.api.parentRoleMismatch.formal",
    child: "core.error.api.parentRoleMismatch.formal",
  },
  role_cannot_join_as_parent: {
    formal: "core.error.api.parentRoleRequired.formal",
    child: "core.error.api.parentRoleRequired.formal",
  },
  role_cannot_join_as_child: {
    formal: "core.error.api.childRoleRequired.formal",
    child: "core.error.api.childRoleRequired.formal",
  },
  coparent_slot_occupied: {
    formal: "core.error.api.coparentSlotOccupied.formal",
    child: "core.error.api.coparentSlotOccupied.formal",
  },
  pairing_confirmation_failed: {
    formal: "core.error.api.pairingConfirmationFailed.formal",
    child: "core.error.api.pairingConfirmationFailed.formal",
  },
  invalid_phone: {
    formal: "core.error.api.invalidPhone.formal",
    child: "core.error.api.invalidPhone.child",
  },
  invalid_login_id: {
    formal: "core.error.api.invalidLoginId.formal",
    child: "core.error.api.invalidLoginId.child",
  },
  login_id_taken: {
    formal: "core.error.api.loginIdTaken.formal",
    child: "core.error.api.loginIdTaken.child",
  },
  phone_exists: {
    formal: "core.error.api.phoneExists.formal",
    child: "core.error.api.phoneExists.child",
  },
  otp_expired: {
    formal: "core.error.api.otpExpired.formal",
    child: "core.error.api.otpExpired.child",
  },
  otp_mismatch: {
    formal: "core.error.api.otpMismatch.formal",
    child: "core.error.api.otpMismatch.child",
  },
  invalid_token_format: {
    formal: "core.error.api.otpMismatch.formal",
    child: "core.error.api.otpMismatch.child",
  },
  otp_not_found: {
    formal: "core.error.api.otpExpired.formal",
    child: "core.error.api.otpExpired.child",
  },
  rate_limited: {
    formal: "core.error.api.rateLimited.formal",
    child: "core.error.api.rateLimited.child",
  },
  too_many_requests: {
    formal: "core.error.api.rateLimited.formal",
    child: "core.error.api.rateLimited.child",
  },
  too_many_attempts: {
    formal: "core.error.api.rateLimited.formal",
    child: "core.error.api.rateLimited.child",
  },
  sms_not_configured: {
    formal: "core.error.api.smsUnavailable.formal",
    child: "core.error.api.smsUnavailable.child",
  },
  sms_provider_failed: {
    formal: "core.error.api.smsUnavailable.formal",
    child: "core.error.api.smsUnavailable.child",
  },
  oauth_not_configured: {
    formal: "core.error.api.oauthUnavailable.formal",
    child: "core.error.api.oauthUnavailable.child",
  },
  naver_not_configured: {
    formal: "core.error.api.oauthUnavailable.formal",
    child: "core.error.api.oauthUnavailable.child",
  },
  unsupported_provider: {
    formal: "core.error.api.oauthUnavailable.formal",
    child: "core.error.api.oauthUnavailable.child",
  },
  oauth_client_update_required: {
    formal: "core.error.api.oauthRetry.formal",
    child: "core.error.api.oauthRetry.child",
  },
  invalid_oauth_client: {
    formal: "core.error.api.oauthRetry.formal",
    child: "core.error.api.oauthRetry.child",
  },
  invalid_oauth_transaction: {
    formal: "core.error.api.oauthRetry.formal",
    child: "core.error.api.oauthRetry.child",
  },
  oauth_start_invalid: {
    formal: "core.error.api.oauthRetry.formal",
    child: "core.error.api.oauthRetry.child",
  },
  oauth_storage_unavailable: {
    formal: "core.error.api.oauthRetry.formal",
    child: "core.error.api.oauthRetry.child",
  },
  oauth_response_invalid: {
    formal: "core.error.api.oauthRetry.formal",
    child: "core.error.api.oauthRetry.child",
  },
  token_exchange_failed: {
    formal: "core.error.api.oauthRetry.formal",
    child: "core.error.api.oauthRetry.child",
  },
  token_exchange_rejected: {
    formal: "core.error.api.oauthRetry.formal",
    child: "core.error.api.oauthRetry.child",
  },
  profile_fetch_failed: {
    formal: "core.error.api.oauthRetry.formal",
    child: "core.error.api.oauthRetry.child",
  },
  profile_invalid: {
    formal: "core.error.api.oauthRetry.formal",
    child: "core.error.api.oauthRetry.child",
  },
  signup_failed: {
    formal: "core.error.api.signupRetry.formal",
    child: "core.error.api.signupRetry.child",
  },
  signup_response_invalid: {
    formal: "core.error.api.signupRetry.formal",
    child: "core.error.api.signupRetry.child",
  },
  signup_created_login_required: {
    formal: "core.error.api.signupRetry.formal",
    child: "core.error.api.signupRetry.child",
  },
  current_password_required: {
    formal: "core.error.api.currentPasswordRequired.formal",
    child: "core.error.api.currentPasswordRequired.formal",
  },
  weak_password: {
    formal: "core.error.api.weakPassword.formal",
    child: "core.error.api.weakPassword.formal",
  },
  same_password: {
    formal: "core.error.api.samePassword.formal",
    child: "core.error.api.samePassword.formal",
  },
  password_account_required: {
    formal: "core.error.api.passwordAccountRequired.formal",
    child: "core.error.api.passwordAccountRequired.formal",
  },
  current_password_mismatch: {
    formal: "core.error.api.currentPasswordMismatch.formal",
    child: "core.error.api.currentPasswordMismatch.formal",
  },
};

const BILLING_MESSAGES: Readonly<Record<string, Readonly<Record<ApiErrorTone, MessageId>>>> = {
  purchase_canceled: {
    formal: "core.error.billing.canceled.formal",
    child: "core.error.billing.canceled.child",
  },
  purchase_pending: {
    formal: "core.error.billing.pending.formal",
    child: "core.error.billing.pending.child",
  },
  product_unavailable: {
    formal: "core.error.billing.productUnavailable.formal",
    child: "core.error.billing.productUnavailable.child",
  },
  billing_unavailable: {
    formal: "core.error.billing.unavailable.formal",
    child: "core.error.billing.unavailable.child",
  },
};

function genericMessageId(error: unknown, tone: ApiErrorTone): MessageId {
  if (error instanceof TypeError) return `core.error.api.network.${tone}` as MessageId;
  if (!isApiError(error)) return `core.error.api.unknown.${tone}` as MessageId;
  if (error.status >= 500) return `core.error.api.server.${tone}` as MessageId;
  if (error.status >= 400) return `core.error.api.client.${tone}` as MessageId;
  return `core.error.api.unknown.${tone}` as MessageId;
}

/** 자유 오류 원문을 사용하지 않고 allowlist code 또는 역할별 공용 문구만 반환한다. */
export function localizeApiError(error: unknown, intl: IntlShape, tone: ApiErrorTone): string {
  const billingMapped = isBillingError(error) ? BILLING_MESSAGES[error.code]?.[tone] : undefined;
  if (billingMapped) return intl.formatMessage({ id: billingMapped });
  const mapped = isApiError(error) && error.code ? CODE_MESSAGES[error.code]?.[tone] : undefined;
  return intl.formatMessage({ id: mapped ?? genericMessageId(error, tone) });
}
