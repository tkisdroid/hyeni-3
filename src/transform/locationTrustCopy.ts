import { formatFreshness } from "./locationView.ts";
import type { LocationMode } from "./tierPolicy";
import type { SupportedLocale } from "../i18n/locale.ts";
import type { IntlShape } from "react-intl";
import { withDefaultIntl } from "../i18n/defaultIntl.ts";

export interface LocationTrustCopy {
  badge: string;
  detail: string;
}

export type LocationTrustLoadState = "ready" | "loading" | "error";

/** 위치 티어와 GPS fix 신선도를 함께 반영해 실시간·최근·과거 위치를 구분한다. */
export function resolveLocationTrustCopy(input: {
  mode: LocationMode;
  modeKnown: boolean;
  updatedAt: string | null | undefined;
  loadState?: LocationTrustLoadState;
  now?: Date;
  locale: SupportedLocale;
  intl?: IntlShape;
}): LocationTrustCopy {
  const intl = withDefaultIntl(input.intl);
  // 무료 잠금은 좌표 캐시·조회 상태보다 먼저 적용한다. 이전 프리미엄 좌표가
  // 캐시에 남아도 잠금 사용자의 현재 위치처럼 노출하지 않는다.
  if (input.modeKnown && input.mode === "locked") {
    return { badge: intl.formatMessage({ id: "parent.locationTrust.restricted" }), detail: intl.formatMessage({ id: "parent.locationTrust.hidden" }) };
  }

  if (!input.modeKnown) {
    if (input.loadState === "error") {
      return {
        badge: intl.formatMessage({ id: "parent.locationTrust.scopeFailed" }),
        detail: intl.formatMessage({ id: "parent.locationTrust.refresh" }),
      };
    }
    if (!input.updatedAt) {
      return { badge: intl.formatMessage({ id: "parent.locationTrust.scopeLoading" }), detail: intl.formatMessage({ id: "parent.locationTrust.subscriptionLoading" }) };
    }
    const fresh = formatFreshness(input.updatedAt, input.now ?? new Date(), input.locale, intl);
    return { badge: intl.formatMessage({ id: "parent.locationTrust.lastLocation" }), detail: intl.formatMessage({ id: "parent.locationTrust.updated" }, { freshness: fresh.label }) };
  }

  if (!input.updatedAt) {
    if (input.loadState === "loading") {
      return { badge: intl.formatMessage({ id: "parent.locationTrust.loading" }), detail: intl.formatMessage({ id: "parent.locationTrust.loadingDetail" }) };
    }
    if (input.loadState === "error") {
      return { badge: intl.formatMessage({ id: "parent.locationTrust.failed" }), detail: intl.formatMessage({ id: "parent.locationTrust.failedDetail" }) };
    }
    return { badge: intl.formatMessage({ id: "parent.locationTrust.waiting" }), detail: intl.formatMessage({ id: "parent.locationTrust.waitingDetail" }) };
  }

  const fresh = formatFreshness(input.updatedAt, input.now ?? new Date(), input.locale, intl);
  if (input.mode === "standard") {
    return {
      badge: intl.formatMessage({ id: "parent.locationTrust.recent" }),
      detail: input.loadState === "error"
        ? intl.formatMessage({ id: "parent.locationTrust.standardFailed" }, { freshness: fresh.label })
        : intl.formatMessage({ id: "parent.locationTrust.standard" }, { freshness: fresh.label }),
    };
  }
  if (input.loadState === "error") {
    return { badge: intl.formatMessage({ id: "parent.locationTrust.lastLocation" }), detail: intl.formatMessage({ id: "parent.locationTrust.latestFailed" }, { freshness: fresh.label }) };
  }
  if (fresh.status === "live") {
    return { badge: intl.formatMessage({ id: "parent.locationTrust.current" }), detail: intl.formatMessage({ id: "parent.locationTrust.justUpdated" }) };
  }
  return { badge: intl.formatMessage({ id: "parent.locationTrust.lastLocation" }), detail: intl.formatMessage({ id: "parent.locationTrust.updated" }, { freshness: fresh.label }) };
}
