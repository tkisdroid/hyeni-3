package com.hyeni.calendar;

import android.Manifest;
import android.app.ActivityManager;
import android.app.KeyguardManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.media.AudioManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;

@CapacitorPlugin(name = "NativeNotification")
public class NotificationPlugin extends Plugin {

    private static final String PREFS_NAME = "hyeni_location_prefs";
    // 채널 ID 단일 소스 = NotificationHelper.CHANNEL_REMOTE_LISTEN.
    // 기존 "hyeni_remote_listen_v2" 는 실제 게시 채널(v5_silent_cover)과 불일치해
    // delivery health 진단이 항상 잘못된 채널을 조회하던 버그였다.
    private static final String REMOTE_LISTEN_CHANNEL_ID = NotificationHelper.CHANNEL_REMOTE_LISTEN;
    private final AtomicInteger notifId = new AtomicInteger(1000);

    @Override
    public void load() {
        NotificationHelper.createChannels(getContext());
    }

    @PluginMethod()
    public void setQuietHours(PluginCall call) {
        String userId = call.getString("userId");
        Boolean enabled = call.getBoolean("enabled");
        Integer startMinute = call.getInt("startMinute");
        Integer endMinute = call.getInt("endMinute");
        String timeZoneId = call.getString("timeZoneId");
        Long updatedAtMs = readNonNegativeLong(call, "updatedAtMs");

        if (userId == null || userId.trim().isEmpty()
                || enabled == null
                || startMinute == null
                || endMinute == null
                || startMinute < 0 || startMinute > 1439
                || endMinute < 0 || endMinute > 1439
                || startMinute.equals(endMinute)
                || !NotificationQuietHoursStore.SEOUL_TIME_ZONE_ID.equals(timeZoneId)
                || updatedAtMs == null) {
            call.resolve(quietHoursResult(
                    NotificationQuietHoursStore.SaveResult.INVALID_POLICY));
            return;
        }

        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        NotificationQuietHoursStore.SaveResult result =
                NotificationQuietHoursStore.saveIfCurrentSession(
                        prefs,
                        userId.trim(),
                        enabled,
                        startMinute,
                        endMinute,
                        timeZoneId,
                        updatedAtMs
                );
        call.resolve(quietHoursResult(result));
    }

    @PluginMethod()
    public void show(PluginCall call) {
        String title = call.getString("title", "혜니캘린더");
        String body = call.getString("body", "");
        String channel = call.getString("channel", "schedule");
        boolean wakeScreen = call.getBoolean("wakeScreen", false);
        boolean fullScreen = call.getBoolean("fullScreen", false);
        String route = call.getString("route", null);
        String type = call.getString("type", "local_notification");
        if (type == null || type.trim().isEmpty()) type = "local_notification";
        String alertType = call.getString("alertType", call.getString("alert_type", ""));
        String stableId = call.getString("id", call.getString("tag", null));
        int notificationId = stableId != null && !stableId.trim().isEmpty()
                ? NotificationHelper.stableRequestCode(stableId)
                : notifId.incrementAndGet();

        NotificationHelper.DeliveryReceipt receipt = NotificationHelper.showNotification(
                getContext(),
                title,
                body,
                channel,
                wakeScreen,
                fullScreen,
                notificationId,
                route,
                NotificationQuietHoursPolicy.NotificationIdentity.of(type, alertType)
        );

        call.resolve(new JSObject()
                .put("success", receipt.shouldAcknowledge())
                .put("displayed", receipt.wasPostedNow())
                .put("deliveryStatus", receipt.getStatus().name()));
    }

    static boolean shouldPendingUseFullScreen(boolean urgent) {
        return urgent;
    }

    static String pendingNotificationChannel(boolean urgent) {
        return NotificationChannelPolicy.channelFor("schedule", "", urgent);
    }

    static String pendingNotificationChannel(String type, String alertType, boolean urgent) {
        return NotificationChannelPolicy.channelFor(type, alertType, urgent);
    }

