package com.hyeni.calendar;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

// Phase 0-A: 시스템 종료(ACTION_SHUTDOWN) 직전, LocationService 가 영속화한
// 마지막 좌표를 읽어 Supabase 에 final upload 를 시도한다.
//
// ACTION_SHUTDOWN 은 일반 BroadcastReceiver 에 수 초 단위 짧은 윈도우만 허용하므로
// 동기 HTTP POST + 2s 타임아웃 으로 fire-and-forget. 실패해도 무시.
public class ShutdownReceiver extends BroadcastReceiver {

    private static final String TAG = "ShutdownReceiver";
    private static final String PREFS_NAME = "hyeni_location_prefs";
    private static final String LAST_LAT = "last_uploaded_lat";
    private static final String LAST_LNG = "last_uploaded_lng";
    private static final String LAST_AT_MS = "last_uploaded_at_ms";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (!Intent.ACTION_SHUTDOWN.equals(action)
                && !"android.intent.action.QUICKBOOT_POWEROFF".equals(action)) {
            return;
        }

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
                .connectTimeout(2, TimeUnit.SECONDS)
                .readTimeout(2, TimeUnit.SECONDS)
                .writeTimeout(2, TimeUnit.SECONDS)
                .build();

        // 1) 전원 종료 마커(최우선) — 종료 직전 ~2초 윈도우 안에 끝나야 하므로 단일 빠른
        //    RPC 만 호출한다. 부모 "기기 전원을 껐어요" 알림은 이 마커를 본 staleness cron
        //    (*/3분)이 안정적으로 발송한다(종료 윈도우 + edge 콜드스타트에 의존하던 기존
        //    직접 푸시는 자주 실패해서 제거 — 2026-06-10 전원종료 통보 안정화). 위치 캐시가
        //    없어도 마커는 남긴다.
        try {
            JSONObject marker = new JSONObject();
            marker.put("p_family_id", familyId);
            marker.put("p_child_user_id", userId);
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
