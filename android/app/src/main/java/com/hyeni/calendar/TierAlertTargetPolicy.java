package com.hyeni.calendar;

import org.json.JSONArray;
import org.json.JSONObject;

/** 서버가 확정한 티어 알림 대상 필드가 완전히 일치할 때만 네이티브 평가를 허용한다. */
final class TierAlertTargetPolicy {
    private TierAlertTargetPolicy() {}

    /** 가족 master switch는 서버가 정확히 한 행의 Boolean true를 반환한 경우에만 연다. */
    static boolean isServerRegisteredPlaceAlertsEnabled(JSONArray rows) {
        if (rows == null || rows.length() != 1) return false;
        JSONObject row = rows.optJSONObject(0);
        if (row == null || !row.has("registered_place_alerts_enabled")) return false;
        Object enabled = row.opt("registered_place_alerts_enabled");
        return enabled instanceof Boolean && ((Boolean) enabled);
    }

    static boolean isServerAlertTarget(JSONObject row) {
        if (row == null || !row.has("tier_alert_active")) return false;
        Object active = row.opt("tier_alert_active");
        if (!(active instanceof Boolean) || !((Boolean) active)) return false;
        return row.has("tier_alert_inactive_reason")
            && row.isNull("tier_alert_inactive_reason");
    }

    /** Premium 전용 네이티브 경로는 서버 정본 필드가 서로 일치할 때만 연다. */
    static boolean isServerPremiumEntitlement(JSONObject response) {
        if (response == null) return false;
        JSONObject effective = response.optJSONObject("effective");
        if (effective == null) return false;
        Object premium = effective.opt("is_premium");
        return premium instanceof Boolean
            && ((Boolean) premium)
            && "premium".equals(effective.optString("tier", ""));
    }
}
