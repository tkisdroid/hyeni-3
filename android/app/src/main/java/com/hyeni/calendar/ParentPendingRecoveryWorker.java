package com.hyeni.calendar;

import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/** 잠금 해제 직후 부모 기기에 남은 서버 pending 알림을 인증 조회해 한 번 복구한다. */
public final class ParentPendingRecoveryWorker extends Worker {
    private static final String TAG = "ParentPendingRecovery";
    private static final String PREFS_NAME = "hyeni_location_prefs";
    private static final String WORK_NAME = "hyeni-parent-pending-unlock-recovery";
    private static final Object REFRESH_LOCK = new Object();
    private static final MediaType JSON = MediaType.get("application/json");

    private final Context appContext;
    private final OkHttpClient httpClient;

    public ParentPendingRecoveryWorker(
        @NonNull Context context,
        @NonNull WorkerParameters workerParams
    ) {
        super(context, workerParams);
        appContext = context.getApplicationContext();
        httpClient = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .build();
    }

    public static void enqueue(Context context) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(ParentPendingRecoveryWorker.class)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build();
        WorkManager.getInstance(context.getApplicationContext())
            .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, request);
    }

    @NonNull
    @Override
    public Result doWork() {
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        SessionTokenStore.ContextSnapshot context = SessionTokenStore.readContext(prefs);
        if (!PendingRecoveryPolicy.shouldRun(
            context.role,
            context.userId,
            context.familyId,
            context.supabaseUrl,
            context.supabaseKey,
            context.accessToken,
            context.refreshToken
        )) {
            return Result.success();
        }

        try {
            String bearer = context.accessToken;
            if (isBlank(bearer)) {
                bearer = networkRefreshAccessToken(prefs, context);
                if (isBlank(bearer)) return retryWithLimit();
                context = SessionTokenStore.readContext(prefs);
            }

            Response pendingResponse = executePendingRequest(context, bearer);
            int code = pendingResponse.code();
            if (code == 401 || code == 403) {
                pendingResponse.close();
                String refreshed = networkRefreshAccessToken(prefs, context);
                if (isBlank(refreshed)) return retryWithLimit();
                context = SessionTokenStore.readContext(prefs);
                pendingResponse = executePendingRequest(context, refreshed);
                code = pendingResponse.code();
            }
            if (!pendingResponse.isSuccessful()) {
                Log.w(TAG, "Pending recovery request failed: HTTP " + code);
                pendingResponse.close();
                return code >= 500 ? retryWithLimit() : Result.success();
            }

            String responseBody = pendingResponse.body() != null
                ? pendingResponse.body().string()
                : "[]";
            pendingResponse.close();
            JSONArray pending = new JSONArray(responseBody);
            JSONArray deliveredIds = displayPending(context, pending);
            if (deliveredIds.length() == 0) return Result.success();

            SessionTokenStore.ContextSnapshot latest = SessionTokenStore.readContext(prefs);
            if (!sameIdentity(context, latest)) return Result.success();
            String markBearer = latest.accessToken;
            if (isBlank(markBearer)) return retryWithLimit();
            if (markDelivered(latest, markBearer, deliveredIds)) return Result.success();

            String refreshed = networkRefreshAccessToken(prefs, latest);
            SessionTokenStore.ContextSnapshot refreshedContext = SessionTokenStore.readContext(prefs);
            if (!isBlank(refreshed)
                && sameIdentity(latest, refreshedContext)
                && markDelivered(refreshedContext, refreshed, deliveredIds)) {
                return Result.success();
            }
            return retryWithLimit();
        } catch (Exception error) {
            Log.w(TAG, "Parent pending recovery failed", error);
            return retryWithLimit();
        }
    }

    private Response executePendingRequest(
        SessionTokenStore.ContextSnapshot context,
        String bearer
    ) throws Exception {
        JSONObject body = new JSONObject()
            .put("p_family_id", context.familyId)
            .put("p_user_id", context.userId)
            .put("p_role", context.role);
        return httpClient.newCall(new Request.Builder()
            .url(baseUrl(context.supabaseUrl) + "/rest/v1/rpc/get_pending_notifications_for_device")
            .header("apikey", context.supabaseKey)
            .header("Authorization", "Bearer " + bearer)
            .header("Content-Type", "application/json")
            .post(RequestBody.create(body.toString(), JSON))
            .build()).execute();
    }

    private JSONArray displayPending(
        SessionTokenStore.ContextSnapshot context,
        JSONArray pending
    ) throws Exception {
        JSONArray deliveredIds = new JSONArray();
        for (int index = 0; index < pending.length(); index++) {
            JSONObject item = pending.optJSONObject(index);
            if (item == null) continue;
            String rowId = item.optString("id", "");
            if (isBlank(rowId)) continue;
            JSONObject data = item.optJSONObject("data");
            if (data == null) data = new JSONObject();
            Map<String, String> payload = stringPayload(data);
            if (!NotificationTargetPolicy.evaluate(
                payload,
                context.userId,
                context.familyId,
                context.role
            ).allowsDelivery()) {
                continue;
            }
            String sender = firstNonBlank(
                data.optString("senderUserId", ""),
                data.optString("sender_user_id", "")
            );
            if (context.userId.equals(sender)) continue;

            String type = firstNonBlank(
                data.optString("type", ""),
                data.optString("action", ""),
                "schedule"
            );
            // request_location 등 네이티브 제어 명령은 표시형 pending이 아니다.
            // 시스템 알림/로컬 ACK를 보기 전에 닫아야 같은 stableId가 우연히 있어도
            // 서버에서 delivered로 잘못 완료하지 않는다.
            if (!PendingNotificationTypePolicy.isDisplayNotification(type)) {
                continue;
            }

            String stableId = firstNonBlank(
                data.optString("pushId", ""),
                data.optString("idempotencyKey", ""),
                data.optString("idempotency_key", ""),
                data.optString("requestId", ""),
                rowId
            );
            if (isSystemNotificationPresent(stableId)) {
                PolledNotificationStore.markAck(appContext, stableId);
                deliveredIds.put(rowId);
                continue;
            }
            if (PolledNotificationStore.isAcked(appContext, stableId)) {
                deliveredIds.put(rowId);
                continue;
            }

            String alertType = firstNonBlank(
                data.optString("alertType", ""),
                data.optString("alert_type", "")
            );
            boolean urgent = NotificationUrgencyPolicy.isEmergency(
                type,
                data.optString("urgent", ""),
                data.optString("severity", ""),
                alertType
            );
            boolean fullScreen = urgent || "kkuk".equalsIgnoreCase(type);
            String channel = NotificationChannelPolicy.channelFor(type, alertType, urgent);
            NotificationHelper.DeliveryReceipt receipt = NotificationHelper.showNotification(
                appContext,
                item.optString("title", "혜니캘린더"),
                item.optString("body", ""),
                channel,
                fullScreen,
                fullScreen,
                NotificationHelper.stableRequestCode(stableId),
                data.optString("route", null),
                NotificationQuietHoursPolicy.NotificationIdentity.of(type, alertType)
            );
            if (receipt.shouldAcknowledge()) {
                PolledNotificationStore.markAck(appContext, stableId);
                deliveredIds.put(rowId);
            }
        }
        return deliveredIds;
    }

    private boolean markDelivered(
        SessionTokenStore.ContextSnapshot context,
        String bearer,
        JSONArray ids
    ) {
        try {
            JSONObject body = new JSONObject().put("p_ids", ids);
            Response response = httpClient.newCall(new Request.Builder()
                .url(baseUrl(context.supabaseUrl) + "/rest/v1/rpc/mark_notifications_delivered")
                .header("apikey", context.supabaseKey)
                .header("Authorization", "Bearer " + bearer)
                .header("Content-Type", "application/json")
                .post(RequestBody.create(body.toString(), JSON))
                .build()).execute();
            boolean successful = response.isSuccessful();
            if (!successful) Log.w(TAG, "Pending recovery ACK failed: HTTP " + response.code());
            response.close();
            return successful;
        } catch (Exception error) {
            Log.w(TAG, "Pending recovery ACK error", error);
            return false;
        }
    }

    private String networkRefreshAccessToken(
        SharedPreferences prefs,
        SessionTokenStore.ContextSnapshot expected
    ) {
        synchronized (REFRESH_LOCK) {
            SessionTokenStore.ContextSnapshot current = SessionTokenStore.readContext(prefs);
            if (!sameIdentity(expected, current)) return null;
            if (!isBlank(current.accessToken) && !current.accessToken.equals(expected.accessToken)) {
                return current.accessToken;
            }
            if (isBlank(current.refreshToken)) return null;

            long generation = SessionTokenStore.generation();
            String refreshUsed = current.refreshToken;
            try {
                JSONObject body = new JSONObject().put("refresh_token", refreshUsed);
                String deviceInstallId = prefs.getString("deviceInstallId", "");
                if (!isBlank(deviceInstallId)) body.put("device_install_id", deviceInstallId);
                Response response = httpClient.newCall(new Request.Builder()
                    .url(baseUrl(current.supabaseUrl) + "/auth/refresh")
                    .header("Content-Type", "application/json")
                    .post(RequestBody.create(body.toString(), JSON))
                    .build()).execute();
                int code = response.code();
                String responseBody = response.body() != null ? response.body().string() : "";
                response.close();

                SessionTokenStore.ContextSnapshot afterRequest = SessionTokenStore.readContext(prefs);
                if (!sameIdentity(current, afterRequest)) return null;
                if (!isBlank(afterRequest.accessToken)
                    && !afterRequest.accessToken.equals(current.accessToken)) {
                    return afterRequest.accessToken;
                }
                if (code < 200 || code >= 300) {
                    Log.w(TAG, "Parent token refresh failed: HTTP " + code);
                    return null;
                }

                JSONObject session = new JSONObject(responseBody).optJSONObject("session");
                if (session == null) return null;
                String newAccess = session.optString("access_token", "");
                String newRefresh = session.optString("refresh_token", "");
                if (isBlank(newAccess)) return null;
                synchronized (SessionTokenStore.class) {
                    SessionTokenStore.ContextSnapshot beforeCommit = SessionTokenStore.readContext(prefs);
                    if (!sameIdentity(current, beforeCommit)
                        || !refreshUsed.equals(beforeCommit.refreshToken)) {
                        return !isBlank(beforeCommit.accessToken) ? beforeCommit.accessToken : null;
                    }
                    SessionTokenStore.Snapshot saved = SessionTokenStore.reconcileIfGeneration(
                        prefs,
                        newAccess,
                        newRefresh,
                        true,
                        generation,
                        current.userId,
                        current.familyId,
                        current.role
                    );
                    return saved != null ? saved.accessToken : null;
                }
            } catch (Exception error) {
                Log.w(TAG, "Parent token refresh error", error);
                return null;
            }
        }
    }

    private Result retryWithLimit() {
        return getRunAttemptCount() < 5 ? Result.retry() : Result.failure();
    }

    private boolean isSystemNotificationPresent(String tag) {
        if (isBlank(tag)) return false;
        NotificationManager manager = appContext.getSystemService(NotificationManager.class);
        if (manager == null) return false;
        try {
            StatusBarNotification[] active = manager.getActiveNotifications();
            if (active == null) return false;
            for (StatusBarNotification notification : active) {
                if (notification != null && tag.equals(notification.getTag())) return true;
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Active notification check failed", error);
        }
        return false;
    }

    private static Map<String, String> stringPayload(JSONObject data) {
        Map<String, String> payload = new HashMap<>();
        Iterator<String> keys = data.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!data.isNull(key)) payload.put(key, data.optString(key, ""));
        }
        return payload;
    }

    private static boolean sameIdentity(
        SessionTokenStore.ContextSnapshot left,
        SessionTokenStore.ContextSnapshot right
    ) {
        return left != null
            && right != null
            && left.userId.equals(right.userId)
            && left.familyId.equals(right.familyId)
            && left.role.equalsIgnoreCase(right.role);
    }

    private static String firstNonBlank(String... values) {
        if (values == null) return "";
        for (String value : values) {
            if (!isBlank(value)) return value.trim();
        }
        return "";
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    private static String baseUrl(String value) {
        return value.replaceAll("/+$", "");
    }
}
