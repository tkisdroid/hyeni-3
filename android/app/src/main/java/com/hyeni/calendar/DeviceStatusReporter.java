package com.hyeni.calendar;

import android.Manifest;
import android.app.ActivityManager;
import android.app.AppOpsManager;
import android.app.KeyguardManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.media.AudioManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.os.Process;
import android.telephony.TelephonyManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

final class DeviceStatusReporter {
    private static final String TAG = "DeviceStatusReporter";
    private static final String PREFS_NAME = "hyeni_location_prefs";
    private static final String DEVICE_INSTALL_ID = "deviceInstallId";
    // 채널 ID 단일 소스 = NotificationHelper.CHANNEL_REMOTE_LISTEN.
    // 기존 "hyeni_remote_listen_v2" 는 실제 게시 채널(v5_silent_cover)과 불일치해
    // device_health 의 remoteListenChannel* 값이 항상 엉뚱한 채널을 조회하던 버그였다.
    private static final String REMOTE_LISTEN_CHANNEL_ID = NotificationHelper.CHANNEL_REMOTE_LISTEN;

    // UsageEvents.Event.SCREEN_INTERACTIVE / SCREEN_NON_INTERACTIVE (API 28+).
    // 상수로 직접 명시해 API < 28 컴파일과 순수 함수 단위 테스트(Android 클래스 비의존)를 모두 가능하게 한다.
    static final int EVENT_SCREEN_INTERACTIVE = 15;
    static final int EVENT_SCREEN_NON_INTERACTIVE = 16;

    private DeviceStatusReporter() {}

    static boolean publish(
            Context context,
            OkHttpClient httpClient,
            String supabaseUrl,
            String supabaseKey,
            String familyId,
            String userId,
            @Nullable String accessToken,
            @Nullable String requestId,
            @Nullable String requesterUserId
    ) {
        if (isBlank(supabaseUrl) || isBlank(supabaseKey) || isBlank(familyId) || isBlank(userId)) {
            Log.w(TAG, "Device status publish skipped: missing context");
            return false;
        }

        try {
            JSONObject payload = buildPayload(context, familyId, userId, requestId, requesterUserId);
            JSONObject message = new JSONObject()
                .put("topic", "family-" + familyId)
                .put("event", "child_device_status")
                .put("payload", payload);
            JSONObject body = new JSONObject().put("messages", new JSONArray().put(message));

            String baseUrl = supabaseUrl.replaceAll("/+$", "");
            Request request = new Request.Builder()
                .url(baseUrl + "/realtime/v1/api/broadcast")
                .header("apikey", supabaseKey)
                .header("Authorization", "Bearer " + supabaseKey)
                .header("Content-Type", "application/json")
                .post(RequestBody.create(body.toString(), MediaType.get("application/json")))
                .build();

            Response response = httpClient.newCall(request).execute();
            boolean broadcastSuccess = response.isSuccessful();
            if (!broadcastSuccess) {
                Log.w(TAG, "Device status broadcast failed: " + response.code());
            } else {
                Log.i(TAG, "Device status broadcast sent");
            }
            response.close();
            boolean persistSuccess = persistDeviceHealth(httpClient, baseUrl, supabaseKey, accessToken, familyId, userId, payload);
            return broadcastSuccess || persistSuccess;
        } catch (Exception error) {
            Log.w(TAG, "Device status publish error", error);
            return false;
        }
    }

