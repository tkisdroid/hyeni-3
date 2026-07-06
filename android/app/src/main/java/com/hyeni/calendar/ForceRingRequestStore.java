package com.hyeni.calendar;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.Nullable;

import java.util.concurrent.TimeUnit;

final class ForceRingRequestStore {

    private static final String PREFS_NAME = "hyeni_force_ring_requests";
    // NTV-H7: only long enough to swallow an FCM redelivery of the *same*
    // push. A deliberate re-ring (after a stop, or a fresh trigger) must not
    // be suppressed — the old 5-minute window blocked legitimate re-rings.
    private static final long RECENT_WINDOW_MS = TimeUnit.SECONDS.toMillis(20);
    private static final long STOPPED_WINDOW_MS = TimeUnit.MINUTES.toMillis(10);

    private ForceRingRequestStore() {}

    static void markLauncherShown(Context context, @Nullable String eventId) {
        if (context == null || isBlank(eventId)) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putLong(keyFor(eventId), System.currentTimeMillis()).apply();
    }

    static boolean wasLauncherRecentlyShown(Context context, @Nullable String eventId) {
        if (context == null || isBlank(eventId)) return false;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        long shownAt = prefs.getLong(keyFor(eventId), 0L);
        if (shownAt <= 0L) return false;
        long ageMs = System.currentTimeMillis() - shownAt;
        return ageMs >= 0L && ageMs <= RECENT_WINDOW_MS;
    }

    // NTV-H7: clear the dedup marker so a force_ring re-triggered after a stop
    // is delivered immediately instead of being swallowed by the recency
    // window. Called from the force_ring_stop FCM handler.
    static void clearLauncherShown(Context context, @Nullable String eventId) {
        if (context == null || isBlank(eventId)) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().remove(keyFor(eventId)).apply();
    }

    static void markStopped(Context context, @Nullable String eventId) {
        if (context == null || isBlank(eventId)) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putLong(stoppedKeyFor(eventId), System.currentTimeMillis()).apply();
    }

    static boolean wasStoppedRecently(Context context, @Nullable String eventId) {
        if (context == null || isBlank(eventId)) return false;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        long stoppedAt = prefs.getLong(stoppedKeyFor(eventId), 0L);
        if (stoppedAt <= 0L) return false;
        long ageMs = System.currentTimeMillis() - stoppedAt;
        return ageMs >= 0L && ageMs <= STOPPED_WINDOW_MS;
    }

    static void clearStopped(Context context, @Nullable String eventId) {
        if (context == null || isBlank(eventId)) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().remove(stoppedKeyFor(eventId)).apply();
    }

    private static String keyFor(String eventId) {
        return "force_ring_launcher_" + eventId;
    }

    private static String stoppedKeyFor(String eventId) {
        return "force_ring_stopped_" + eventId;
    }

    private static boolean isBlank(@Nullable String value) {
        return value == null || value.trim().isEmpty();
    }
}
