package com.hyeni.calendar;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Collections;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

final class NativePushTokenSync {
    private static final String TAG = "NativePushTokenSync";
    private static final String PREFS_NAME = "hyeni_location_prefs";
    private static final String LAST_SYNC_KEY = "last_fcm_token_sync_key";
    private static final String LAST_SYNC_AT_MS = "last_fcm_token_sync_at_ms";
    private static final long MIN_SYNC_INTERVAL_MS = 30 * 60_000L;
    private static final MediaType JSON = MediaType.get("application/json");
    private static final OkHttpClient HTTP_CLIENT = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .protocols(Collections.singletonList(Protocol.HTTP_1_1))
        .build();

    private NativePushTokenSync() {}

    static void sync(Context context, String token) {
        if (context == null || isBlank(token)) return;

        Context appContext = context.getApplicationContext();
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String userId = prefs.getString("userId", "");
        String familyId = prefs.getString("familyId", "");
        String supabaseUrl = prefs.getString("supabaseUrl", "");
        String supabaseKey = prefs.getString("supabaseKey", "");
        String accessToken = prefs.getString("accessToken", "");

        if (isBlank(userId) || isBlank(familyId) || isBlank(supabaseUrl) || isBlank(supabaseKey)) {
            Log.w(TAG, "FCM token sync skipped: push context missing");
            return;
        }

        String syncKey = userId + ":" + familyId + ":" + token;
        long now = System.currentTimeMillis();
        String lastKey = prefs.getString(LAST_SYNC_KEY, "");
        long lastAt = prefs.getLong(LAST_SYNC_AT_MS, 0L);
        if (syncKey.equals(lastKey) && now - lastAt < MIN_SYNC_INTERVAL_MS) {
            return;
        }

        new Thread(() -> {
            boolean ok = false;
            try {
                String bearer = !isBlank(accessToken) ? accessToken : supabaseKey;
                ok = syncViaRpc(supabaseUrl, supabaseKey, bearer, userId, familyId, token);
                if (!ok && !supabaseKey.equals(bearer)) {
                    ok = syncViaRpc(supabaseUrl, supabaseKey, supabaseKey, userId, familyId, token);
                }
                if (!ok) {
                    ok = syncViaTable(supabaseUrl, supabaseKey, bearer, userId, familyId, token);
                }
            } catch (Exception error) {
                Log.e(TAG, "FCM token sync error", error);
            }

            if (ok) {
                prefs.edit()
                    .putString(LAST_SYNC_KEY, syncKey)
                    .putLong(LAST_SYNC_AT_MS, System.currentTimeMillis())
                    .apply();
                Log.i(TAG, "FCM token synced to Supabase");
            }
        }, "hyeni-fcm-token-sync").start();
    }

    private static boolean syncViaRpc(
        String supabaseUrl,
        String supabaseKey,
        String bearer,
        String userId,
        String familyId,
        String token
    ) throws Exception {
        JSONObject body = new JSONObject();
        body.put("p_user_id", userId);
        body.put("p_family_id", familyId);
        body.put("p_fcm_token", token);
        body.put("p_platform", "android");

        Request request = new Request.Builder()
            .url(supabaseUrl + "/rest/v1/rpc/upsert_fcm_token")
            .header("apikey", supabaseKey)
            .header("Authorization", "Bearer " + (!isBlank(bearer) ? bearer : supabaseKey))
            .header("Content-Type", "application/json")
            .post(RequestBody.create(body.toString(), JSON))
            .build();

        try (Response response = HTTP_CLIENT.newCall(request).execute()) {
            if (response.isSuccessful()) return true;
            String errBody = response.body() != null ? response.body().string() : "";
            Log.w(TAG, "FCM token RPC sync failed: " + response.code() + " / " + errBody);
            return false;
        }
    }

    private static boolean syncViaTable(
        String supabaseUrl,
        String supabaseKey,
        String bearer,
        String userId,
        String familyId,
        String token
    ) throws Exception {
        JSONObject body = new JSONObject();
        body.put("user_id", userId);
        body.put("family_id", familyId);
        body.put("fcm_token", token);
        body.put("platform", "android");
        body.put("updated_at", formatIsoUtc(new Date()));

        Request request = new Request.Builder()
            .url(supabaseUrl + "/rest/v1/fcm_tokens?on_conflict=user_id,fcm_token")
            .header("apikey", supabaseKey)
            .header("Authorization", "Bearer " + (!isBlank(bearer) ? bearer : supabaseKey))
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates,return=minimal")
            .post(RequestBody.create(body.toString(), JSON))
            .build();

        try (Response response = HTTP_CLIENT.newCall(request).execute()) {
            if (response.isSuccessful()) return true;
            String errBody = response.body() != null ? response.body().string() : "";
            Log.w(TAG, "FCM token table sync failed: " + response.code() + " / " + errBody);
            return false;
        }
    }

    private static String formatIsoUtc(Date date) {
        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        return iso.format(date);
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
