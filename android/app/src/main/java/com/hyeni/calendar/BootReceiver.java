package com.hyeni.calendar;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "BootReceiver";
    public static final String ACTION_RESTART_LOCATION_SERVICE = "com.hyeni.calendar.action.RESTART_LOCATION_SERVICE";
    // Doze-bypass 위치 heartbeat alarm (staleness reliability Phase 2). AlarmManager
    // 가 이 액션으로 깨우면 LocationService 를 ACTION_HEARTBEAT_FIX 로 기동해 단발 fix.
    public static final String ACTION_HEARTBEAT_FIX = "com.hyeni.calendar.action.HEARTBEAT_FIX";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                || Intent.ACTION_USER_UNLOCKED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)
                || ACTION_RESTART_LOCATION_SERVICE.equals(action)
                || ACTION_HEARTBEAT_FIX.equals(action)) {
            // ── Direct-boot 가드 (2026-06-10 실기기 확정 버그 수정) ──────────────
            // 이 리시버는 directBootAware=true 라 LOCKED_BOOT_COMPLETED(잠금 해제 전)
            // 에도 호출된다. 그 시점엔 credential-encrypted(CE) SharedPreferences 가
            // 아직 잠겨 있어 getSharedPreferences("hyeni_location_prefs") 가
            // IllegalStateException 을 던져 리시버가 통째로 크래시한다. 실측(모토로라
            // razr, dropbox 22:25:14): 재부팅마다 BootReceiver 크래시 → 위치 서비스
            // 자동 재시작 실패 → 앱을 수동으로 열기 전까지 위치 깜깜(브리프 재부팅이
            // 몇 시간짜리 위치 공백으로 증폭). 잠금 해제 전이면 CE 데이터(userId 등)
            // 로 서비스를 의미있게 시작할 수도 없으므로, 여기선 조용히 반환하고
            // 잠금 해제 후 다시 오는 USER_UNLOCKED / BOOT_COMPLETED 에서 처리한다.
            try {
                android.os.UserManager um =
                    (android.os.UserManager) context.getSystemService(Context.USER_SERVICE);
                if (um != null && !um.isUserUnlocked()) {
                    Log.i(TAG, "Direct boot (user locked) — deferring restart to USER_UNLOCKED, action=" + action);
                    return;
                }
            } catch (Exception e) {
                Log.w(TAG, "isUserUnlocked check failed: " + e.getMessage());
            }
            // 재부팅/패키지 교체 후 예약 알림(AlarmManager) 복구 — 알람은 부팅 시 전부 소실됨.
            // 내부 keepalive(RESTART)·heartbeat 에서는 불필요하므로 제외.
            if (!ACTION_RESTART_LOCATION_SERVICE.equals(action) && !ACTION_HEARTBEAT_FIX.equals(action)) {
                try {
                    NotificationScheduleManager.restoreAll(context);
                } catch (Exception e) {
                    Log.w(TAG, "Failed to restore scheduled notifications: " + e.getMessage());
                }
            }

            SharedPreferences prefs = context.getSharedPreferences("hyeni_location_prefs", Context.MODE_PRIVATE);
            boolean enabled = prefs.getBoolean("serviceEnabled", false);
            String userId = prefs.getString("userId", null);
            String accessToken = prefs.getString("accessToken", "");
            String refreshToken = prefs.getString("refreshToken", "");
            boolean hasAuthToken =
                    (accessToken != null && !accessToken.isEmpty()) ||
                    (refreshToken != null && !refreshToken.isEmpty());

            if (enabled && userId != null && !hasAuthToken) {
                Log.w(TAG, "Location service restart skipped: auth token missing");
                prefs.edit().putBoolean("serviceEnabled", false).apply();
                return;
            }

            if (enabled && userId != null) {
                // 위치 권한 체크 후 서비스 재시작 (권한 없으면 크래시 방지)
                if (androidx.core.content.ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION)
                        != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    Log.w(TAG, "Location permission not granted, skipping service restart");
                    return;
                }
                Log.i(TAG, "Restart trigger received (" + action + "), restarting location service");
                try {
                    Intent serviceIntent = new Intent(context, LocationService.class);
                    // heartbeat alarm 이면 ACTION_HEARTBEAT_FIX 로 기동 → onStartCommand 가
                    // 단발 fix 를 강제하고 다음 heartbeat 를 재예약한다.
                    if (ACTION_HEARTBEAT_FIX.equals(action)) {
                        serviceIntent.setAction(LocationService.ACTION_HEARTBEAT_FIX);
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(serviceIntent);
                    } else {
                        context.startService(serviceIntent);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Failed to restart service: " + e.getMessage());
                }
            }
        }
    }
}
