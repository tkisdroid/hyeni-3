import { MAX_SUPPLY_ITEMS_PER_KIND } from "./eventSupplies.ts";
import type { IntlShape } from "react-intl";
import { withDefaultIntl } from "../i18n/defaultIntl.ts";

export type PremiumUpsellSource =
  | "second_child"
  | "saved_place"
  | "danger_zone"
  | "location_request"
  | "location_history"
  | "location_live_interval"
  | "remote_ring"
  | "remote_audio"
  | "ai_friend_limit"
  | "ai_schedule_limit"
  | "ai_daily_summary"
  | "weekly_report"
  | "academy_schedule"
  | "first_location"
  | "first_arrival";

export interface PremiumUpsellContent {
  source: PremiumUpsellSource;
  feature: string;
  title: string;
  description: string;
  premiumValue: string;
  usageLabel: string | null;
  ctaLabel: string;
  continueLabel: string;
}

export interface PremiumUpsellUsage {
  used: number;
  limit: number;
}

const FEATURE_BY_SOURCE: Record<PremiumUpsellSource, string> = {
  second_child: "multi_child", saved_place: "saved_places", danger_zone: "multi_geofence",
  location_request: "realtime_location", location_history: "extended_history",
  location_live_interval: "realtime_location", remote_ring: "remote_ring_quota",
  remote_audio: "remote_audio", ai_friend_limit: "ai_friend_daily_limit",
  ai_schedule_limit: "ai_schedule_daily_limit", ai_daily_summary: "ai_analysis",
  weekly_report: "weekly_report", academy_schedule: "academy_schedule",
  first_location: "first_location_value", first_arrival: "first_arrival_value",
};

const SOURCES_WITH_USAGE = new Set<PremiumUpsellSource>([
  "second_child", "saved_place", "danger_zone", "location_request", "remote_ring",
  "ai_friend_limit", "ai_schedule_limit",
]);

export function resolvePremiumUpsell(
  source: PremiumUpsellSource,
  usage?: PremiumUpsellUsage,
  providedIntl?: IntlShape,
): PremiumUpsellContent {
  const intl = withDefaultIntl(providedIntl);
  const savedPlaceUsage = source === "saved_place"
    && usage && Number.isInteger(usage.used) && usage.used >= 0
    && Number.isInteger(usage.limit) && usage.limit > 0 ? usage : null;
  const values = source === "academy_schedule" ? { limit: MAX_SUPPLY_ITEMS_PER_KIND } : undefined;
  return {
    source,
    feature: FEATURE_BY_SOURCE[source],
    title: savedPlaceUsage
      ? intl.formatMessage({ id: "parent.upsell.saved_place.dynamicTitle" }, { used: savedPlaceUsage.used, limit: savedPlaceUsage.limit })
      : intl.formatMessage({ id: `parent.upsell.${source}.title` }),
    description: savedPlaceUsage
      ? intl.formatMessage({ id: "parent.upsell.saved_place.dynamicDescription" }, { used: savedPlaceUsage.used, limit: savedPlaceUsage.limit })
      : intl.formatMessage({ id: `parent.upsell.${source}.description` }, values),
    premiumValue: intl.formatMessage({ id: `parent.upsell.${source}.premiumValue` }),
    usageLabel: savedPlaceUsage
      ? intl.formatMessage({ id: "parent.upsell.dynamicUsage" }, { used: savedPlaceUsage.used, limit: savedPlaceUsage.limit })
      : SOURCES_WITH_USAGE.has(source)
        ? intl.formatMessage({ id: `parent.upsell.${source}.usageLabel` })
        : null,
    ctaLabel: intl.formatMessage({ id: `parent.upsell.${source}.ctaLabel` }),
    continueLabel: intl.formatMessage({ id: "parent.upsell.continue" }),
  };
}
