package com.hyeni.calendar;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

@CapacitorPlugin(
    name = "BackgroundLocation",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION }, alias = "location"),
        @Permission(strings = { Manifest.permission.ACCESS_COARSE_LOCATION }, alias = "coarseLocation"),
        @Permission(strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }, alias = "backgroundLocation")
    }
)
public class LocationPlugin extends Plugin {

    private static final String TAG = "LocationPlugin";
    private static final String PREFS_NAME = "hyeni_location_prefs";
    private static final String DEVICE_INSTALL_ID = "deviceInstallId";
    private static final String LAST_FCM_CONFLICT_ROTATION_NONCE = "lastFcmConflictRotationNonce";
    private static final Object FCM_CONFLICT_RECOVERY_LOCK = new Object();
    private static boolean fcmConflictRecoveryInFlight = false;

    @PluginMethod
    public void startService(PluginCall call) {
        String userId = call.getString("userId");
        String familyId = call.getString("familyId");
        String supabaseUrl = call.getString("supabaseUrl");
        String supabaseKey = call.getString("supabaseKey");
        String accessToken = call.getString("accessToken", "");
        String refreshToken = call.getString("refreshToken", "");
        String sessionNonce = call.getString("sessionNonce", "");
        String role = call.getString("role", "child");
        String intervalMode = call.getString("intervalMode", "balanced");

        if (userId == null || familyId == null) {
            call.reject("userId and familyId are required");
            return;
        }
        if ((accessToken == null || accessToken.isEmpty()) && (refreshToken == null || refreshToken.isEmpty())) {
            call.reject("accessToken or refreshToken is required");
            return;
        }

        // 권한 요청은 아이 온보딩의 prominent disclosure 또는 사용자가 누른 설정 화면에서만
        // 수행한다. 서비스 자동 시작이 OS 권한창을 띄우면 거부 의사를 무시하고 Play의
        // 백그라운드 위치 고지 순서도 깨지므로, 여기서는 상태만 반환한다.
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            call.resolve(new JSObject().put("status", "permission_required").put("permission", "foreground"));
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            call.resolve(new JSObject().put("status", "permission_required").put("permission", "background"));
            return;
        }
        requestActivityRecognitionIfNeeded();

