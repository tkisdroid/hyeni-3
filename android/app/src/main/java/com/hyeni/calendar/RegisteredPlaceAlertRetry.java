package com.hyeni.calendar;

import org.json.JSONObject;

/** 최초 전이의 사건 시각·멱등키·다음 상태를 재시도와 서비스 재시작 동안 보존한다. */
final class RegisteredPlaceAlertRetry {
    static final long MAX_AGE_MS = 6L * 60 * 60_000L;
    final JSONObject payload;
    final GeofenceStateMachine.GeofenceState nextState;
    final String sessionNonce;
    final String occurrenceId;
    final String homePlaceName;
    final long queuedAtMs;

    RegisteredPlaceAlertRetry(JSONObject payload, GeofenceStateMachine.GeofenceState nextState,
            String sessionNonce, String occurrenceId, String homePlaceName, long queuedAtMs) {
        this.payload = payload;
        this.nextState = nextState;
        this.sessionNonce = sessionNonce;
        this.occurrenceId = occurrenceId;
        this.homePlaceName = homePlaceName;
        this.queuedAtMs = queuedAtMs;
    }

    boolean matchesScope(String familyId, String childUserId, String nonce, long nowMs) {
        return familyId != null && !familyId.isEmpty() && childUserId != null && !childUserId.isEmpty()
            && familyId.equals(payload.optString("family_id"))
            && childUserId.equals(payload.optString("child_user_id"))
            && sessionNonce.equals(nonce)
            && nowMs >= queuedAtMs && nowMs - queuedAtMs <= MAX_AGE_MS;
    }

    String serialize() throws Exception {
        return new JSONObject().put("payload", payload).put("next", encodeState(nextState, queuedAtMs))
            .put("session", sessionNonce).put("occurrence", occurrenceId).put("home", homePlaceName)
            .put("queuedAt", queuedAtMs).toString();
    }

    static RegisteredPlaceAlertRetry deserialize(String value) throws Exception {
        JSONObject json = new JSONObject(value);
        JSONObject state = json.getJSONObject("next");
        return new RegisteredPlaceAlertRetry(json.getJSONObject("payload"),
            new GeofenceStateMachine.GeofenceState(state.getString("p"), nullableLong(state, "fi"),
                nullableLong(state, "da"), nullableLong(state, "ld")),
            json.getString("session"), json.optString("occurrence"), json.optString("home"), json.getLong("queuedAt"));
    }

    static JSONObject encodeState(GeofenceStateMachine.GeofenceState state, long updatedAtMs) throws Exception {
        JSONObject json = new JSONObject().put("p", state.phase).put("u", updatedAtMs);
        if (state.firstInsideAtMs != null) json.put("fi", state.firstInsideAtMs.longValue());
        if (state.departureArmedAtMs != null) json.put("da", state.departureArmedAtMs.longValue());
        if (state.lastDepartedAtMs != null) json.put("ld", state.lastDepartedAtMs.longValue());
        return json;
    }

    private static Long nullableLong(JSONObject json, String key) throws Exception {
        return json.has(key) && !json.isNull(key) ? json.getLong(key) : null;
    }
}
