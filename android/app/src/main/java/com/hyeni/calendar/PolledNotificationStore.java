package com.hyeni.calendar;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.Nullable;

/**
 * Cross-channel dedup for schedule / alert notifications (DB-H3).
 *
 * A cron schedule notification reaches a device twice — once via FCM
 * (MyFirebaseMessagingService) and once via the LocationService pending-
 * notification poll. Both channels carry the same stableId (pushId). Whichever
 * channel displays it first records an ack here; the other channel checks this
 * store and skips, so the user sees the notification exactly once.
 *
 * The prefs file name and window MUST stay in sync with
 * LocationService.POLLED_DEDUPE_PREFS / POLLED_DEDUPE_WINDOW_MS — the poll path
 * reads the same SharedPreferences file via isLocallyAckedPolledNotification().
 */
final class PolledNotificationStore {

    private static final String PREFS_NAME = "hyeni_polled_notification_ack";
    private static final long WINDOW_MS = 12 * 60 * 60 * 1000L;

    private PolledNotificationStore() {}

    static boolean isAcked(Context context, @Nullable String stableId) {
        if (context == null || isBlank(stableId)) return false;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        long seenAt = prefs.getLong(stableId, 0L);
        return seenAt > 0L && (System.currentTimeMillis() - seenAt) < WINDOW_MS;
    }

    static void markAck(Context context, @Nullable String stableId) {
        if (context == null || isBlank(stableId)) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putLong(stableId, System.currentTimeMillis()).apply();
    }

    private static boolean isBlank(@Nullable String value) {
        return value == null || value.trim().isEmpty();
    }
}