        launchService(userId, familyId, supabaseUrl, supabaseKey, accessToken, refreshToken, sessionNonce, role, intervalMode);
        call.resolve(new JSObject().put("status", "started"));
    }

    @PluginMethod
    public void requestCurrentLocation(PluginCall call) {
        String userId = call.getString("userId");
        String familyId = call.getString("familyId");
        String supabaseUrl = call.getString("supabaseUrl");
        String supabaseKey = call.getString("supabaseKey");
        String accessToken = call.getString("accessToken", "");
        String refreshToken = call.getString("refreshToken", "");
        String sessionNonce = call.getString("sessionNonce", "");
        String role = call.getString("role", "child");
        String intervalMode = call.getString("intervalMode", "balanced");

        if (userId == null || familyId == null) {
            call.reject("userId and familyId are required");
            return;
        }
        if ((accessToken == null || accessToken.isEmpty()) && (refreshToken == null || refreshToken.isEmpty())) {
            call.reject("accessToken or refreshToken is required");
            return;
        }

        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            call.reject("Location permission denied");
            return;
        }

        launchRefresh(userId, familyId, supabaseUrl, supabaseKey, accessToken, refreshToken, sessionNonce, role, intervalMode);
        call.resolve(new JSObject().put("status", "refresh_requested"));
    }

    @PermissionCallback
    private void onLocationPermissionResult(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED) {
            String userId = call.getString("userId");
            String familyId = call.getString("familyId");
            String supabaseUrl = call.getString("supabaseUrl");
            String supabaseKey = call.getString("supabaseKey");
            String accessToken = call.getString("accessToken", "");
            String refreshToken = call.getString("refreshToken", "");
            String sessionNonce = call.getString("sessionNonce", "");
            String role = call.getString("role", "child");
            String intervalMode = call.getString("intervalMode", "balanced");

            // Also request background location (Android 10+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ActivityCompat.requestPermissions(getActivity(),
                    new String[]{ Manifest.permission.ACCESS_BACKGROUND_LOCATION }, 2001);
            }
            requestActivityRecognitionIfNeeded();

            launchService(userId, familyId, supabaseUrl, supabaseKey, accessToken, refreshToken, sessionNonce, role, intervalMode);
            call.resolve(new JSObject().put("status", "started"));
        } else {
            call.reject("Location permission denied");
        }
    }

    // 차량 이동 감지(Activity Recognition)용 런타임 권한 — Android 10+.
    // 미허용이어도 위치 추적 자체는 동작하며, 차량 출발 깨우기만 비활성화된다.
    private void requestActivityRecognitionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACTIVITY_RECOGNITION)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        try {
            ActivityCompat.requestPermissions(getActivity(),
                new String[]{ Manifest.permission.ACTIVITY_RECOGNITION }, 2002);
        } catch (Exception ignored) {
            // best-effort; vehicle wake degrades gracefully if denied
        }
    }

    private String normalizeIntervalMode(String mode) {
        if ("live".equals(mode) || "saver".equals(mode) || "balanced".equals(mode)) {
            return mode;
        }
        return "balanced";
    }

    private void launchService(
        String userId,
        String familyId,
        String supabaseUrl,
        String supabaseKey,
        String accessToken,
        String refreshToken,
        String sessionNonce,
        String role,
        String intervalMode
    ) {
        Intent intent = new Intent(getContext(), LocationService.class);
        intent.putExtra("userId", userId);
        intent.putExtra("familyId", familyId);
        intent.putExtra("supabaseUrl", supabaseUrl);
        intent.putExtra("supabaseKey", supabaseKey);
        intent.putExtra("accessToken", accessToken);
        intent.putExtra("refreshToken", refreshToken);
        intent.putExtra("sessionNonce", sessionNonce);
        intent.putExtra("role", role);
        intent.putExtra("intervalMode", normalizeIntervalMode(intervalMode));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        Log.i(TAG, "Location service launched");
    }

    private void launchRefresh(
        String userId,
        String familyId,
        String supabaseUrl,
        String supabaseKey,
        String accessToken,
        String refreshToken,
        String sessionNonce,
        String role,
        String intervalMode
    ) {
        Intent intent = new Intent(getContext(), LocationService.class);
        intent.setAction(LocationService.ACTION_REFRESH_NOW);
        intent.putExtra("userId", userId);
        intent.putExtra("familyId", familyId);
        intent.putExtra("supabaseUrl", supabaseUrl);
        intent.putExtra("supabaseKey", supabaseKey);
        intent.putExtra("accessToken", accessToken);
        intent.putExtra("refreshToken", refreshToken);
        intent.putExtra("sessionNonce", sessionNonce);
        intent.putExtra("role", role);
        intent.putExtra("intervalMode", normalizeIntervalMode(intervalMode));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        Log.i(TAG, "Immediate location refresh requested");
    }

    @PluginMethod
    public void getDeviceUsageSnapshot(PluginCall call) {
        JSObject result = new JSObject();
        try {
            IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent batteryStatus = getContext().registerReceiver(null, ifilter);
            if (batteryStatus != null) {
                int level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                boolean charging = batteryStatus.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0;
                if (level >= 0 && scale > 0) {
                    result.put("batteryLevel", Math.round(level * 100f / scale));
                } else {
                    result.put("batteryLevel", (Object) null);
                }
                result.put("isCharging", charging);
            }

            PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
            boolean interactive = pm != null && pm.isInteractive();
            result.put("screenInteractive", interactive);

            String recentApp = "";
            String recentAppLabel = "";
            String usagePermission = "unavailable";
            org.json.JSONArray appUsage = new org.json.JSONArray();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                UsageStatsManager usm = (UsageStatsManager) getContext().getSystemService(android.content.Context.USAGE_STATS_SERVICE);
                if (usm != null) {
                    long end = System.currentTimeMillis();
                    long start = end - 10 * 60 * 1000L;
                    UsageEvents events = usm.queryEvents(start, end);
                    if (events != null) {
                        UsageEvents.Event event = new UsageEvents.Event();
                        while (events.hasNextEvent()) {
                            events.getNextEvent(event);
                            if (event.getEventType() == UsageEvents.Event.ACTIVITY_RESUMED && event.getPackageName() != null
                                && !DeviceStatusReporter.isSystemSurfacePackage(getContext(), event.getPackageName())) {
                                recentApp = event.getPackageName();
                            }
                        }
                    }
                    // FCM 경로(DeviceStatusReporter)와 동일하게 오늘 하루 top-N 앱 사용량(이름+시간)을 채운다.
                    appUsage = DeviceStatusReporter.readAppUsage(getContext(), usm, DeviceStatusReporter.startOfTodayMillis(), end);
                    recentAppLabel = DeviceStatusReporter.resolveAppLabel(getContext(), recentApp);
                    // 필터로 recentApp 이 비어도 권한이 없는 게 아니다 — AppOps 로 정확 판정.
                    usagePermission = DeviceStatusReporter.isUsageAccessGranted(getContext()) ? "granted" : "requires_permission";
                }
            }
            result.put("recentAppPackage", recentApp);
            int unlockCount = DeviceStatusReporter.readUnlockCountToday(getContext());
            result.put("deviceUnlockCount", unlockCount >= 0 ? unlockCount : JSONObject.NULL);
            result.put("recentAppLabel", recentAppLabel);
            result.put("appUsage", appUsage);
            result.put("usagePermission", usagePermission);
        } catch (Exception e) {
            Log.w(TAG, "getDeviceUsageSnapshot failed", e);
            result.put("error", e.getMessage());
        }
        call.resolve(result);
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        boolean clearSession = Boolean.TRUE.equals(call.getBoolean("clearSession"));
        if (clearSession) {
            SessionTokenStore.clear(
                getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE),
                call.getString("sessionNonce", "")
            );
        }
        Intent intent = new Intent(getContext(), LocationService.class);
        intent.setAction("STOP");
        getContext().startService(intent);
        call.resolve(new JSObject().put("status", "stopped"));
    }

    @PluginMethod
    public void updateToken(PluginCall call) {
        String newToken = call.getString("accessToken");
        if (newToken == null || newToken.isEmpty()) {
            call.reject("accessToken is required");
            return;
        }
        String newRefresh = call.getString("refreshToken");
        String sessionNonce = call.getString("sessionNonce", "");
        String userId = call.getString("userId", "");
        String familyId = call.getString("familyId", "");
        String role = call.getString("role", "");
        String supabaseUrl = call.getString("supabaseUrl", "");
        String supabaseKey = call.getString("supabaseKey", "");
        if (userId == null || userId.isEmpty()
                || familyId == null || familyId.isEmpty()
                || role == null || role.isEmpty()
                || supabaseUrl == null || supabaseUrl.isEmpty()
                || supabaseKey == null || supabaseKey.isEmpty()) {
            call.reject("complete session context is required");
            return;
        }
        boolean authoritative = Boolean.TRUE.equals(call.getBoolean("authoritative"));
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        SessionTokenStore.ContextSnapshot session;
        synchronized (SessionTokenStore.class) {
            SessionTokenStore.ContextSnapshot stored = SessionTokenStore.readContext(prefs);
            session = SessionTokenStore.reconcileContext(
                prefs,
                newToken,
                newRefresh,
                authoritative,
                sessionNonce,
                userId,
                familyId,
                role,
                supabaseUrl,
                supabaseKey,
                stored.serviceEnabled,
                stored.locationIntervalMode
            );
        }
        if (!session.acceptedIncoming) {
            Log.w(TAG, "Ignored stale WebView updateToken; keeping newer native session");
            call.resolve(new JSObject().put("status", "ignored_stale"));
            return;
        }
        Log.i(TAG, "Access token updated via bridge");
        call.resolve(new JSObject().put("status", "updated"));
    }

    // resume 시 WebView 가 네이티브의 최신 토큰을 채택하기 위한 읽기 전용 조회.
    // 백그라운드에서 네이티브가 refresh token 을 회전했을 수 있으므로, WebView 는
    // 이 값을 우선 채택해 stale refresh token 으로 로그아웃되는 것을 막는다.
    @PluginMethod
    public void getSessionTokens(PluginCall call) {
        android.content.SharedPreferences prefs = getContext()
            .getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE);
        SessionTokenStore.ContextSnapshot session = SessionTokenStore.readContext(prefs);
        JSObject result = new JSObject();
        result.put("accessToken", session.accessToken);
        result.put("refreshToken", session.refreshToken);
        result.put("serviceEnabled", session.serviceEnabled);
        call.resolve(result);
    }

    @PluginMethod
    public void getFcmToken(PluginCall call) {
        // First check SharedPreferences (set by MyFirebaseMessagingService.onNewToken)
        String cached = getContext()
            .getSharedPreferences("hyeni_location_prefs", android.content.Context.MODE_PRIVATE)
            .getString("fcmToken", null);

        if (cached != null && !cached.isEmpty()) {
            NativePushTokenSync.sync(getContext(), cached);
            call.resolve(new JSObject().put("token", cached));
            return;
        }

        // Otherwise fetch from Firebase SDK
        FirebaseMessaging.getInstance().getToken()
            .addOnSuccessListener(token -> {
                getContext()
                    .getSharedPreferences("hyeni_location_prefs", android.content.Context.MODE_PRIVATE)
                    .edit()
                    .putString("fcmToken", token)
                    .apply();
                NativePushTokenSync.sync(getContext(), token);
                call.resolve(new JSObject().put("token", token));
            })
            .addOnFailureListener(e -> {
                Log.e(TAG, "Failed to get FCM token: " + e.getMessage());
                call.reject("Failed to get FCM token");
            });
    }

    @PluginMethod
    public void rotateFcmToken(PluginCall call) {
        String expectedUserId = call.getString("userId", "").trim();
        String expectedFamilyId = call.getString("familyId", "").trim();
        String expectedSessionNonce = call.getString("sessionNonce", "").trim();
        String conflictedToken = call.getString("conflictedToken", "").trim();
        if (expectedUserId.isEmpty() || expectedFamilyId.isEmpty()
                || expectedSessionNonce.isEmpty() || conflictedToken.isEmpty()) {
            call.reject("current push context is required");
            return;
        }

        Context appContext = getContext().getApplicationContext();
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String cachedToken = prefs.getString("fcmToken", "");
        if (FcmTokenConflictRecoveryPolicy.hasChangedToken(conflictedToken, cachedToken)
                && isExpectedPushContext(
                    prefs, expectedUserId, expectedFamilyId, expectedSessionNonce)) {
            call.resolve(new JSObject().put("status", "already_rotated").put("token", cachedToken));
            return;
        }

        synchronized (FCM_CONFLICT_RECOVERY_LOCK) {
            SessionTokenStore.ContextSnapshot current;
            String currentNonce;
            synchronized (SessionTokenStore.class) {
                current = SessionTokenStore.readContext(prefs);
                currentNonce = prefs.getString("sessionNonce", "");
            }
            String lastRotatedNonce = prefs.getString(LAST_FCM_CONFLICT_ROTATION_NONCE, "");
            if (!FcmTokenConflictRecoveryPolicy.canStart(
                    expectedUserId,
                    expectedFamilyId,
                    expectedSessionNonce,
                    current.userId,
                    current.familyId,
                    currentNonce,
                    lastRotatedNonce,
                    fcmConflictRecoveryInFlight)) {
                call.resolve(new JSObject().put("status", "not_rotated"));
                return;
            }
            fcmConflictRecoveryInFlight = true;
        }

        FirebaseMessaging.getInstance().deleteToken()
            .addOnSuccessListener(unused -> {
                // Firebase에서 폐기된 token을 다음 로그인에서 다시 채택하지 않게 즉시 제거한다.
                prefs.edit().remove("fcmToken").apply();
                if (!isExpectedPushContext(
                        prefs, expectedUserId, expectedFamilyId, expectedSessionNonce)) {
                    finishFcmConflictRecovery();
                    call.resolve(new JSObject().put("status", "stale_context"));
                    return;
                }
                FirebaseMessaging.getInstance().getToken()
                    .addOnSuccessListener(newToken -> {
                        String normalizedToken = newToken == null ? "" : newToken.trim();
                        if (normalizedToken.isEmpty()
                                || !isExpectedPushContext(
                                    prefs,
                                    expectedUserId,
                                    expectedFamilyId,
                                    expectedSessionNonce)) {
                            finishFcmConflictRecovery();
                            call.resolve(new JSObject().put("status", "stale_context"));
                            return;
                        }
                        prefs.edit()
                            .putString("fcmToken", normalizedToken)
                            .putString(LAST_FCM_CONFLICT_ROTATION_NONCE, expectedSessionNonce)
                            .apply();
                        finishFcmConflictRecovery();
                        NativePushTokenSync.sync(appContext, normalizedToken);
                        call.resolve(new JSObject().put("status", "rotated").put("token", normalizedToken));
                    })
                    .addOnFailureListener(error -> {
                        finishFcmConflictRecovery();
                        Log.w(TAG, "FCM conflict replacement token failed", error);
                        call.reject("Failed to replace FCM token");
                    });
            })
            .addOnFailureListener(error -> {
                finishFcmConflictRecovery();
                Log.w(TAG, "FCM conflict token delete failed", error);
                call.reject("Failed to delete conflicted FCM token");
            });
    }

    private static boolean isExpectedPushContext(
        SharedPreferences prefs,
        String expectedUserId,
        String expectedFamilyId,
        String expectedSessionNonce
    ) {
        synchronized (SessionTokenStore.class) {
            SessionTokenStore.ContextSnapshot current = SessionTokenStore.readContext(prefs);
            return NativePushTokenSync.isSameRegistrationContext(
                expectedUserId,
                expectedFamilyId,
                expectedSessionNonce,
                current.userId,
                current.familyId,
                prefs.getString("sessionNonce", "")
            );
        }
    }

    private static void finishFcmConflictRecovery() {
        synchronized (FCM_CONFLICT_RECOVERY_LOCK) {
            fcmConflictRecoveryInFlight = false;
        }
    }

    @PluginMethod
    public void setPushContext(PluginCall call) {
        String userId = call.getString("userId");
        String familyId = call.getString("familyId");
        String role = call.getString("role", "");
        String supabaseUrl = call.getString("supabaseUrl");
        String supabaseKey = call.getString("supabaseKey");
        String accessToken = call.getString("accessToken", "");
        String refreshToken = call.getString("refreshToken", "");
        String sessionNonce = call.getString("sessionNonce", "");

        if (userId == null || familyId == null || supabaseUrl == null || supabaseKey == null) {
            call.reject("userId, familyId, supabaseUrl, supabaseKey are required");
            return;
        }

        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        SessionTokenStore.ContextSnapshot context;
        synchronized (SessionTokenStore.class) {
            SessionTokenStore.ContextSnapshot stored = SessionTokenStore.readContext(prefs);
            context = SessionTokenStore.reconcileContext(
                prefs,
                accessToken,
                refreshToken,
                false,
                sessionNonce,
                userId,
                familyId,
                role,
                supabaseUrl,
                supabaseKey,
                stored.serviceEnabled,
                stored.locationIntervalMode
            );
        }
        if (!context.acceptedIncoming) {
            Log.w(TAG, "Ignored stale WebView push context; keeping newer native session");
            syncCachedFcmToken();
            call.resolve(new JSObject().put("status", "ignored_stale"));
            return;
        }

        Log.i(TAG, "Push context saved for user=" + userId + ", family=" + familyId);
        syncCachedFcmToken();
        call.resolve(new JSObject().put("status", "saved"));
    }

    @PluginMethod
    public void getPushContext(PluginCall call) {
        android.content.SharedPreferences prefs = getContext()
            .getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE);
        SessionTokenStore.ContextSnapshot context = SessionTokenStore.readContext(prefs);
        JSObject result = new JSObject();
        result.put("userId", context.userId);
        result.put("familyId", context.familyId);
        result.put("role", context.role);
        result.put("deviceInstallId", getOrCreateDeviceInstallId(prefs));
        result.put("hasAccessToken", !context.accessToken.isEmpty());
        result.put("hasRefreshToken", !context.refreshToken.isEmpty());
        result.put("hasFcmToken", !prefs.getString("fcmToken", "").isEmpty());
        call.resolve(result);
    }

    private String getOrCreateDeviceInstallId(android.content.SharedPreferences prefs) {
        String existing = prefs.getString(DEVICE_INSTALL_ID, "");
        if (existing != null && !existing.trim().isEmpty()) return existing.trim();
        String next = java.util.UUID.randomUUID().toString();
        prefs.edit().putString(DEVICE_INSTALL_ID, next).apply();
        return next;
    }

    @PluginMethod
    public void clearPushContext(PluginCall call) {
        SharedPreferences prefs = getContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        AmbientListenService.stopForRetiringSession(
            getContext(),
            prefs.getString("sessionNonce", "")
        );
        SessionTokenStore.clear(prefs, "");
        Log.i(TAG, "Push context cleared");
        call.resolve(new JSObject().put("status", "cleared"));
    }

    private void syncCachedFcmToken() {
        String cached = getContext()
            .getSharedPreferences("hyeni_location_prefs", android.content.Context.MODE_PRIVATE)
            .getString("fcmToken", null);

        if (cached != null && !cached.isEmpty()) {
            NativePushTokenSync.sync(getContext(), cached);
            return;
        }

        FirebaseMessaging.getInstance().getToken()
            .addOnSuccessListener(token -> {
                getContext()
                    .getSharedPreferences("hyeni_location_prefs", android.content.Context.MODE_PRIVATE)
                    .edit()
                    .putString("fcmToken", token)
                    .apply();
                NativePushTokenSync.sync(getContext(), token);
            })
            .addOnFailureListener(e -> Log.w(TAG, "FCM token sync deferred: " + e.getMessage()));
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        boolean enabled = getContext()
            .getSharedPreferences("hyeni_location_prefs", android.content.Context.MODE_PRIVATE)
            .getBoolean("serviceEnabled", false);
        call.resolve(new JSObject().put("running", enabled));
    }

    @PluginMethod
    public void checkBackgroundLocationPermission(PluginCall call) {
        boolean fineGranted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        boolean backgroundGranted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            backgroundGranted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
        }
        JSObject result = new JSObject();
        result.put("fineLocation", fineGranted);
        result.put("backgroundLocation", backgroundGranted);
        // 시스템 위치 서비스(설정 토글) 상태도 함께 보고한다. 권한이 살아 있어도 이 토글이
        // 꺼지면 위치 추적이 불가능하므로, 프론트는 이 값으로 '위치 꺼짐'을 판정한다.
        result.put("locationServicesEnabled", isSystemLocationEnabled());
        call.resolve(result);
    }

    // 기기의 시스템 위치 서비스(Settings > 위치)가 켜져 있는지. API 28+ 는 표준 API,
    // 그 이하(minSdk 24~27)는 GPS/네트워크 프로바이더 활성 여부로 판단한다.
    // 알 수 없는 예외 상황에선 true(켜짐)로 본다 — 오탐으로 거짓 '위치 꺼짐' 안내를 막는다.
    private boolean isSystemLocationEnabled() {
        try {
            LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return lm.isLocationEnabled();
            }
            return lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
                    || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception e) {
            Log.w(TAG, "isSystemLocationEnabled failed: " + e.getMessage());
            return true;
        }
    }

    @PluginMethod
    public void openAppLocationSettings(PluginCall call) {
        if (openAppDetailsSettings()) {
            call.resolve(new JSObject().put("status", "opened"));
        } else {
            call.reject("Cannot open settings");
        }
    }

    // 시스템 위치 서비스 설정 화면(위치 ON/OFF 토글)을 연다. 권한이 아니라 시스템 위치
    // 토글이 꺼졌을 때 안내 배너/칩에서 호출한다.
    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("status", "opened"));
        } catch (Exception e) {
            Log.w(TAG, "openLocationSettings failed: " + e.getMessage());
            call.reject("Cannot open location settings");
        }
    }

    // ── '항상 허용' 위치 권한 — OS 표준 2단계 흐름 ─────────────────────────────
    // Android 11+ 정책: foreground 와 background 를 한 요청에 섞으면 OS 가 요청을
    // 통째로 무시한다. 그래서:
    //   1) fine/coarse 미허용 → '사용 중 허용' 시스템 다이얼로그
    //   2) background 단독 요청 → OS 가 '항상 허용' 라디오가 바로 보이는 이 앱의
    //      위치 권한 화면을 직접 연다 (Android 10 은 다이얼로그에 옵션 포함)
    // 영구 거부 상태에선 OS 가 화면 없이 즉시 거부하므로(콜백이 수백 ms 내 도착
    // + rationale=false) 앱 정보 화면으로 폴백해 사용자가 길을 잃지 않게 한다.
    private long alwaysOnBackgroundRequestedAt = 0L;

    @PluginMethod
    public void requestForegroundLocation(PluginCall call) {
        boolean fineGranted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        if (fineGranted) {
            call.resolve(new JSObject().put("granted", true).put("step", "foregroundComplete"));
            return;
        }
        requestPermissionForAliases(
                new String[]{ "location", "coarseLocation" },
                call,
                "onForegroundOnlyResult"
        );
    }

    @PermissionCallback
    private void onForegroundOnlyResult(PluginCall call) {
        boolean fineGranted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        call.resolve(new JSObject()
                .put("granted", fineGranted)
                .put("step", fineGranted ? "foregroundComplete" : "foregroundDenied"));
    }

    @PluginMethod
    public void requestBackgroundLocation(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            boolean fineGranted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
            call.resolve(new JSObject()
                    .put("granted", fineGranted)
                    .put("step", fineGranted ? "complete" : "foregroundRequired"));
            return;
        }
        boolean fineGranted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        if (!fineGranted) {
            call.resolve(new JSObject().put("granted", false).put("step", "foregroundRequired"));
            return;
        }
        boolean backgroundGranted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        if (backgroundGranted) {
            call.resolve(new JSObject().put("granted", true).put("step", "complete"));
            return;
        }
        requestBackgroundAlwaysOn(call);
    }

    @PluginMethod
    public void requestAlwaysOnLocation(PluginCall call) {
        boolean fineGranted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // Android 9 이하 — background 권한 분리 없음. fine 이면 곧 '항상'.
            if (fineGranted) {
                call.resolve(new JSObject().put("granted", true).put("step", "complete"));
            } else {
                requestPermissionForAliases(new String[]{ "location", "coarseLocation" }, call, "onAlwaysOnForegroundResult");
            }
            return;
        }
        boolean backgroundGranted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        if (backgroundGranted) {
            call.resolve(new JSObject().put("granted", true).put("step", "complete"));
            return;
        }
        if (!fineGranted) {
            requestPermissionForAliases(new String[]{ "location", "coarseLocation" }, call, "onAlwaysOnForegroundResult");
            return;
        }
        requestBackgroundAlwaysOn(call);
    }

    private void requestBackgroundAlwaysOn(PluginCall call) {
        alwaysOnBackgroundRequestedAt = android.os.SystemClock.elapsedRealtime();
        requestPermissionForAlias("backgroundLocation", call, "onAlwaysOnBackgroundResult");
    }

    @PermissionCallback
    private void onAlwaysOnForegroundResult(PluginCall call) {
        boolean fineGranted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        if (!fineGranted) {
            call.resolve(new JSObject().put("granted", false).put("step", "foregroundDenied"));
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.resolve(new JSObject().put("granted", true).put("step", "complete"));
            return;
        }
        requestBackgroundAlwaysOn(call);
    }

    @PermissionCallback
    private void onAlwaysOnBackgroundResult(PluginCall call) {
        boolean granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            call.resolve(new JSObject().put("granted", true).put("step", "complete"));
            return;
        }
        long elapsed = android.os.SystemClock.elapsedRealtime() - alwaysOnBackgroundRequestedAt;
        boolean canAskAgain = ActivityCompat.shouldShowRequestPermissionRationale(
                getActivity(), Manifest.permission.ACCESS_BACKGROUND_LOCATION);
        if (elapsed < 700 && !canAskAgain) {
            // 영구 거부 — OS 가 설정 화면도 띄우지 않고 즉시 거부했다.
            if (openAppDetailsSettings()) {
                call.resolve(new JSObject().put("granted", false).put("step", "fallbackAppDetails"));
                return;
            }
        }
        call.resolve(new JSObject().put("granted", false).put("step", "backgroundDenied"));
    }

    private boolean openAppDetailsSettings() {
        try {
            Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(android.net.Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "Cannot open app details settings: " + e.getMessage());
            return false;
        }
    }
}