    /**
     * 부모 foreground pending fallback 표시. FCM 경로와 같은 stableId(pushId)를
     * PolledNotificationStore에서 확인하고, 실제 게시 가능한 경우에만 ACK를 남긴다.
     */
    @PluginMethod()
    public void showPending(PluginCall call) {
        Context context = getContext();
        String stableId = call.getString(
                "stableId",
                call.getString("pushId", call.getString("id", null))
        );
        if (stableId == null || stableId.trim().isEmpty()) {
            call.resolve(pendingDisplayResult(false, false));
            return;
        }

        if (PolledNotificationStore.isAcked(context, stableId)) {
            call.resolve(pendingDisplayResult(false, true));
            return;
        }
        // 최초 확인 뒤 FCM이 먼저 표시됐을 수 있으므로 게시 직전에 한 번 더 확인한다.
        if (PolledNotificationStore.isAcked(context, stableId)) {
            call.resolve(pendingDisplayResult(false, true));
            return;
        }

        boolean urgent = call.getBoolean("urgent", false);
        boolean fullScreen = shouldPendingUseFullScreen(urgent);
        String title = call.getString("title", "혜니캘린더");
        String body = call.getString("body", "");
        String route = call.getString("route", null);
        String type = call.getString("type", "schedule");
        String alertType = call.getString("alertType", call.getString("alert_type", ""));
        NotificationHelper.DeliveryReceipt receipt = NotificationHelper.showNotification(
                context,
                title,
                body,
                pendingNotificationChannel(type, alertType, urgent),
                fullScreen,
                fullScreen,
                NotificationHelper.stableRequestCode(stableId),
                route,
                NotificationQuietHoursPolicy.NotificationIdentity.of(type, alertType)
        );
        if (receipt.shouldAcknowledge()) {
            PolledNotificationStore.markAck(context, stableId);
        }
        call.resolve(pendingDisplayResult(receipt.wasPostedNow(), receipt.shouldAcknowledge()));
    }

    private static JSObject pendingDisplayResult(boolean displayed, boolean acknowledged) {
        return new JSObject()
                .put("displayed", displayed)
                .put("acknowledged", acknowledged);
    }

    private static Long readNonNegativeLong(PluginCall call, String key) {
        Object raw = call.getData().opt(key);
        if (!(raw instanceof Number)) return null;
        Number number = (Number) raw;
        double numeric = number.doubleValue();
        long value = number.longValue();
        if (!Double.isFinite(numeric) || numeric != (double) value || value < 0L) return null;
        return value;
    }

    private static JSObject quietHoursResult(NotificationQuietHoursStore.SaveResult result) {
        String reason;
        if (result == NotificationQuietHoursStore.SaveResult.SAVED) {
            reason = "saved";
        } else if (result == NotificationQuietHoursStore.SaveResult.STALE_SESSION) {
            reason = "stale_session";
        } else if (result == NotificationQuietHoursStore.SaveResult.STALE_UPDATE) {
            reason = "stale_update";
        } else {
            reason = "invalid_policy";
        }
        return new JSObject()
                .put("saved", result == NotificationQuietHoursStore.SaveResult.SAVED)
                .put("reason", reason);
    }

    @PluginMethod()
    public void replaceScheduledNotifications(PluginCall call) {
        JSArray notifications = call.getArray("notifications");
        if (notifications == null) {
            notifications = new JSArray();
        }

        NotificationScheduleManager.replaceAll(getContext(), notifications);
        call.resolve(new JSObject().put("scheduled", notifications.length()));
    }

    @PluginMethod()
    public void cancelScheduledNotifications(PluginCall call) {
        NotificationScheduleManager.cancelAll(getContext());
        call.resolve(new JSObject().put("success", true));
    }

