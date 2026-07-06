package com.hyeni.calendar;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.Nullable;

import java.util.concurrent.TimeUnit;

final class RemoteListenRequestStore {

    private static final String PREFS_NAME = "hyeni_remote_listen_requests";
    private static final long RECENT_WINDOW_MS = TimeUnit.MINUTES.toMillis(5);

    private RemoteListenRequestStore() {}

    static void markLauncherShown(Context context, @Nullable String requestId) {
        if (context == null || isBlank(requestId)) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putLong(keyFor(requestId), System.currentTimeMillis()).apply();
    }

    static boolean wasLauncherRecentlyShown(Context context, @Nullable String requestId) {
        if (context == null || isBlank(requestId)) return false;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        long shownAt = prefs.getLong(keyFor(requestId), 0L);
        if (shownAt <= 0L) return false;
        long ageMs = System.currentTimeMillis() - shownAt;
        return ageMs >= 0L && ageMs <= RECENT_WINDOW_MS;
    }

    private static String keyFor(String requestId) {
        return "remote_listen_launcher_" + requestId;
    }

    private static boolean isBlank(@Nullable String value) {
        return value == null || value.trim().isEmpty();
    }
}
