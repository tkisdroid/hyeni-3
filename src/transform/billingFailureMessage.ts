import type { IntlShape } from "react-intl";
import { localizeApiError } from "../i18n/apiError.ts";

/** Android native 결제 실패는 두 구매 화면에서 같은 부모 존댓말 계약을 사용한다. */
export function resolveNativeBillingFailureMessage(error: unknown, intl: IntlShape): string {
  return localizeApiError(error, intl, "formal");
}
