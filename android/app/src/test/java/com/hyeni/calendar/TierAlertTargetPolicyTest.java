package com.hyeni.calendar;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class TierAlertTargetPolicyTest {
    @Test
    public void registeredPlaceMasterSwitchRequiresOneExactBooleanTrueRow() throws Exception {
        JSONArray enabled = new JSONArray().put(new JSONObject()
            .put("registered_place_alerts_enabled", true));
        JSONArray disabled = new JSONArray().put(new JSONObject()
            .put("registered_place_alerts_enabled", false));
        JSONArray stringTrue = new JSONArray().put(new JSONObject()
            .put("registered_place_alerts_enabled", "true"));
        JSONArray missing = new JSONArray().put(new JSONObject());
        JSONArray duplicated = new JSONArray()
            .put(new JSONObject().put("registered_place_alerts_enabled", true))
            .put(new JSONObject().put("registered_place_alerts_enabled", true));

        assertTrue(TierAlertTargetPolicy.isServerRegisteredPlaceAlertsEnabled(enabled));
        assertFalse(TierAlertTargetPolicy.isServerRegisteredPlaceAlertsEnabled(disabled));
        assertFalse(TierAlertTargetPolicy.isServerRegisteredPlaceAlertsEnabled(stringTrue));
        assertFalse(TierAlertTargetPolicy.isServerRegisteredPlaceAlertsEnabled(missing));
        assertFalse(TierAlertTargetPolicy.isServerRegisteredPlaceAlertsEnabled(duplicated));
        assertFalse(TierAlertTargetPolicy.isServerRegisteredPlaceAlertsEnabled(new JSONArray()));
        assertFalse(TierAlertTargetPolicy.isServerRegisteredPlaceAlertsEnabled(null));
    }

    @Test
    public void acceptsOnlyConsistentServerTarget() throws Exception {
        JSONObject target = new JSONObject()
            .put("tier_alert_active", true)
            .put("tier_alert_inactive_reason", JSONObject.NULL);

        assertTrue(TierAlertTargetPolicy.isServerAlertTarget(target));
    }

    @Test
    public void rejectsPremiumRequiredAndMissingOrInconsistentState() throws Exception {
        JSONObject premiumRequired = new JSONObject()
            .put("tier_alert_active", false)
            .put("tier_alert_inactive_reason", "premium_required");
        JSONObject missing = new JSONObject();
        JSONObject inconsistent = new JSONObject()
            .put("tier_alert_active", true)
            .put("tier_alert_inactive_reason", "premium_required");

        assertFalse(TierAlertTargetPolicy.isServerAlertTarget(premiumRequired));
        assertFalse(TierAlertTargetPolicy.isServerAlertTarget(missing));
        assertFalse(TierAlertTargetPolicy.isServerAlertTarget(inconsistent));
        assertFalse(TierAlertTargetPolicy.isServerAlertTarget(null));
    }

    @Test
    public void premiumAcademyGateRequiresConsistentCanonicalEntitlement() throws Exception {
        JSONObject premium = new JSONObject().put("effective", new JSONObject()
            .put("tier", "premium")
            .put("is_premium", true));
        JSONObject free = new JSONObject().put("effective", new JSONObject()
            .put("tier", "free")
            .put("is_premium", false));
        JSONObject inconsistent = new JSONObject().put("effective", new JSONObject()
            .put("tier", "free")
            .put("is_premium", true));

        assertTrue(TierAlertTargetPolicy.isServerPremiumEntitlement(premium));
        assertFalse(TierAlertTargetPolicy.isServerPremiumEntitlement(free));
        assertFalse(TierAlertTargetPolicy.isServerPremiumEntitlement(inconsistent));
        assertFalse(TierAlertTargetPolicy.isServerPremiumEntitlement(new JSONObject()));
        assertFalse(TierAlertTargetPolicy.isServerPremiumEntitlement(null));
    }
}
