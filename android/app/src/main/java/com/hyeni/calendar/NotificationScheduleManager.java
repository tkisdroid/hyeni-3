package com.hyeni.calendar;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

public final class NotificationScheduleManager {

    private static final String TAG = "NotificationSchedule";
    private static final String PREFS_NAME = "hyeni_notification_schedule";
    private static final String KEY_ITEMS = "items";
    private static final String ACTION_FIRE = "com.hyeni.calendar.action.FIRE_SCHEDULED_NOTIFICATION";
    private static final String EXTRA_ID = "scheduleId";
    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_BODY = "body";
    private static final String EXTRA_CHANNEL = "channel";
    private static final String EXTRA_WAKE_SCREEN = "wakeScreen";
    private static final String EXTRA_FULL_SCREEN = "fullScreen";

    private NotificationScheduleManager() {}

    public static void replaceAll(Context context, JSONArray notifications) {
        cancelAll(context);

        JSONArray persisted = new JSONArray();
        long now = System.currentTimeMillis();
        for (int i = 0; i < notifications.length(); i++) {
            JSONObject input = notifications.optJSONObject(i);
            if (input == null) {
                continue;
            }

            long fireAt = input.optLong("at", 0L);
            if (fireAt <= now) {
                continue;
            }

            String scheduleId = input.optString("id", "");
            if (scheduleId.isEmpty()) {
                continue;
            }

            scheduleAlarm(context, input);
            persisted.put(input);
        }

        saveItems(context, persisted);
        Log.i(TAG, "Scheduled " + persisted.length() + " native notifications");
    }

    public static void cancelAll(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        JSONArray stored = loadItems(context);
        for (int i = 0; i < stored.length(); i++) {
            JSONObject item = stored.optJSONObject(i);
            if (item == null) {
                continue;
            }

            PendingIntent pi = buildPendingIntent(context, item, PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
            if (am != null && pi != null) {
                am.cancel(pi);
                pi.cancel();
            }
        }

        saveItems(context, new JSONArray());
    }

    public static void restoreAll(Context context) {
        JSONArray stored = loadItems(context);
        JSONArray remaining = new JSONArray();
        long now = System.currentTimeMillis();

        for (int i = 0; i < stored.length(); i++) {
            JSONObject item = stored.optJSONObject(i);
            if (item == null) {
                continue;
            }

            long fireAt = item.optLong("at", 0L);
            if (fireAt <= now) {
                continue;
            }

            scheduleAlarm(context, item);
            remaining.put(item);
        }

        saveItems(context, remaining);
        Log.i(TAG, "Restored " + remaining.length() + " scheduled notifications");
    }

    public static void handleAlarm(Context context, Intent intent) {
        String scheduleId = intent.getStringExtra(EXTRA_ID);
        String title = intent.getStringExtra(EXTRA_TITLE);
        String body = intent.getStringExtra(EXTRA_BODY);
        String channel = intent.getStringExtra(EXTRA_CHANNEL);
        boolean wakeScreen = intent.getBooleanExtra(EXTRA_WAKE_SCREEN, false);
        boolean fullScreen = intent.getBooleanExtra(EXTRA_FULL_SCREEN, false);

        NotificationHelper.showNotification(
                context,
                title != null ? title : "혜니캘린더",
                body != null ? body : "",
                channel != null ? channel : "schedule",
                wakeScreen,
                fullScreen,
                NotificationHelper.stableRequestCode(scheduleId)
        );

        removeStoredItem(context, scheduleId);
    }

    private static void scheduleAlarm(Context context, JSONObject item) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = buildPendingIntent(context, item, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        long fireAt = item.optLong("at", 0L);

        if (am == null || pi == null || fireAt <= 0L) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && am.canScheduleExactAlarms()) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pi);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pi);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            am.setExact(AlarmManager.RTC_WAKEUP, fireAt, pi);
        } else {
            am.set(AlarmManager.RTC_WAKEUP, fireAt, pi);
        }
    }

    private static PendingIntent buildPendingIntent(Context context, JSONObject item, int flags) {
        String scheduleId = item.optString("id", "");
        if (scheduleId.isEmpty()) {
            return null;
        }

        Intent intent = new Intent(context, ScheduledNotificationReceiver.class);
        intent.setAction(ACTION_FIRE);
        intent.putExtra(EXTRA_ID, scheduleId);
        intent.putExtra(EXTRA_TITLE, item.optString("title", "혜니캘린더"));
        intent.putExtra(EXTRA_BODY, item.optString("body", ""));
        intent.putExtra(EXTRA_CHANNEL, item.optString("channel", "schedule"));
        intent.putExtra(EXTRA_WAKE_SCREEN, item.optBoolean("wakeScreen", false));
        intent.putExtra(EXTRA_FULL_SCREEN, item.optBoolean("fullScreen", false));

        return PendingIntent.getBroadcast(
                context,
                NotificationHelper.stableRequestCode(scheduleId),
                intent,
                flags
        );
    }

    private static SharedPreferences getPrefs(Context context) {
        Context storageContext = context;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            storageContext = context.createDeviceProtectedStorageContext();
        }
        return storageContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static JSONArray loadItems(Context context) {
        String raw = getPrefs(context).getString(KEY_ITEMS, "[]");
        try {
            return new JSONArray(raw);
        } catch (Exception err) {
            Log.w(TAG, "Failed to parse stored notification schedule", err);
            return new JSONArray();
        }
    }

    private static void saveItems(Context context, JSONArray items) {
        getPrefs(context)
                .edit()
                .putString(KEY_ITEMS, items.toString())
                .apply();
    }

    private static void removeStoredItem(Context context, String scheduleId) {
        if (scheduleId == null || scheduleId.isEmpty()) {
            return;
        }

        JSONArray stored = loadItems(context);
        JSONArray remaining = new JSONArray();
        for (int i = 0; i < stored.length(); i++) {
            JSONObject item = stored.optJSONObject(i);
            if (item == null) {
                continue;
            }

            if (!scheduleId.equals(item.optString("id"))) {
                remaining.put(item);
            }
        }

        saveItems(context, remaining);
    }
}
