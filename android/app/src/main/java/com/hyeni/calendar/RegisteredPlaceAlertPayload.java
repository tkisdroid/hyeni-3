package com.hyeni.calendar;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

import org.json.JSONObject;

/** 아이 기기가 판정한 등록장소 episode 시각을 서버 알림 계약에 보존한다. */
final class RegisteredPlaceAlertPayload {
    private RegisteredPlaceAlertPayload() {}

    static JSONObject build(
        String familyId,
        String alertType,
        String title,
        String message,
        String eventId,
        String childUserId,
        long occurredAtMs,
        String sourceEventId,
        String placeKey
    ) throws Exception {
        JSONObject body = new JSONObject()
            .put("family_id", familyId)
            .put("alert_type", alertType)
            .put("title", title)
            .put("message", message)
            .put("severity", "info")
            .put("event_id", eventId)
            .put("child_user_id", childUserId)
            .put("occurred_at", isoUtc(occurredAtMs));
        if (sourceEventId != null && !sourceEventId.trim().isEmpty()) {
            body.put("source_event_id", sourceEventId);
        }
        if (placeKey != null && !placeKey.trim().isEmpty()) body.put("place_key", placeKey);
        return body;
    }

    private static String isoUtc(long occurredAtMs) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(occurredAtMs));
    }
}
