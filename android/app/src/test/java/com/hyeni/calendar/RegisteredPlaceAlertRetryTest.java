package com.hyeni.calendar;

import static org.junit.Assert.*;
import org.junit.Test;
import org.json.JSONObject;

public class RegisteredPlaceAlertRetryTest {
    private RegisteredPlaceAlertRetry original() throws Exception {
        long episodeMs = 1_788_133_145_000L;
        JSONObject payload = RegisteredPlaceAlertPayload.build("family", "place_left", "집 출발",
            "아이가 집에서 출발했어요.", "first-event", "child", episodeMs, null, "saved_place:home");
        return new RegisteredPlaceAlertRetry(payload,
            new GeofenceStateMachine.GeofenceState("out", null, null, episodeMs),
            "session", "", "", episodeMs + 1_000L);
    }

    @Test public void retryAfterNetworkFailureAndRestartKeepsOriginalEpisodeAndState() throws Exception {
        RegisteredPlaceAlertRetry first = original();
        String persistedBeforeHttp = first.serialize();
        // HTTP 예외 뒤 프로세스가 재시작하고 더 늦은 위치가 와도 최초 사건을 복원한다.
        RegisteredPlaceAlertRetry retry = RegisteredPlaceAlertRetry.deserialize(persistedBeforeHttp);
        assertTrue(retry.matchesScope("family", "child", "session", first.queuedAtMs + 5 * 60_000L));
        assertEquals("first-event", retry.payload.getString("event_id"));
        assertEquals("2026-08-30T23:39:05.000Z", retry.payload.getString("occurred_at"));
        assertEquals(first.nextState.lastDepartedAtMs, retry.nextState.lastDepartedAtMs);
        assertEquals("out", retry.nextState.phase);
        assertEquals(first.payload.toString(), retry.payload.toString());
    }

    @Test public void retryCannotCrossFamilyChildOrLoginSession() throws Exception {
        RegisteredPlaceAlertRetry retry = original();
        long now = retry.queuedAtMs + 1_000L;
        assertFalse(retry.matchesScope("another", "child", "session", now));
        assertFalse(retry.matchesScope("family", "sibling", "session", now));
        assertFalse(retry.matchesScope("family", "child", "new-session", now));
        assertFalse(retry.matchesScope("family", "child", "session", now + RegisteredPlaceAlertRetry.MAX_AGE_MS));
    }
}
