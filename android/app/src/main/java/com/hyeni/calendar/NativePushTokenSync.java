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
    private static final Object REFRESH_LOCK = new Object();
    private static final OkHttpClient HTTP_CLIENT = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .protocols(Collections.singletonList(Protocol.HTTP_1_1))
        .build();

    private static final class HttpResult {
        final boolean successful;
        final int statusCode;

        HttpResult(boolean successful, int statusCode) {
            this.successful = successful;
            this.statusCode = statusCode;
        }
    }

    private NativePushTokenSync() {}

    static void sync(Context context, String token) {
        if (context == null || isBlank(token)) return;

        Context appContext = context.getApplicationContext();
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        SessionTokenStore.ContextSnapshot session;
        String registrationInstanceId;
        synchronized (SessionTokenStore.class) {
            session = SessionTokenStore.readContext(prefs);
            registrationInstanceId = clean(prefs.getString("sessionNonce", ""));
        }
        String userId = session.userId;
        String familyId = session.familyId;
        String supabaseUrl = session.supabaseUrl;
        String supabaseKey = session.supabaseKey;
        String accessToken = session.accessToken;
        String refreshToken = session.refreshToken;
        String role = session.role;

        if (isBlank(userId) || isBlank(familyId) || isBlank(role) || isBlank(supabaseUrl)
                || isBlank(supabaseKey) || isBlank(registrationInstanceId)) {
            Log.w(TAG, "FCM token sync skipped: push context missing");
            return;
        }

        String syncKey = userId + ":" + familyId + ":" + registrationInstanceId + ":" + token;
        long now = System.currentTimeMillis();
        String lastKey = prefs.getString(LAST_SYNC_KEY, "");
        long lastAt = prefs.getLong(LAST_SYNC_AT_MS, 0L);
        if (syncKey.equals(lastKey) && now - lastAt < MIN_SYNC_INTERVAL_MS) {
            return;
        }

        new Thread(() -> {
            boolean ok = false;
            try {
                if (!isCurrentRegistrationContext(prefs, userId, familyId, registrationInstanceId)) return;
                boolean refreshRetryUsed = false;
                String bearer = accessToken;
                if (isBlank(bearer) && !isBlank(refreshToken)) {
                    refreshRetryUsed = true;
                    bearer = networkRefreshAccessToken(
                        prefs,
                        userId,
                        familyId,
                        role,
                        registrationInstanceId,
                        accessToken
                    );
                }
                if (isBlank(bearer)
                        || !isCurrentRegistrationContext(prefs, userId, familyId, registrationInstanceId)) {
                    return;
                }

                HttpResult result = syncViaRpc(
                    supabaseUrl, supabaseKey, bearer, userId, familyId, token, registrationInstanceId
                );
                if (isRefreshRetryEligible(result.statusCode, refreshRetryUsed, refreshToken)) {
                    refreshRetryUsed = true;
                    String refreshedAccess = networkRefreshAccessToken(
                        prefs,
                        userId,
                        familyId,
                        role,
                        registrationInstanceId,
                        bearer
                    );
                    if (!isBlank(refreshedAccess)
                            && isCurrentRegistrationContext(prefs, userId, familyId, registrationInstanceId)) {
                        bearer = refreshedAccess;
                        result = syncViaRpc(
                            supabaseUrl,
                            supabaseKey,
                            bearer,
                            userId,
                            familyId,
                            token,
                            registrationInstanceId
                        );
                    }
                }
                ok = result.successful;

                // RPC route가 없는 구환경만 generic table 경로로 폴백한다. 인증 실패나
                // ownership 충돌을 다른 경로로 우회하지 않는다.
                if (!ok && result.statusCode != 401 && result.statusCode != 403
                        && result.statusCode != 409
                        && isCurrentRegistrationContext(prefs, userId, familyId, registrationInstanceId)) {
                    HttpResult tableResult = syncViaTable(
                        supabaseUrl, supabaseKey, bearer, userId, familyId, token, registrationInstanceId
                    );
                    if (isRefreshRetryEligible(tableResult.statusCode, refreshRetryUsed, refreshToken)) {
                        refreshRetryUsed = true;
                        String refreshedAccess = networkRefreshAccessToken(
                            prefs,
                            userId,
                            familyId,
                            role,
                            registrationInstanceId,
                            bearer
                        );
                        if (!isBlank(refreshedAccess)
                                && isCurrentRegistrationContext(prefs, userId, familyId, registrationInstanceId)) {
                            tableResult = syncViaTable(
                                supabaseUrl,
                                supabaseKey,
                                refreshedAccess,
                                userId,
                                familyId,
                                token,
                                registrationInstanceId
                            );
                        }
                    }
                    ok = tableResult.successful;
                }
            } catch (Exception error) {
                Log.e(TAG, "FCM token sync error", error);
            }

            if (ok && isCurrentRegistrationContext(prefs, userId, familyId, registrationInstanceId)) {
                prefs.edit()
                    .putString(LAST_SYNC_KEY, syncKey)
                    .putLong(LAST_SYNC_AT_MS, System.currentTimeMillis())
                    .apply();
                Log.i(TAG, "FCM token synced to Supabase");
            }
        }, "hyeni-fcm-token-sync").start();
    }

    private static HttpResult syncViaRpc(
        String supabaseUrl,
        String supabaseKey,
        String bearer,
        String userId,
        String familyId,
        String token,
        String registrationInstanceId
    ) throws Exception {
        JSONObject body = new JSONObject();
        body.put("p_user_id", userId);
        body.put("p_family_id", familyId);
        body.put("p_fcm_token", token);
        body.put("p_platform", "android");
        body.put("p_registration_instance_id", registrationInstanceId);

        Request request = new Request.Builder()
            .url(supabaseUrl + "/rest/v1/rpc/upsert_fcm_token")
            .header("apikey", supabaseKey)
            .header("Authorization", "Bearer " + (!isBlank(bearer) ? bearer : supabaseKey))
            .header("Content-Type", "application/json")
            .post(RequestBody.create(body.toString(), JSON))
            .build();

        try (Response response = HTTP_CLIENT.newCall(request).execute()) {
            int statusCode = response.code();
            if (response.isSuccessful()) return new HttpResult(true, statusCode);
            Log.w(TAG, "FCM token RPC sync failed: HTTP " + statusCode);
            return new HttpResult(false, statusCode);
        }
    }

    private static HttpResult syncViaTable(
        String supabaseUrl,
        String supabaseKey,
        String bearer,
        String userId,
        String familyId,
        String token,
        String registrationInstanceId
    ) throws Exception {
        JSONObject body = new JSONObject();
        body.put("user_id", userId);
        body.put("family_id", familyId);
        body.put("fcm_token", token);
        body.put("platform", "android");
        body.put("registration_instance_id", registrationInstanceId);
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
            int statusCode = response.code();
            if (response.isSuccessful()) return new HttpResult(true, statusCode);
            Log.w(TAG, "FCM token table sync failed: HTTP " + statusCode);
            return new HttpResult(false, statusCode);
        }
    }

    private static String networkRefreshAccessToken(
        SharedPreferences prefs,
        String capturedUserId,
        String capturedFamilyId,
        String capturedRole,
        String capturedRegistrationInstanceId,
        String failedAccessToken
    ) {
        synchronized (REFRESH_LOCK) {
            SessionTokenStore.ContextSnapshot current;
            String currentNonce;
            synchronized (SessionTokenStore.class) {
                current = SessionTokenStore.readContext(prefs);
                currentNonce = clean(prefs.getString("sessionNonce", ""));
            }
            if (!isSameRegistrationContext(
                    capturedUserId,
                    capturedFamilyId,
                    capturedRegistrationInstanceId,
                    current.userId,
                    current.familyId,
                    currentNonce)
                    || !clean(capturedRole).equalsIgnoreCase(clean(current.role))) {
                return null;
            }
            if (!isBlank(current.accessToken)
                    && !clean(current.accessToken).equals(clean(failedAccessToken))) {
                return current.accessToken;
            }
            if (isBlank(current.refreshToken) || isBlank(current.supabaseUrl)) return null;

            final long refreshGeneration = SessionTokenStore.generation();
            final String refreshUsed = current.refreshToken;
            try {
                JSONObject body = new JSONObject().put("refresh_token", refreshUsed);
                String deviceInstallId = clean(prefs.getString("deviceInstallId", ""));
                if (!deviceInstallId.isEmpty()) body.put("device_install_id", deviceInstallId);

                String refreshUrl = current.supabaseUrl.replaceAll("/+$", "") + "/auth/refresh";
                String responseBody;
                int statusCode;
                Request request = new Request.Builder()
                    .url(refreshUrl)
                    .header("Content-Type", "application/json")
                    .post(RequestBody.create(body.toString(), JSON))
                    .build();
                try (Response response = HTTP_CLIENT.newCall(request).execute()) {
                    statusCode = response.code();
                    responseBody = response.body() != null ? response.body().string() : "";
                }

                SessionTokenStore.ContextSnapshot afterRequest;
                String afterNonce;
                synchronized (SessionTokenStore.class) {
                    afterRequest = SessionTokenStore.readContext(prefs);
                    afterNonce = clean(prefs.getString("sessionNonce", ""));
                }
                if (!isSameRegistrationContext(
                        capturedUserId,
                        capturedFamilyId,
                        capturedRegistrationInstanceId,
                        afterRequest.userId,
                        afterRequest.familyId,
                        afterNonce)
                        || !clean(capturedRole).equalsIgnoreCase(clean(afterRequest.role))) {
                    return null;
                }
                if (!isBlank(afterRequest.accessToken)
                        && !clean(afterRequest.accessToken).equals(clean(failedAccessToken))) {
                    return afterRequest.accessToken;
                }
                if (!refreshUsed.equals(afterRequest.refreshToken)) return null;
                if (statusCode < 200 || statusCode >= 300) {
                    Log.w(TAG, "FCM registration token refresh failed: HTTP " + statusCode);
                    return null;
                }

                JSONObject refreshedSession = new JSONObject(responseBody).optJSONObject("session");
                if (refreshedSession == null) return null;
                String newAccess = clean(refreshedSession.optString("access_token", ""));
                String newRefresh = clean(refreshedSession.optString("refresh_token", ""));
                if (newAccess.isEmpty()) return null;

                synchronized (SessionTokenStore.class) {
                    SessionTokenStore.ContextSnapshot beforeCommit = SessionTokenStore.readContext(prefs);
                    String beforeCommitNonce = clean(prefs.getString("sessionNonce", ""));
                    if (!isSameRefreshContext(
                            current.userId,
                            current.familyId,
                            current.role,
                            capturedRegistrationInstanceId,
                            refreshUsed,
                            beforeCommit.userId,
                            beforeCommit.familyId,
                            beforeCommit.role,
                            beforeCommitNonce,
                            beforeCommit.refreshToken)) {
                        return !isBlank(beforeCommit.accessToken)
                            && !clean(beforeCommit.accessToken).equals(clean(failedAccessToken))
                            ? beforeCommit.accessToken
                            : null;
                    }
                    SessionTokenStore.Snapshot saved = SessionTokenStore.reconcileIfGeneration(
                        prefs,
                        newAccess,
                        newRefresh,
                        true,
                        refreshGeneration,
                        current.userId,
                        current.familyId,
                        current.role
                    );
                    return saved != null ? saved.accessToken : null;
                }
            } catch (Exception error) {
                Log.w(TAG, "FCM registration token refresh error", error);
                return null;
            }
        }
    }

    static boolean isRefreshRetryEligible(
        int statusCode,
        boolean refreshRetryUsed,
        String refreshToken
    ) {
        return statusCode == 401 && !refreshRetryUsed && !isBlank(refreshToken);
    }

    static boolean isSameRefreshContext(
        String capturedUserId,
        String capturedFamilyId,
        String capturedRole,
        String capturedRegistrationInstanceId,
        String capturedRefreshToken,
        String currentUserId,
        String currentFamilyId,
        String currentRole,
        String currentRegistrationInstanceId,
        String currentRefreshToken
    ) {
        return isSameRegistrationContext(
            capturedUserId,
            capturedFamilyId,
            capturedRegistrationInstanceId,
            currentUserId,
            currentFamilyId,
            currentRegistrationInstanceId
        )
            && !clean(capturedRole).isEmpty()
            && clean(capturedRole).equalsIgnoreCase(clean(currentRole))
            && !clean(capturedRefreshToken).isEmpty()
            && clean(capturedRefreshToken).equals(clean(currentRefreshToken));
    }

    private static String formatIsoUtc(Date date) {
        SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        return iso.format(date);
    }

    private static boolean isCurrentRegistrationContext(
        SharedPreferences prefs,
        String capturedUserId,
        String capturedFamilyId,
        String capturedRegistrationInstanceId
    ) {
        synchronized (SessionTokenStore.class) {
            SessionTokenStore.ContextSnapshot current = SessionTokenStore.readContext(prefs);
            return isSameRegistrationContext(
                capturedUserId,
                capturedFamilyId,
                capturedRegistrationInstanceId,
                current.userId,
                current.familyId,
                prefs.getString("sessionNonce", "")
            );
        }
    }

    static boolean isSameRegistrationContext(
        String capturedUserId,
        String capturedFamilyId,
        String capturedRegistrationInstanceId,
        String currentUserId,
        String currentFamilyId,
        String currentRegistrationInstanceId
    ) {
        String nonce = clean(capturedRegistrationInstanceId);
        return !nonce.isEmpty()
            && clean(capturedUserId).equals(clean(currentUserId))
            && clean(capturedFamilyId).equals(clean(currentFamilyId))
            && nonce.equals(clean(currentRegistrationInstanceId));
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
