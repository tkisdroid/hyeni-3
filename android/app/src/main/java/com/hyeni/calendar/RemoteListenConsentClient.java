package com.hyeni.calendar;

import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONObject;

import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/** 아이의 원격청취 동의를 서버에 확정하고 캡처 동안 유효한 access JWT를 보장한다. */
final class RemoteListenConsentClient {

    private static final String TAG = "RemoteListenConsent";
    private static final String SESSION_NONCE_KEY = "sessionNonce";
    private static final long MAX_CAPTURE_MS = 60_000L;
    /** 캡처 60초 + consent/마지막 청크 네트워크 정산 여유. */
    static final long CAPTURE_AUTH_SAFETY_MS = 75_000L;
    private static final Object REFRESH_LOCK = new Object();
    private static final ExecutorService AUTH_EXECUTOR = Executors.newSingleThreadExecutor();
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .callTimeout(12, TimeUnit.SECONDS)
        .build();

    interface ResultCallback {
        void onResult(Result result);
    }

    static final class Operation {
        private final AtomicBoolean cancelled = new AtomicBoolean(false);
        private volatile Call activeCall;

        void cancel() {
            cancelled.set(true);
            Call call = activeCall;
            if (call != null) call.cancel();
        }

        private boolean isCancelled() {
            return cancelled.get();
        }

        private void attach(Call call) {
            activeCall = call;
            if (cancelled.get() && call != null) call.cancel();
        }
    }

    static final class Result {
        private final boolean success;
        private final long captureExpiresAtMs;

        private Result(boolean success, long captureExpiresAtMs) {
            this.success = success;
            this.captureExpiresAtMs = captureExpiresAtMs;
        }

        boolean isSuccess() {
            return success;
        }

        long getCaptureExpiresAtMs() {
            return captureExpiresAtMs;
        }
    }

    private static final class HttpResult {
        final int statusCode;
        final String body;

        HttpResult(int statusCode, String body) {
            this.statusCode = statusCode;
            this.body = body == null ? "" : body;
        }
    }

    private RemoteListenConsentClient() {}

    static Operation confirm(
            SharedPreferences prefs,
            String requestId,
            ResultCallback callback
    ) {
        Operation operation = new Operation();
        String cleanRequestId = clean(requestId);
        if (prefs == null || cleanRequestId.isEmpty() || callback == null) {
            if (callback != null) callback.onResult(failure());
            return operation;
        }
        AUTH_EXECUTOR.execute(() -> runConfirm(
            prefs,
            cleanRequestId,
            callback,
            operation
        ));
        return operation;
    }

    private static void runConfirm(
            SharedPreferences prefs,
            String requestId,
            ResultCallback callback,
            Operation operation
    ) {
        SessionTokenStore.ContextSnapshot expected = SessionTokenStore.readContext(prefs);
        String expectedSessionNonce = clean(prefs.getString(SESSION_NONCE_KEY, ""));
        if (!validChildContext(expected, expectedSessionNonce)) {
            deliver(operation, callback, failure());
            return;
        }

        String token = expected.accessToken;
        boolean refreshAttempted = false;
        if (requiresRefreshForCapture(token, System.currentTimeMillis())) {
            token = refreshAccessToken(
                prefs,
                expected,
                expectedSessionNonce,
                token
            );
            refreshAttempted = true;
            if (clean(token).isEmpty()
                    || requiresRefreshForCapture(token, System.currentTimeMillis())) {
                deliver(operation, callback, failure());
                return;
            }
        }

        HttpResult response = executeConsent(
            operation,
            expected.supabaseUrl,
            token,
            requestId
        );
        if (shouldRetryAfterUnauthorized(response.statusCode, refreshAttempted)) {
            String refreshed = refreshAccessToken(
                prefs,
                expected,
                expectedSessionNonce,
                token
            );
            refreshAttempted = true;
            if (!clean(refreshed).isEmpty()) {
                response = executeConsent(
                    operation,
                    expected.supabaseUrl,
                    refreshed,
                    requestId
                );
            }
        }
        deliver(operation, callback, parseResponse(response.statusCode, response.body));
    }