    private static boolean persistDeviceHealth(
            OkHttpClient httpClient,
            String baseUrl,
            String supabaseKey,
            @Nullable String accessToken,
            String familyId,
            String userId,
            JSONObject payload
    ) {
        try {
            String bearer = !isBlank(accessToken) ? accessToken : supabaseKey;
            String query = "?family_id=eq." + URLEncoder.encode(familyId, "UTF-8")
                + "&user_id=eq." + URLEncoder.encode(userId, "UTF-8");
            JSONObject body = new JSONObject().put("device_health", payload);
            Request request = new Request.Builder()
                .url(baseUrl + "/rest/v1/family_members" + query)
                .header("apikey", supabaseKey)
                .header("Authorization", "Bearer " + bearer)
                .header("Content-Type", "application/json")
                .header("Prefer", "return=minimal")
                .patch(RequestBody.create(body.toString(), MediaType.get("application/json")))
                .build();
            Response response = httpClient.newCall(request).execute();
            boolean success = response.isSuccessful();
            if (!success) {
                Log.w(TAG, "Device status persist failed: " + response.code());
            }
            response.close();
            return success;
        } catch (Exception error) {
            Log.w(TAG, "Device status persist error", error);
            return false;
        }
    }

    private static JSONObject buildPayload(
            Context context,
            String familyId,
            String userId,
            @Nullable String requestId,
            @Nullable String requesterUserId
    ) throws Exception {
        long now = System.currentTimeMillis();
        NotificationHelper.createChannels(context);
        DeviceBattery battery = readBattery(context);
        UsageSnapshot usage = readUsageSnapshot(context);
        ScreenOnTime screenOn = computeTodayScreenOnMs(context, usage.screenInteractive);
        int unlockCount = readUnlockCountToday(context);
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        ActivityManager activityManager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        KeyguardManager keyguard = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        Configuration config = context.getResources().getConfiguration();
        ConnectivityHealth connectivity = readConnectivity(context);
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        boolean notificationsEnabled = nm != null && nm.areNotificationsEnabled();
        boolean postPermissionGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED;
        boolean requiredChannelsEnabled = NotificationHelper.areRequiredDeliveryChannelsEnabled(nm);
        boolean batteryOptimizationsIgnored = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
            || pm == null
            || pm.isIgnoringBatteryOptimizations(context.getPackageName());
        boolean powerSaveMode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP
            && pm != null
            && pm.isPowerSaveMode();
        boolean backgroundRestricted = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            && activityManager != null
            && activityManager.isBackgroundRestricted();
        // Android 14+: NotificationManager.canUseFullScreenIntent gates whether
        // the child can auto-open the foreground bridge from a lock-screen push.
        boolean fullScreenIntentAllowed = nm != null
            && (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE
            || nm.canUseFullScreenIntent());
        boolean recordAudioGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED;
        boolean backgroundLocationGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            || ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
        boolean remoteListenChannelEnabled = isChannelEnabled(nm, REMOTE_LISTEN_CHANNEL_ID);
        int remoteListenChannelImportance = getChannelImportance(nm, REMOTE_LISTEN_CHANNEL_ID);
        boolean remoteListenChannelBlocked = remoteListenChannelImportance == NotificationManager.IMPORTANCE_NONE;
        boolean locationServiceRunning = prefs.getBoolean("serviceEnabled", false);
        String deviceInstallId = getOrCreateDeviceInstallId(prefs);
        String ringerMode = describeRingerMode(audio);
        String dndMode = describeDndMode(nm);
        boolean dndAccess = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
            || nm == null
            || nm.isNotificationPolicyAccessGranted();
        boolean keyguardLocked = keyguard != null && keyguard.isKeyguardLocked();

        JSONObject payload = new JSONObject()
            .put("family_id", familyId)
            .put("user_id", userId)
            .put("deviceInstallId", deviceInstallId)
            .put("updatedAt", formatIsoUtc(now))
            .put("batteryLevel", battery.level != null ? battery.level : JSONObject.NULL)
            .put("isCharging", battery.charging != null ? battery.charging : JSONObject.NULL)
            .put("connectionType", connectivity.connectionType)
            .put("appState", "native-background")
            .put("screenInteractive", usage.screenInteractive)
            .put("recentApp", usage.recentAppPackage.isEmpty()
                // 권한이 있어도 최근 10분 내 실행이 없으면 비는데, 그때 "권한 필요"라고
                // 말하면 거짓 안내다(2026-07-11 아침 실측). 상태를 구분해 정직하게.
                ? ("granted".equals(usage.usagePermission)
                    ? "최근 사용한 앱 없음"
                    : "혜니캘린더 (앱 외 사용기록은 OS 권한 필요)")
                : usage.recentAppLabel)
            .put("usagePermission", usage.usagePermission)
            .put("deviceUnlockCount", unlockCount >= 0 ? unlockCount : JSONObject.NULL)
            .put("appUsage", usage.appUsage)
            .put("deviceScreenOnMs", screenOn.ms >= 0L ? screenOn.ms : JSONObject.NULL)
            .put("deviceScreenOnSource", screenOn.source)
            .put("source", "native-fcm")
            .put("recordAudio", recordAudioGranted)
            .put("postNotif", postPermissionGranted && notificationsEnabled && requiredChannelsEnabled)
            .put("fullScreen", fullScreenIntentAllowed)
            .put("battery", batteryOptimizationsIgnored)
            .put("powerSaveMode", powerSaveMode)
            .put("backgroundRestricted", backgroundRestricted)
            .put("channelOk", remoteListenChannelEnabled)
            .put("remoteListenChannelImportance", remoteListenChannelImportance)
            .put("remoteListenChannelBlocked", remoteListenChannelBlocked)
            .put("locationOk", backgroundLocationGranted)
            .put("recordAudioGranted", recordAudioGranted)
            .put("postPermissionGranted", postPermissionGranted)
            .put("notificationsEnabled", notificationsEnabled)
            .put("requiredChannelsEnabled", requiredChannelsEnabled)
            .put("fullScreenIntentAllowed", fullScreenIntentAllowed)
            .put("batteryOptimizationsIgnored", batteryOptimizationsIgnored)
            .put("powerSaveMode", powerSaveMode)
            .put("backgroundRestricted", backgroundRestricted)
            .put("backgroundLocationGranted", backgroundLocationGranted)
            .put("remoteListenChannelEnabled", remoteListenChannelEnabled)
            .put("remoteListenChannelImportance", remoteListenChannelImportance)
            .put("remoteListenChannelBlocked", remoteListenChannelBlocked)
            .put("locationServiceRunning", locationServiceRunning)
            .put("ringerMode", ringerMode)
            .put("dndMode", dndMode)
            .put("dndAccess", dndAccess)
            .put("networkConnected", connectivity.connected)
            .put("networkValidated", connectivity.validated)
            .put("keyguardLocked", keyguardLocked)
            .put("screenWidthDp", config.screenWidthDp)
            .put("screenHeightDp", config.screenHeightDp)
            .put("smallestScreenWidthDp", config.smallestScreenWidthDp)
            .put("foldState", inferFoldState(config))
            .put("sdkInt", Build.VERSION.SDK_INT)
            .put("manufacturer", Build.MANUFACTURER)
            .put("model", Build.MODEL)
            .put("ready", notificationsEnabled
                && postPermissionGranted
                && requiredChannelsEnabled
                && fullScreenIntentAllowed
                && batteryOptimizationsIgnored
                && !powerSaveMode
                && !backgroundRestricted
                && recordAudioGranted
                && remoteListenChannelEnabled
                && connectivity.connected
                && locationServiceRunning);

        if (!isBlank(requestId)) payload.put("requestId", requestId);
        if (!isBlank(requesterUserId)) payload.put("requesterUserId", requesterUserId);
        return payload;
    }

