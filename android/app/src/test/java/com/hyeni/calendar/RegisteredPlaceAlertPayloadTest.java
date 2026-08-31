package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

import java.lang.reflect.Method;

import org.json.JSONObject;
import org.junit.Test;

public class RegisteredPlaceAlertPayloadTest {
    @Test
    public void payloadCarriesTheGeofenceEpisodeTimestamp() throws Exception {
        final Class<?> payloadClass;
        try {
            payloadClass = Class.forName("com.hyeni.calendar.RegisteredPlaceAlertPayload");
        } catch (ClassNotFoundException error) {
            fail("등록장소 알림 payload builder가 필요합니다");
            return;
        }
        Method build = payloadClass.getDeclaredMethod(
            "build",
            String.class,
            String.class,
            String.class,
            String.class,
            String.class,
            String.class,
            long.class,
            String.class,
            String.class
        );
        build.setAccessible(true);

        JSONObject payload = (JSONObject) build.invoke(
            null,
            "family-1",
            "place_arrived",
            "학교 도착",
            "민서가 학교에 도착했어요.",
            "episode-1",
            "child-1",
            1_788_133_145_000L,
            null,
            "saved_place:school"
        );

        assertEquals("2026-08-30T23:39:05.000Z", payload.getString("occurred_at"));
        assertEquals("place_arrived", payload.getString("alert_type"));
        assertEquals("saved_place:school", payload.getString("place_key"));
    }
}
