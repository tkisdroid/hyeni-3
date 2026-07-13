package com.hyeni.calendar;

import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/** 메모 알림을 표시하기 직전에 현재 가족 관계와 차단 상태를 서버에서 다시 확인한다. */
final class MemoDisplayAuthorizationClient {

    private static final int MAX_PERMIT_LENGTH = 3_072;
    private static final int REQUEST_TIMEOUT_MILLIS = 5_000;
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final OkHttpClient HTTP = newHttpClient();

    private MemoDisplayAuthorizationClient() {}

    static OkHttpClient newHttpClient() {
        return new OkHttpClient.Builder()
            .connectTimeout(REQUEST_TIMEOUT_MILLIS, TimeUnit.MILLISECONDS)
            .readTimeout(REQUEST_TIMEOUT_MILLIS, TimeUnit.MILLISECONDS)
            .writeTimeout(REQUEST_TIMEOUT_MILLIS, TimeUnit.MILLISECONDS)
            .callTimeout(REQUEST_TIMEOUT_MILLIS, TimeUnit.MILLISECONDS)
            .build();
    }

    static boolean authorize(
            SessionTokenStore.ContextSnapshot context,
            String permit
    ) {
        return context != null && authorize(HTTP, context.supabaseUrl, permit);
    }

    static boolean authorize(
            OkHttpClient httpClient,
            String backendUrl,
            String permit
    ) {
        String cleanBackendUrl = clean(backendUrl);
        String cleanPermit = clean(permit);
        if (httpClient == null
                || cleanBackendUrl.isEmpty()
                || cleanPermit.isEmpty()
                || cleanPermit.length() > MAX_PERMIT_LENGTH) {
            return false;
        }

        try {
            HttpUrl baseUrl = HttpUrl.get(cleanBackendUrl);
            if (!"https".equals(baseUrl.scheme())
                    || !baseUrl.username().isEmpty()
                    || !baseUrl.password().isEmpty()
                    || baseUrl.query() != null
                    || baseUrl.fragment() != null) {
                return false;
            }
            HttpUrl endpoint = baseUrl.newBuilder()
                .addPathSegments("api/push-notify/memo-display-authorize")
                .build();
            JSONObject payload = new JSONObject().put("permit", cleanPermit);
            Request request = new Request.Builder()
                .url(endpoint)
                .header("Content-Type", "application/json")
                .post(RequestBody.create(payload.toString(), JSON))
                .build();

            try (Response response = httpClient.newCall(request).execute()) {
                if (!response.isSuccessful()) return false;
                ResponseBody responseBody = response.body();
                if (responseBody == null) return false;
                JSONObject result = new JSONObject(responseBody.string());
                if (result.length() != 1 || !result.has("allowed")) return false;
                Object allowed = result.opt("allowed");
                return allowed instanceof Boolean && (Boolean) allowed;
            }
        } catch (Exception ignored) {
            return false;
        }
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
