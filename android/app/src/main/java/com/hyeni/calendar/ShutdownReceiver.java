package com.hyeni.calendar;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.BatteryManager;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

// Phase 0-A: 시스템 종료(ACTION_SHUTDOWN) 직전, LocationService 가 영속화한
// 마지막 좌표를 읽어 Supabase 에 final upload 를 시도한다.
//
// ACTION_SHUTDOWN 은 일반 BroadcastReceiver 에 짧은 윈도우만 허용한다. 이 신호는
// 네트워크·OEM 종료 순서에 따라 실패할 수 있는 best-effort 보조 신호이며, 부모의
// 위치 끊김 판정은 서버 staleness cron을 정본으로 유지한다.
public class ShutdownReceiver extends BroadcastReceiver {

    private static final String TAG = "ShutdownReceiver";
    private static final String PREFS_NAME = "hyeni_location_prefs";
    private static final String LAST_LAT = "last_uploaded_lat";
    private static final String LAST_LNG = "last_uploaded_lng";
    private static final String LAST_AT_MS = "last_uploaded_at_ms";
    private static final long SHUTDOWN_CALL_TIMEOUT_MS = 1_200L;
    private static final ThreadPoolExecutor SHUTDOWN_EXECUTOR = new ThreadPoolExecutor(
            1,
            1,
            0L,
            TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(1),
            runnable -> {
                Thread thread = new Thread(runnable, "hyeni-shutdown-delivery");
                thread.setDaemon(true);
                return thread;
            },
            new ThreadPoolExecutor.AbortPolicy()
    );

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (!Intent.ACTION_SHUTDOWN.equals(action)
                && !"android.intent.action.QUICKBOOT_POWEROFF".equals(action)) {
            return;
        }

        PendingResult pendingResult = goAsync();
        Context appContext = context.getApplicationContext();
        if (appContext == null) appContext = context;
        Context deliveryContext = appContext;
        try {
            SHUTDOWN_EXECUTOR.execute(() -> {
                try {
                    deliverShutdownBestEffort(deliveryContext);
                } finally {
                    pendingResult.finish();
                }
            });
        } catch (RuntimeException rejected) {
            Log.w(TAG, "shutdown delivery skipped: executor busy", rejected);
            pendingResult.finish();
        }
    }

    /** 종료 직전 짧은 창에서도 즉시 읽히는 배터리 잔량(0~100). 읽지 못하면 -1. */
    static int readBatteryPercent(Context context) {
        try {
            BatteryManager manager = (BatteryManager) context.getSystemService(Context.BATTERY_SERVICE);
            if (manager == null) return -1;
            int capacity = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            return capacity >= 0 && capacity <= 100 ? capacity : -1;
        } catch (RuntimeException error) {
            return -1;
        }
    }

    private static void deliverShutdownBestEffort(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean enabled = prefs.getBoolean("serviceEnabled", false);
        String userId = prefs.getString("userId", null);
        String familyId = prefs.getString("familyId", null);
        String supabaseUrl = prefs.getString("supabaseUrl", null);
        String supabaseKey = prefs.getString("supabaseKey", null);
        String accessToken = prefs.getString("accessToken", null);
        String latStr = prefs.getString(LAST_LAT, null);
        String lngStr = prefs.getString(LAST_LNG, null);
        long capturedAtMs = prefs.getLong(LAST_AT_MS, 0L);

        if (!enabled || userId == null || familyId == null || familyId.isEmpty()
                || supabaseUrl == null || supabaseKey == null) {
            Log.i(TAG, "shutdown skipped: missing context");
            return;
        }

        final String bearer = (accessToken != null && !accessToken.isEmpty()) ? accessToken : supabaseKey;
        final OkHttpClient client = new OkHttpClient.Builder()
                .callTimeout(SHUTDOWN_CALL_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                .connectTimeout(700, TimeUnit.MILLISECONDS)
                .readTimeout(900, TimeUnit.MILLISECONDS)
                .writeTimeout(700, TimeUnit.MILLISECONDS)
                .build();

        // 1) 전원 종료 마커(최우선) — 종료 직전 네트워크가 살아 있을 때만 성공하는
        //    best-effort 힌트다. 위치 캐시가 없어도 먼저 시도하고, 실패 시 서버의 위치
        //    끊김 판정이 그대로 동작한다.
        try {
            JSONObject marker = new JSONObject();
            marker.put("p_family_id", familyId);
            marker.put("p_child_user_id", userId);
            // 꺼질 때 배터리 — 부모가 "배터리가 다 돼서 꺼졌어요 / 전원을 껐어요"를 구분한다(2026-09-26).
            int batteryPercent = readBatteryPercent(context);
            if (batteryPercent >= 0) marker.put("p_battery_level", batteryPercent);
            Request markerReq = new Request.Builder()
                    .url(supabaseUrl + "/rest/v1/rpc/record_child_shutdown")
                    .header("apikey", supabaseKey)
                    .header("Authorization", "Bearer " + bearer)
                    .header("Content-Type", "application/json")
                    .post(RequestBody.create(marker.toString(), MediaType.get("application/json")))
                    .build();
            try (Response res = client.newCall(markerReq).execute()) {
                Log.i(TAG, "shutdown marker result=" + res.code());
            }
        } catch (Exception markerErr) {
            Log.w(TAG, "shutdown marker failed", markerErr);
        }

        // 2) 마지막 좌표 final upload(보조) — 캐시된 위치가 있을 때만 best-effort.
        if (latStr != null && lngStr != null && capturedAtMs > 0) {
            try {
                double lat = Double.parseDouble(latStr);
                double lng = Double.parseDouble(lngStr);
                JSONObject body = new JSONObject();
                body.put("user_id", userId);
                body.put("latitude", lat);
                body.put("longitude", lng);
                body.put("captured_at", formatIsoUtc(capturedAtMs));
                body.put("source", "shutdown");
                body.put("is_final_before_shutdown", true);
                Request req = new Request.Builder()
                        .url(supabaseUrl + "/rest/v1/locations")
                        .header("apikey", supabaseKey)
                        .header("Authorization", "Bearer " + bearer)
                        .header("Content-Type", "application/json")
                        .header("Prefer", "resolution=merge-duplicates")
                        .post(RequestBody.create(body.toString(), MediaType.get("application/json")))
                        .build();
                try (Response res = client.newCall(req).execute()) {
                    Log.i(TAG, "shutdown final upload result=" + res.code());
                }
            } catch (Exception e) {
                Log.w(TAG, "shutdown final upload failed", e);
            }
        }
    }

    private static String formatIsoUtc(long timeMs) {
        SimpleDateFormat iso = new SimpleDateFormat(
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        return iso.format(new Date(timeMs));
    }
}