    private static String getOrCreateDeviceInstallId(SharedPreferences prefs) {
        String existing = prefs.getString(DEVICE_INSTALL_ID, "");
        if (existing != null && !existing.trim().isEmpty()) return existing.trim();
        String next = java.util.UUID.randomUUID().toString();
        prefs.edit().putString(DEVICE_INSTALL_ID, next).apply();
        return next;
    }

    private static DeviceBattery readBattery(Context context) {
        Intent batteryStatus = context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (batteryStatus == null) return new DeviceBattery(null, null);

        int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        Integer pct = null;
        if (level >= 0 && scale > 0) {
            pct = Math.round(level * 100f / scale);
        }
        boolean charging = batteryStatus.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0;
        return new DeviceBattery(pct, charging);
    }

    private static UsageSnapshot readUsageSnapshot(Context context) {
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        boolean interactive = pm != null && pm.isInteractive();
        String recentApp = "";
        String usagePermission = "unavailable";
        JSONArray appUsage = new JSONArray();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            UsageStatsManager usm = (UsageStatsManager) context.getSystemService(Context.USAGE_STATS_SERVICE);
            if (usm != null) {
                long end = System.currentTimeMillis();
                long start = end - 10 * 60 * 1000L;
                appUsage = readAppUsage(context, usm, startOfTodayMillis(), end);
                String rawRecentApp = "";
                UsageEvents events = usm.queryEvents(start, end);
                if (events != null) {
                    UsageEvents.Event event = new UsageEvents.Event();
                    while (events.hasNextEvent()) {
                        events.getNextEvent(event);
                        if (event.getEventType() == UsageEvents.Event.ACTIVITY_RESUMED && event.getPackageName() != null) {
                            rawRecentApp = event.getPackageName();
                            if (!isSystemSurfacePackage(context, event.getPackageName())) {
                                recentApp = event.getPackageName();
                            }
                        }
                    }
                }
                usagePermission = resolveUsagePermission(
                    isUsageAccessGranted(context),
                    !rawRecentApp.isEmpty(),
                    appUsage.length() > 0
                );
            }
        }