    @PluginMethod()
    public void getDeliveryHealth(PluginCall call) {
        Context ctx = getContext();
        NotificationManager nm = (NotificationManager) ctx
                .getSystemService(Context.NOTIFICATION_SERVICE);
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        ActivityManager activityManager = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
        AudioManager audio = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        KeyguardManager keyguard = (KeyguardManager) ctx.getSystemService(Context.KEYGUARD_SERVICE);
        ConnectivityHealth connectivity = readConnectivity(ctx);
        Configuration config = ctx.getResources().getConfiguration();

        boolean notificationsEnabled = nm != null
                && nm.areNotificationsEnabled();
        boolean postPermissionGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
        boolean batteryOptimizationsIgnored = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || pm == null
                || pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        boolean powerSaveMode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP
                && pm != null
                && pm.isPowerSaveMode();
        boolean backgroundRestricted = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                && activityManager != null
                && activityManager.isBackgroundRestricted();
        boolean fullScreenIntentAllowed = nm != null
                && (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE
                || nm.canUseFullScreenIntent());
        boolean recordAudioGranted = ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
        // Android 10 미만은 신체 활동 런타임 권한이 없으므로 항상 granted 로 본다.
        boolean activityRecognitionGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                || ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACTIVITY_RECOGNITION)
                == PackageManager.PERMISSION_GRANTED;
        boolean locationServiceRunning = ctx
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getBoolean("serviceEnabled", false);
        boolean remoteListenChannelEnabled = isChannelEnabled(nm, REMOTE_LISTEN_CHANNEL_ID);
        int remoteListenChannelImportance = getChannelImportance(nm, REMOTE_LISTEN_CHANNEL_ID);
        boolean remoteListenChannelBlocked = remoteListenChannelImportance == NotificationManager.IMPORTANCE_NONE;
        String ringerMode = describeRingerMode(audio);
        String dndMode = describeDndMode(nm);
        boolean dndAccess = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || nm == null
                || nm.isNotificationPolicyAccessGranted();
        boolean screenInteractive = pm == null || pm.isInteractive();
        boolean keyguardLocked = keyguard != null && keyguard.isKeyguardLocked();
        String foldState = inferFoldState(config);
        boolean networkConnected = connectivity.connected;
        boolean networkValidated = connectivity.validated;

        boolean channelsEnabled = NotificationHelper.areRequiredDeliveryChannelsEnabled(nm);