    private static HttpResult executeConsent(
            Operation operation,
            String backendUrl,
            String accessToken,
            String requestId
    ) {
        if (operation.isCancelled()) return new HttpResult(0, "");
        final HttpUrl endpoint;
        try {
            endpoint = HttpUrl.get(clean(backendUrl)).newBuilder()
                .addPathSegments("api/remote-listen/sessions")
                .addPathSegment(clean(requestId))
                .addPathSegment("consent")
                .build();
        } catch (IllegalArgumentException error) {
            return new HttpResult(0, "");
        }

        Request request = new Request.Builder()
            .url(endpoint)
            .header("Authorization", "Bearer " + clean(accessToken))
            .header("Content-Type", "application/json")
            .post(RequestBody.create("{}", JSON))
            .build();
        Call call = HTTP.newCall(request);
        operation.attach(call);
        try (Response response = call.execute()) {
            String body = response.body() != null ? response.body().string() : "";
            return new HttpResult(response.code(), body);
        } catch (IOException error) {
            return new HttpResult(0, "");
        }
    }

    static String refreshAccessToken(
            SharedPreferences prefs,
            SessionTokenStore.ContextSnapshot expected,
            String expectedSessionNonce,
            String failedAccessToken
    ) {
        if (prefs == null || expected == null) return null;
        synchronized (REFRESH_LOCK) {
            SessionTokenStore.ContextSnapshot current = SessionTokenStore.readContext(prefs);
            String currentNonce = clean(prefs.getString(SESSION_NONCE_KEY, ""));
            if (!sameSession(expected, expectedSessionNonce, current, currentNonce)) return null;
            if (!clean(current.accessToken).isEmpty()
                    && !current.accessToken.equals(clean(failedAccessToken))) {
                return current.accessToken;
            }
            if (clean(current.refreshToken).isEmpty() || clean(current.supabaseUrl).isEmpty()) {
                return null;
            }

            long generation = SessionTokenStore.generation();
            String refreshUsed = current.refreshToken;
            try {
                JSONObject body = new JSONObject().put("refresh_token", refreshUsed);
                String deviceInstallId = clean(prefs.getString("deviceInstallId", ""));
                if (!deviceInstallId.isEmpty()) body.put("device_install_id", deviceInstallId);
                Request request = new Request.Builder()
                    .url(clean(current.supabaseUrl).replaceAll("/+$", "") + "/auth/refresh")
                    .header("Content-Type", "application/json")
                    .post(RequestBody.create(body.toString(), JSON))
                    .build();
                try (Response response = HTTP.newCall(request).execute()) {
                    int statusCode = response.code();
                    String responseBody = response.body() != null ? response.body().string() : "";

                    SessionTokenStore.ContextSnapshot afterRequest = SessionTokenStore.readContext(prefs);
                    String afterNonce = clean(prefs.getString(SESSION_NONCE_KEY, ""));
                    if (!sameSession(expected, expectedSessionNonce, afterRequest, afterNonce)) {
                        return null;
                    }
                    if (!clean(afterRequest.accessToken).isEmpty()
                            && !afterRequest.accessToken.equals(current.accessToken)) {
                        return afterRequest.accessToken;
                    }
                    if (statusCode < 200 || statusCode >= 300) {
                        Log.w(TAG, "원격청취 세션 토큰 갱신 실패: HTTP " + statusCode);
                        return null;
                    }

                    JSONObject session = new JSONObject(responseBody).optJSONObject("session");
                    if (session == null) return null;
                    String newAccess = clean(session.optString("access_token", ""));
                    String newRefresh = clean(session.optString("refresh_token", ""));
                    if (newAccess.isEmpty()) return null;
                    synchronized (SessionTokenStore.class) {
                        SessionTokenStore.ContextSnapshot beforeCommit =
                            SessionTokenStore.readContext(prefs);
                        String beforeNonce = clean(prefs.getString(SESSION_NONCE_KEY, ""));
                        if (!sameSession(expected, expectedSessionNonce, beforeCommit, beforeNonce)
                                || !refreshUsed.equals(beforeCommit.refreshToken)) {
                            return !clean(beforeCommit.accessToken).isEmpty()
                                ? beforeCommit.accessToken
                                : null;
                        }
                        SessionTokenStore.Snapshot saved = SessionTokenStore.reconcileIfGeneration(
                            prefs,
                            newAccess,
                            newRefresh,
                            true,
                            generation,
                            expected.userId,
                            expected.familyId,
                            expected.role
                        );
                        if (saved == null
                                || !expectedSessionNonce.equals(clean(
                                    prefs.getString(SESSION_NONCE_KEY, "")
                                ))) {
                            return null;
                        }
                        return saved.accessToken;
                    }
                }
            } catch (Exception error) {
                Log.w(TAG, "원격청취 세션 토큰 갱신 오류", error);
                return null;
            }
        }
    }