        return new UsageSnapshot(interactive, recentApp,
            resolveAppLabel(context, recentApp), usagePermission, appUsage);
    }

    /**
     * 오늘(자정~현재) 화면 잠금 해제 횟수 — KEYGUARD_HIDDEN 이벤트만 센다.
     * 알림으로 화면이 켜지기만 한 것(SCREEN_INTERACTIVE)은 잠금이 풀리지 않으므로
     * 자연히 제외된다 = "아이가 직접 열어 본 횟수"(TK 요구 2026-07-11).
     * Usage Access 권한이 없거나 API<28 이면 -1(클라는 "—" 표시).
     */
    static int readUnlockCountToday(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return -1;
        try {
            if (!isUsageAccessGranted(context)) return -1;
            UsageStatsManager usm = (UsageStatsManager) context.getSystemService(Context.USAGE_STATS_SERVICE);
            if (usm == null) return -1;
            UsageEvents events = usm.queryEvents(startOfTodayMillis(), System.currentTimeMillis());
            if (events == null) return -1;
            int count = 0;
            UsageEvents.Event event = new UsageEvents.Event();
            while (events.hasNextEvent()) {
                events.getNextEvent(event);
                if (isKeyguardHiddenEvent(event.getEventType())) count++;
            }
            return count;
        } catch (Exception error) {
            return -1;
        }
    }

    static boolean isKeyguardHiddenEvent(int eventType) {
        return eventType == UsageEvents.Event.KEYGUARD_HIDDEN;
    }

    /**
     * 안전지표는 "실제 앱 실행" 기준 — 런처·설정·시스템UI 같은 시스템 표면은
     * 최근 앱/앱 사용 목록·비율 분모에서 제외한다(TK 지시 2026-07-11).
     * 화면시간(deviceScreenOnMs)은 물리적 스크린온이라 그대로 둔다.
     */
    private static volatile java.util.Set<String> homePackagesCache;

    static boolean isSystemSurfacePackage(Context context, String pkg) {
        if (isBlank(pkg)) return true;
        if (pkg.equals("com.android.settings")
            || pkg.equals("com.android.systemui")
            || pkg.equals("com.google.android.permissioncontroller")
            || pkg.equals("com.android.permissioncontroller")
            || pkg.contains("packageinstaller")
            || pkg.contains("launcher")) {
            return true;
        }
        if (homePackages(context).contains(pkg)) return true;
        try {
            PackageManager pm = context.getPackageManager();
            ApplicationInfo info = pm.getApplicationInfo(pkg, 0);
            boolean systemApp = (info.flags & ApplicationInfo.FLAG_SYSTEM) != 0;
            boolean updatedSystemApp = (info.flags & ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0;
            boolean hasLaunchIntent = pm.getLaunchIntentForPackage(pkg) != null;
            return shouldExcludeNonLaunchableSystemApp(systemApp, updatedSystemApp, hasLaunchIntent);
        } catch (Exception ignored) {
            // 조회 실패만으로 일반 앱을 숨기지 않는다. 명시 목록은 위에서 이미 처리했다.
            return false;
        }
    }

    static boolean shouldExcludeNonLaunchableSystemApp(
            boolean systemApp,
            boolean updatedSystemApp,
            boolean hasLaunchIntent
    ) {
        return (systemApp || updatedSystemApp) && !hasLaunchIntent;
    }

    static String resolveUsagePermission(
            boolean appOpsGranted,
            boolean hasRawRecentApp,
            boolean hasVisibleUsageRows
    ) {
        return appOpsGranted || hasRawRecentApp || hasVisibleUsageRows
            ? "granted"
            : "requires_permission";
    }

    private static java.util.Set<String> homePackages(Context context) {
        java.util.Set<String> cached = homePackagesCache;
        if (cached != null) return cached;
        java.util.HashSet<String> out = new java.util.HashSet<>();
        try {
            android.content.Intent home = new android.content.Intent(android.content.Intent.ACTION_MAIN)
                .addCategory(android.content.Intent.CATEGORY_HOME);
            for (android.content.pm.ResolveInfo info :
                    context.getPackageManager().queryIntentActivities(home, 0)) {
                if (info != null && info.activityInfo != null && info.activityInfo.packageName != null) {
                    out.add(info.activityInfo.packageName);
                }
            }
        } catch (Exception ignored) {
            // 런처 목록을 못 읽어도 하드코딩 목록이 방어한다.
        }
        homePackagesCache = out;
        return out;
    }

    // package-accessible — LocationPlugin(WebView 경로)도 동일한 top-N 앱 사용량을
    // 재사용해 FCM 경로와 표시를 일치시킨다.
    static JSONArray readAppUsage(Context context, UsageStatsManager usm, long start, long end) {
        JSONArray result = new JSONArray();
        try {
            List<UsageStats> stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, end);
            if (stats == null || stats.isEmpty()) return result;

            ArrayList<AppUsageRow> rows = new ArrayList<>();
            long totalMs = 0L;
            for (UsageStats stat : stats) {
                if (stat == null || isBlank(stat.getPackageName())) continue;
                if (isSystemSurfacePackage(context, stat.getPackageName())) continue;
                long usageMs = stat.getTotalTimeInForeground();
                if (usageMs <= 0L) continue;
                long lastTimeUsed = stat.getLastTimeUsed();
                rows.add(new AppUsageRow(
                    stat.getPackageName(),
                    resolveAppLabel(context, stat.getPackageName()),
                    usageMs,
                    lastTimeUsed
                ));
                totalMs += usageMs;
            }
            Collections.sort(rows, (left, right) -> {
                int byUsage = Long.compare(right.usageMs, left.usageMs);
                if (byUsage != 0) return byUsage;
                return Long.compare(right.lastTimeUsed, left.lastTimeUsed);
            });
            int limit = Math.min(5, rows.size());
            for (int i = 0; i < limit; i++) {
                AppUsageRow row = rows.get(i);
                int percent = totalMs > 0L ? Math.round((row.usageMs * 100f) / totalMs) : 0;
                result.put(new JSONObject()
                    .put("name", row.label)
                    .put("packageName", row.packageName)
                    .put("usageMs", row.usageMs)
                    .put("lastTimeUsed", row.lastTimeUsed)
                    .put("percent", Math.max(0, Math.min(100, percent))));
            }
        } catch (Exception error) {
            Log.w(TAG, "app usage query failed", error);
        }
        return result;
    }

    // 패키지명(com.google.android.apps.messaging)을 사람이 읽을 수 있는 앱
    // 이름(메시지)으로 변환한다. 미설치 / 패키지 가시성 제한 등으로 실패하면
    // 패키지명을 그대로 반환한다. manifest 의 <queries> LAUNCHER 인텐트 덕분에
    // 런처에 아이콘이 있는 앱은 대부분 해석된다.
    static String resolveAppLabel(Context context, String packageName) {
        if (packageName == null || packageName.isEmpty()) {
            return packageName;
        }
        try {
            PackageManager pm = context.getPackageManager();
            ApplicationInfo info = pm.getApplicationInfo(packageName, 0);
            CharSequence label = pm.getApplicationLabel(info);
            if (label != null && label.length() > 0) {
                return label.toString();
            }
        } catch (Exception error) {
            Log.d(TAG, "App label resolution failed for " + packageName
                + " — falling back to package name");
        }
        return packageName;
    }

    /**
     * 화면 ON/OFF 이벤트 목록으로 [windowStart, windowEnd] 구간의 총 화면 켜짐 시간(ms)을 계산한다.
     * eventTimestamps/eventTypes 는 시간 오름차순. EVENT_SCREEN_INTERACTIVE/NON_INTERACTIVE
     * 외의 type 은 무시한다. windowStart/End 밖의 이벤트는 구간 경계로 clamp 한다.
     * 순수 함수 — Android 클래스에 의존하지 않아 로컬 단위 테스트가 가능하다.
     */
    static long sumScreenOnMs(long[] eventTimestamps, int[] eventTypes,
                              long windowStart, long windowEnd, boolean interactiveNow) {
        if (windowEnd <= windowStart) return 0L;
        long total = 0L;
        long onSince = -1L;
        boolean sawScreenEvent = false;
        int count = (eventTimestamps == null || eventTypes == null)
            ? 0
            : Math.min(eventTimestamps.length, eventTypes.length);
        for (int i = 0; i < count; i++) {
            int type = eventTypes[i];
            if (type != EVENT_SCREEN_INTERACTIVE && type != EVENT_SCREEN_NON_INTERACTIVE) continue;
            long ts = eventTimestamps[i];
            if (ts < windowStart) ts = windowStart;
            if (ts > windowEnd) ts = windowEnd;
            sawScreenEvent = true;
            if (type == EVENT_SCREEN_INTERACTIVE) {
                if (onSince < 0L) onSince = ts;
            } else {
                // 첫 이벤트가 OFF 면 windowStart 부터 켜져 있던 것으로 본다.
                long from = (onSince >= 0L) ? onSince : windowStart;
                if (ts > from) total += ts - from;
                onSince = -1L;
            }
        }
        if (onSince >= 0L) {
            // 마지막까지 화면이 켜진 상태 → 구간 끝까지 카운트
            total += windowEnd - onSince;
        } else if (!sawScreenEvent && interactiveNow) {
            // 구간 내 화면 토글 이벤트가 전혀 없는데 지금 켜져 있음 → 종일 켜짐
            total += windowEnd - windowStart;
        }
        if (total < 0L) total = 0L;
        if (total > windowEnd - windowStart) total = windowEnd - windowStart;
        return total;
    }

    static long startOfTodayMillis() {
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /** Usage Access(PACKAGE_USAGE_STATS) 권한 부여 여부 — AppOpsManager 로 정확히 판정. */
    static boolean isUsageAccessGranted(Context context) {
        if (context == null) return false;
        try {
            AppOpsManager appOps = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
            if (appOps == null) return false;
            String pkg = context.getPackageName();
            int uid = Process.myUid();
            int mode;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                mode = appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, uid, pkg);
            } else {
                mode = appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, uid, pkg);
            }
            return mode == AppOpsManager.MODE_ALLOWED;
        } catch (Exception error) {
            return false;
        }
    }

    /**
     * 오늘(자정~현재) 기기 전체 화면 켜짐 시간을 계산한다.
     * SCREEN_INTERACTIVE 이벤트는 API 28+ 전용, Usage Access 권한이 필요하다.
     * 측정 불가 시 ms = -1, source 에 사유를 담는다.
     */
    private static ScreenOnTime computeTodayScreenOnMs(Context context, boolean interactiveNow) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            return new ScreenOnTime(-1L, "unavailable_api");
        }
        if (!isUsageAccessGranted(context)) {
            return new ScreenOnTime(-1L, "unavailable_permission");
        }
        UsageStatsManager usm = (UsageStatsManager) context.getSystemService(Context.USAGE_STATS_SERVICE);
        if (usm == null) {
            return new ScreenOnTime(-1L, "unavailable");
        }
        long end = System.currentTimeMillis();
        long start = startOfTodayMillis();
        ArrayList<long[]> rows = new ArrayList<>();
        try {
            UsageEvents events = usm.queryEvents(start, end);
            if (events != null) {
                UsageEvents.Event event = new UsageEvents.Event();
                while (events.hasNextEvent()) {
                    events.getNextEvent(event);
                    int type = event.getEventType();
                    if (type == EVENT_SCREEN_INTERACTIVE || type == EVENT_SCREEN_NON_INTERACTIVE) {
                        rows.add(new long[]{ event.getTimeStamp(), type });
                    }
                }
            }
        } catch (Exception error) {
            Log.w(TAG, "screen-on usage query failed", error);
            return new ScreenOnTime(-1L, "unavailable");
        }
        long[] timestamps = new long[rows.size()];
        int[] types = new int[rows.size()];
        for (int i = 0; i < rows.size(); i++) {
            timestamps[i] = rows.get(i)[0];
            types[i] = (int) rows.get(i)[1];
        }
        long total = sumScreenOnMs(timestamps, types, start, end, interactiveNow);
        return new ScreenOnTime(total, "usage-stats");
    }

    private static boolean isChannelEnabled(@Nullable NotificationManager nm, String channelId) {
        if (nm == null) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        NotificationChannel channel = nm.getNotificationChannel(channelId);
        return channel != null && channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    private static int getChannelImportance(@Nullable NotificationManager nm, String channelId) {
        if (nm == null) return NotificationManager.IMPORTANCE_NONE;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return NotificationManager.IMPORTANCE_DEFAULT;
        NotificationChannel channel = nm.getNotificationChannel(channelId);
        return channel == null ? NotificationManager.IMPORTANCE_NONE : channel.getImportance();
    }

    private static String describeRingerMode(@Nullable AudioManager audio) {
        if (audio == null) return "unknown";
        int mode = audio.getRingerMode();
        if (mode == AudioManager.RINGER_MODE_NORMAL) return "normal";
        if (mode == AudioManager.RINGER_MODE_VIBRATE) return "vibrate";
        if (mode == AudioManager.RINGER_MODE_SILENT) return "silent";
        return "unknown";
    }

    private static String describeDndMode(@Nullable NotificationManager nm) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || nm == null) return "all";
        int filter = nm.getCurrentInterruptionFilter();
        if (filter == NotificationManager.INTERRUPTION_FILTER_ALL) return "all";
        if (filter == NotificationManager.INTERRUPTION_FILTER_PRIORITY) return "priority";
        if (filter == NotificationManager.INTERRUPTION_FILTER_NONE) return "none";
        if (filter == NotificationManager.INTERRUPTION_FILTER_ALARMS) return "alarms";
        return "unknown";
    }

    private static ConnectivityHealth readConnectivity(Context context) {
        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return new ConnectivityHealth(false, false, "NONE");
        Network network = cm.getActiveNetwork();
        if (network == null) return new ConnectivityHealth(false, false, "NONE");
        NetworkCapabilities caps = cm.getNetworkCapabilities(network);
        if (caps == null) return new ConnectivityHealth(false, false, "NONE");
        boolean connected = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        boolean validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        boolean wifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
        boolean cellular = caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR);
        // READ_PHONE_STATE를 요청하지 않는 앱에서 망 세대 조회 API를 호출하면
        // SecurityException 또는 민감 권한 확대로 이어진다. 연결 여부/전송망은
        // NetworkCapabilities가 이미 제공하므로 연결망은 알 수 있지만 세대는 알 수 없다.
        // 민감 권한 없이 확인되지 않은 4G/5G를 지어내지 않고 일반 셀룰러로 보고한다.
        int cellularType = TelephonyManager.NETWORK_TYPE_UNKNOWN;
        return new ConnectivityHealth(connected, validated,
            normalizeConnectionType(connected, wifi, cellular, cellularType));
    }

    static String normalizeConnectionType(boolean connected, boolean wifi, boolean cellular, int cellularNetworkType) {
        if (!connected) return "NONE";
        if (wifi) return "wi-fi";
        if (cellular) {
            if (cellularNetworkType == TelephonyManager.NETWORK_TYPE_NR) return "5g";
            if (cellularNetworkType == TelephonyManager.NETWORK_TYPE_UNKNOWN) return "cellular";
            return "4g";
        }
        return "NONE";
    }

    private static String inferFoldState(Configuration config) {
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

    private static String formatIsoUtc(long timeMs) {
        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        return iso.format(new Date(timeMs));
    }

    private static boolean isBlank(@Nullable String value) {
        return value == null || value.trim().isEmpty();
    }

    private static final class DeviceBattery {
        final Integer level;
        final Boolean charging;

        DeviceBattery(@Nullable Integer level, @Nullable Boolean charging) {
            this.level = level;
            this.charging = charging;
        }
    }

    private static final class UsageSnapshot {
        final boolean screenInteractive;
        final String recentAppPackage;
        final String recentAppLabel;
        final String usagePermission;
        final JSONArray appUsage;

        UsageSnapshot(boolean screenInteractive, String recentAppPackage,
                String recentAppLabel, String usagePermission, JSONArray appUsage) {
            this.screenInteractive = screenInteractive;
            this.recentAppPackage = recentAppPackage;
            this.recentAppLabel = recentAppLabel;
            this.usagePermission = usagePermission;
            this.appUsage = appUsage != null ? appUsage : new JSONArray();
        }
    }

    private static final class AppUsageRow {
        final String packageName;
        final String label;
        final long usageMs;
        final long lastTimeUsed;

        AppUsageRow(String packageName, String label, long usageMs, long lastTimeUsed) {
            this.packageName = packageName;
            this.label = isBlank(label) ? packageName : label;
            this.usageMs = usageMs;
            this.lastTimeUsed = lastTimeUsed;
        }
    }

    private static final class ScreenOnTime {
        final long ms;       // -1 이면 측정 불가
        final String source; // "usage-stats" | "unavailable" | "unavailable_api" | "unavailable_permission"

        ScreenOnTime(long ms, String source) {
            this.ms = ms;
            this.source = source;
        }
    }

    private static final class ConnectivityHealth {
        final boolean connected;
        final boolean validated;
        final String connectionType;

        ConnectivityHealth(boolean connected, boolean validated, String connectionType) {
            this.connected = connected;
            this.validated = validated;
            this.connectionType = connectionType;
        }
    }
}