        JSObject result = new JSObject();
        result.put("notificationsEnabled", notificationsEnabled);
        result.put("postPermissionGranted", postPermissionGranted);
        result.put("batteryOptimizationsIgnored", batteryOptimizationsIgnored);
        result.put("powerSaveMode", powerSaveMode);
        result.put("backgroundRestricted", backgroundRestricted);
        result.put("fullScreenIntentAllowed", fullScreenIntentAllowed);
        result.put("channelsEnabled", channelsEnabled);
        result.put("recordAudioGranted", recordAudioGranted);
        result.put("activityRecognitionGranted", activityRecognitionGranted);
        result.put("remoteListenChannelEnabled", remoteListenChannelEnabled);
        result.put("remoteListenChannelImportance", remoteListenChannelImportance);
        result.put("remoteListenChannelBlocked", remoteListenChannelBlocked);
        result.put("ringerMode", ringerMode);
        result.put("dndMode", dndMode);
        result.put("dndAccess", dndAccess);
        result.put("networkConnected", networkConnected);
        result.put("networkValidated", networkValidated);
        result.put("screenInteractive", screenInteractive);
        result.put("keyguardLocked", keyguardLocked);
        result.put("screenWidthDp", config.screenWidthDp);
        result.put("screenHeightDp", config.screenHeightDp);
        result.put("smallestScreenWidthDp", config.smallestScreenWidthDp);
        result.put("foldState", foldState);
        result.put("locationServiceRunning", locationServiceRunning);
        result.put("sdkInt", Build.VERSION.SDK_INT);
        result.put("manufacturer", Build.MANUFACTURER);
        result.put("model", Build.MODEL);
        result.put("usageAccessGranted", DeviceStatusReporter.isUsageAccessGranted(ctx));
        result.put("ready", notificationsEnabled
                && postPermissionGranted
                && batteryOptimizationsIgnored
                && !powerSaveMode
                && !backgroundRestricted
                && fullScreenIntentAllowed
                && channelsEnabled
                && recordAudioGranted
                && remoteListenChannelEnabled
                && networkConnected
                && locationServiceRunning);
        call.resolve(result);
    }

    @PluginMethod()
    public void checkChannelSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve(new JSObject().put("enabled", true));
            return;
        }

        NotificationManager nm = (NotificationManager) getContext()
                .getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) {
            call.resolve(new JSObject().put("enabled", false)
                    .put("areNotificationsEnabled", false));
            return;
        }

        JSObject result = new JSObject();
        result.put("enabled", NotificationHelper.areRequiredDeliveryChannelsEnabled(nm));
        result.put("areNotificationsEnabled", nm.areNotificationsEnabled());
        call.resolve(result);
    }

    @PluginMethod()
    public void openSettings(PluginCall call) {
        Context ctx = getContext();
        Intent intent = new Intent();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
        } else {
            intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + ctx.getPackageName()));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(intent);
        call.resolve();
    }

    @PluginMethod()
    public void openBatteryOptimizationSettings(PluginCall call) {
        Context ctx = getContext();
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(intent);
            call.resolve(new JSObject().put("status", "opened_battery_settings"));
            return;
        } catch (RuntimeException error) {
            Log.w("NotificationPlugin", "Battery settings list unavailable; opening app details", error);
        }

        Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        fallback.setData(Uri.parse("package:" + ctx.getPackageName()));
        fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(fallback);
            call.resolve(new JSObject().put("status", "opened_app_details"));
        } catch (RuntimeException error) {
            Log.w("NotificationPlugin", "Battery and app settings unavailable", error);
            call.reject("배터리 설정을 열 수 없습니다");
        }
    }

    @PluginMethod()
    public void openFullScreenIntentSettings(PluginCall call) {
        Context ctx = getContext();
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
            intent.setData(Uri.parse("package:" + ctx.getPackageName()));
        } else {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(intent);
            call.resolve(new JSObject().put("status", "opened_full_screen_settings"));
            return;
        } catch (RuntimeException error) {
            Log.w("NotificationPlugin", "Full-screen intent settings unavailable; opening app details", error);
        }

        Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        fallback.setData(Uri.parse("package:" + ctx.getPackageName()));
        fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(fallback);
            call.resolve(new JSObject().put("status", "opened_app_details"));
        } catch (RuntimeException error) {
            Log.w("NotificationPlugin", "Full-screen intent and app settings unavailable", error);
            call.reject("잠금화면 전체 표시 설정을 열 수 없습니다");
        }
    }

    @PluginMethod()
    public void openAppDetailsSettings(PluginCall call) {
        Context ctx = getContext();
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + ctx.getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(intent);
        call.resolve();
    }

    @PluginMethod()
    public void openUsageAccessSettings(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        } catch (Exception error) {
            // Usage Access 화면이 없는 기기는 앱 상세 설정으로 폴백
            Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            fallback.setData(Uri.parse("package:" + ctx.getPackageName()));
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(fallback);
        }
        call.resolve();
    }

    @PluginMethod()
    public void requestRecordAudio(PluginCall call) {
        Context ctx = getContext();
        boolean alreadyGranted = ContextCompat.checkSelfPermission(
                ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        if (alreadyGranted) {
            call.resolve(new JSObject().put("granted", true));
            return;
        }
        if (getActivity() == null) {
            call.resolve(new JSObject().put("granted", false));
            return;
        }
        ActivityCompat.requestPermissions(
                getActivity(),
                new String[]{ Manifest.permission.RECORD_AUDIO },
                4101
        );
        call.resolve(new JSObject().put("granted", false).put("requested", true));
    }

    @PluginMethod()
    public void requestPostNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            call.resolve(new JSObject().put("granted", true).put("notRequired", true));
            return;
        }
        Context ctx = getContext();
        boolean alreadyGranted = ContextCompat.checkSelfPermission(
                ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        if (alreadyGranted) {
            call.resolve(new JSObject().put("granted", true));
            return;
        }
        if (getActivity() == null) {
            call.resolve(new JSObject().put("granted", false));
            return;
        }
        ActivityCompat.requestPermissions(
                getActivity(),
                new String[]{ Manifest.permission.POST_NOTIFICATIONS },
                4102
        );
        call.resolve(new JSObject().put("granted", false).put("requested", true));
    }

    // 신체 활동(이동 수단 감지) 권한 — 자녀 권한 위저드에서 맥락 설명과 함께 요청.
    // requestRecordAudio 와 동일하게 다이얼로그 응답을 기다리지 않고 requested 로
    // 즉시 resolve 한다 (위저드의 2s 폴링이 부여 직후 상태를 갱신).
    @PluginMethod()
    public void requestActivityRecognition(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.resolve(new JSObject().put("granted", true).put("notRequired", true));
            return;
        }
        Context ctx = getContext();
        boolean alreadyGranted = ContextCompat.checkSelfPermission(
                ctx, Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED;
        if (alreadyGranted) {
            call.resolve(new JSObject().put("granted", true));
            return;
        }
        if (getActivity() == null) {
            call.resolve(new JSObject().put("granted", false));
            return;
        }
        ActivityCompat.requestPermissions(
                getActivity(),
                new String[]{ Manifest.permission.ACTIVITY_RECOGNITION },
                4103
        );
        call.resolve(new JSObject().put("granted", false).put("requested", true));
    }

    @PluginMethod()
    public void openNotificationChannelSettings(PluginCall call) {
        Context ctx = getContext();
        String channelId = call.getString("channelId", REMOTE_LISTEN_CHANNEL_ID);
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
            intent.putExtra(Settings.EXTRA_CHANNEL_ID, channelId);
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + ctx.getPackageName()));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(intent);
        call.resolve();
    }

    private boolean isChannelEnabled(NotificationManager nm, String channelId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return true;
        }
        if (nm == null) return false;
        NotificationChannel channel = nm.getNotificationChannel(channelId);
        return channel != null && channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    private int getChannelImportance(NotificationManager nm, String channelId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return NotificationManager.IMPORTANCE_DEFAULT;
        }
        if (nm == null) return NotificationManager.IMPORTANCE_NONE;
        NotificationChannel channel = nm.getNotificationChannel(channelId);
        return channel == null ? NotificationManager.IMPORTANCE_NONE : channel.getImportance();
    }

    private String describeRingerMode(AudioManager audio) {
        if (audio == null) return "unknown";
        int mode = audio.getRingerMode();
        if (mode == AudioManager.RINGER_MODE_NORMAL) return "normal";
        if (mode == AudioManager.RINGER_MODE_VIBRATE) return "vibrate";
        if (mode == AudioManager.RINGER_MODE_SILENT) return "silent";
        return "unknown";
    }

    private String describeDndMode(NotificationManager nm) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || nm == null) return "all";
        int filter = nm.getCurrentInterruptionFilter();
        if (filter == NotificationManager.INTERRUPTION_FILTER_ALL) return "all";
        if (filter == NotificationManager.INTERRUPTION_FILTER_PRIORITY) return "priority";
        if (filter == NotificationManager.INTERRUPTION_FILTER_NONE) return "none";
        if (filter == NotificationManager.INTERRUPTION_FILTER_ALARMS) return "alarms";
        return "unknown";
    }

    private ConnectivityHealth readConnectivity(Context ctx) {
        ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return new ConnectivityHealth(false, false);
        Network network = cm.getActiveNetwork();
        if (network == null) return new ConnectivityHealth(false, false);
        NetworkCapabilities caps = cm.getNetworkCapabilities(network);
        if (caps == null) return new ConnectivityHealth(false, false);
        boolean connected = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        boolean validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        return new ConnectivityHealth(connected, validated);
    }

    private String inferFoldState(Configuration config) {
        String model = (Build.MANUFACTURER + " " + Build.MODEL).toLowerCase(Locale.US);
        boolean likelyFoldable = model.contains("fold")
                || model.contains("flip")
                || model.contains("zflip")
                || model.contains("z fold");
        if (!likelyFoldable) return "not_foldable_or_unknown";
        if (config.screenWidthDp >= 600) return "wide_open";
        if (config.smallestScreenWidthDp >= 600 || config.screenWidthDp < 420) {
            return "possibly_folded";
        }
        return "unknown";
    }

    private static final class ConnectivityHealth {
        final boolean connected;
        final boolean validated;

        ConnectivityHealth(boolean connected, boolean validated) {
            this.connected = connected;
            this.validated = validated;
        }
    }
}