    static boolean shouldRetryAfterUnauthorized(int statusCode, boolean refreshAttempted) {
        return statusCode == 401 && !refreshAttempted;
    }

    static boolean requiresRefreshForCapture(String accessToken, long nowMs) {
        long expiresAtMs = SessionTokenFreshness.accessTokenExpiresAtMs(clean(accessToken));
        if (expiresAtMs <= 0L || nowMs <= 0L) return true;
        return expiresAtMs - nowMs < CAPTURE_AUTH_SAFETY_MS;
    }

    static boolean matchesRefreshSession(
            String expectedUserId,
            String expectedFamilyId,
            String expectedRole,
            String expectedSessionNonce,
            String actualUserId,
            String actualFamilyId,
            String actualRole,
            String actualSessionNonce
    ) {
        return !clean(expectedUserId).isEmpty()
            && !clean(expectedFamilyId).isEmpty()
            && !clean(expectedRole).isEmpty()
            && !clean(expectedSessionNonce).isEmpty()
            && clean(expectedUserId).equals(clean(actualUserId))
            && clean(expectedFamilyId).equals(clean(actualFamilyId))
            && clean(expectedRole).equalsIgnoreCase(clean(actualRole))
            && clean(expectedSessionNonce).equals(clean(actualSessionNonce));
    }

    private static boolean sameSession(
            SessionTokenStore.ContextSnapshot expected,
            String expectedNonce,
            SessionTokenStore.ContextSnapshot actual,
            String actualNonce
    ) {
        return matchesRefreshSession(
            expected.userId,
            expected.familyId,
            expected.role,
            expectedNonce,
            actual.userId,
            actual.familyId,
            actual.role,
            actualNonce
        );
    }

    private static boolean validChildContext(
            SessionTokenStore.ContextSnapshot context,
            String sessionNonce
    ) {
        return context != null
            && "child".equalsIgnoreCase(clean(context.role))
            && !clean(context.userId).isEmpty()
            && !clean(context.familyId).isEmpty()
            && !clean(context.supabaseUrl).isEmpty()
            && !clean(context.accessToken).isEmpty()
            && !clean(sessionNonce).isEmpty();
    }

    static Result parseResponse(int statusCode, String body) {
        if (statusCode < 200 || statusCode >= 300) return failure();
        try {
            long expiresAtMs = new JSONObject(body).optLong("capture_expires_at_ms", 0L);
            if (expiresAtMs <= 0L) return failure();
            return new Result(true, expiresAtMs);
        } catch (Exception error) {
            return failure();
        }
    }

    static long captureDeadlineMs(long nowMs, long serverExpiresAtMs) {
        if (nowMs <= 0L || serverExpiresAtMs <= nowMs) return 0L;
        long localMax = nowMs > Long.MAX_VALUE - MAX_CAPTURE_MS
            ? Long.MAX_VALUE
            : nowMs + MAX_CAPTURE_MS;
        return Math.min(localMax, serverExpiresAtMs);
    }

    private static void deliver(
            Operation operation,
            ResultCallback callback,
            Result result
    ) {
        if (!operation.isCancelled()) callback.onResult(result);
    }

    private static Result failure() {
        return new Result(false, 0L);
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
