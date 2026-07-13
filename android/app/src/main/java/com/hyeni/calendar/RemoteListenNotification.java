package com.hyeni.calendar;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/** 원격청취 요청을 아이 동의 화면으로 연결하는 일반 high-priority 알림. */
final class RemoteListenNotification {

    private static final String TAG = "RemoteListenNotification";
    private static final String PREFS_NAME = "hyeni_location_prefs";

    static final String EXTRA_RECEIVED_AT_MS = "remoteListenReceivedAtMs";
    static final String EXTRA_REQUESTED_AT_MS = "remoteListenRequestedAtMs";
    static final String EXTRA_EXPIRES_AT_MS = "remoteListenExpiresAtMs";
    static final String EXTRA_SESSION_NONCE = "remoteListenSessionNonce";
    static final String EXTRA_LAUNCHER_NOTIFICATION_ID = "launcherNotificationId";

    enum Result {
        POSTED(true),
        DUPLICATE(true),
        EXPIRED(true),
        INVALID(false),
        TARGET_MISMATCH(false),
        NOTIFICATIONS_BLOCKED(false),
        POST_FAILED(false);

        private final boolean shouldAcknowledge;

        Result(boolean shouldAcknowledge) {
            this.shouldAcknowledge = shouldAcknowledge;
        }

        boolean shouldAcknowledge() {
            return shouldAcknowledge;
        }
    }

    static final class Request {
        final String requestId;
        final String familyId;
        final String targetUserId;
        final String senderUserId;
        final String requestedAt;
        final String expiresAt;
        final int durationSec;

        Request(
                @Nullable String requestId,
                @Nullable String familyId,
                @Nullable String targetUserId,
                @Nullable String senderUserId,
                @Nullable String requestedAt,
                @Nullable String expiresAt,
                int durationSec
        ) {
            this.requestId = clean(requestId);
            this.familyId = clean(familyId);
            this.targetUserId = clean(targetUserId);
            this.senderUserId = clean(senderUserId);
            this.requestedAt = clean(requestedAt);
            this.expiresAt = clean(expiresAt);
            this.durationSec = RemoteListenRequestPolicy.normalizeDurationSec(durationSec);
        }
    }

    private RemoteListenNotification() {}

    static synchronized Result show(Context context, Request request) {
        if (context == null || request == null
                || request.requestId.isEmpty()
                || request.familyId.isEmpty()
                || request.targetUserId.isEmpty()) {
            Log.w(TAG, "Remote listen consent notification rejected: required target data missing");
            return Result.INVALID;
        }
        if (RemoteListenRequestStore.isKnown(context, request.requestId)) {
            return Result.DUPLICATE;
        }

        long receivedAtMs = System.currentTimeMillis();
        long requestedAtMs = RemoteListenRequestPolicy.parseTimestampMs(request.requestedAt);
        long explicitExpiresAtMs = RemoteListenRequestPolicy.parseTimestampMs(request.expiresAt);
        if (requestedAtMs <= 0L || explicitExpiresAtMs <= 0L) {
            Log.w(TAG, "Remote listen consent request rejected: expiry metadata missing");
            return Result.INVALID;
        }
        long effectiveExpiresAtMs = RemoteListenRequestPolicy.effectiveExpiresAt(
            receivedAtMs,
            requestedAtMs,
            explicitExpiresAtMs
        );
        if (!RemoteListenRequestPolicy.isFresh(
                receivedAtMs,
                receivedAtMs,
                requestedAtMs,
                explicitExpiresAtMs)) {
            Log.i(TAG, "Remote listen consent request expired before display");
            return Result.EXPIRED;
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        SessionTokenStore.ContextSnapshot current = SessionTokenStore.readContext(prefs);
        String sessionNonce = prefs.getString("sessionNonce", "");
        if (sessionNonce.trim().isEmpty()
                || !"child".equalsIgnoreCase(current.role)
                || !RemoteListenRequestPolicy.matchesContext(
                    request.familyId,
                    request.targetUserId,
                    sessionNonce,
                    current.familyId,
                    current.userId,
                    sessionNonce)) {
            Log.w(TAG, "Remote listen consent notification rejected: target context mismatch");
            return Result.TARGET_MISMATCH;
        }

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return Result.POST_FAILED;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
            return Result.NOTIFICATIONS_BLOCKED;
        }
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            return Result.NOTIFICATIONS_BLOCKED;
        }
        NotificationHelper.ensureRemoteListenConsentChannel(context);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = manager.getNotificationChannel(
                NotificationHelper.CHANNEL_REMOTE_LISTEN
            );
            if (channel == null || channel.getImportance() == NotificationManager.IMPORTANCE_NONE) {
                return Result.NOTIFICATIONS_BLOCKED;
            }
        }

        int notificationId = NotificationHelper.stableRequestCode(
            "remote_listen:" + request.requestId
        );
        Intent launchIntent = new Intent(context, RemoteListenActivity.class);
        launchIntent.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
        );
        launchIntent.putExtra("familyId", request.familyId);
        launchIntent.putExtra("targetUserId", request.targetUserId);
        launchIntent.putExtra("senderUserId", request.senderUserId);
        launchIntent.putExtra("durationSec", request.durationSec);
        launchIntent.putExtra("requestId", request.requestId);
        launchIntent.putExtra(EXTRA_RECEIVED_AT_MS, receivedAtMs);
        launchIntent.putExtra(EXTRA_REQUESTED_AT_MS, requestedAtMs);
        launchIntent.putExtra(EXTRA_EXPIRES_AT_MS, explicitExpiresAtMs);
        launchIntent.putExtra(EXTRA_SESSION_NONCE, sessionNonce);
        launchIntent.putExtra(EXTRA_LAUNCHER_NOTIFICATION_ID, notificationId);

        PendingIntent consentIntent = PendingIntent.getActivity(
            context,
            notificationId,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        long timeoutMs = Math.max(1L, effectiveExpiresAtMs - receivedAtMs);
        Notification notification = new NotificationCompat.Builder(
            context,
            NotificationHelper.CHANNEL_REMOTE_LISTEN
        )
            .setSmallIcon(R.drawable.ic_hyeni_notification)
            .setLargeIcon(NotificationHelper.largeIcon(context))
            .setColor(ContextCompat.getColor(context, R.color.notification_accent))
            .setContentTitle("부모님이 주변 소리 듣기를 요청했어")
            .setContentText("60초 안에 눌러서 허용하거나 거절해 줘.")
            .setStyle(new NotificationCompat.BigTextStyle().bigText(
                "부모님이 1분 동안 주변 소리를 듣고 싶어 해. 알림을 눌러 직접 정해 줘."
            ))
            .setAutoCancel(true)
            .setContentIntent(consentIntent)
            .addAction(0, "확인하기", consentIntent)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(Notification.DEFAULT_ALL)
            .setWhen(receivedAtMs)
            .setTimeoutAfter(timeoutMs)
            .build();

        try {
            manager.notify(notificationId, notification);
            boolean stored = RemoteListenRequestStore.markNotificationShown(
                context,
                request.requestId,
                receivedAtMs,
                requestedAtMs,
                explicitExpiresAtMs,
                request.familyId,
                request.targetUserId,
                sessionNonce
            );
            if (!stored) {
                manager.cancel(notificationId);
                return RemoteListenRequestStore.isKnown(context, request.requestId)
                    ? Result.DUPLICATE
                    : Result.POST_FAILED;
            }
            return Result.POSTED;
        } catch (RuntimeException error) {
            Log.w(TAG, "Remote listen consent notification post failed", error);
            return Result.POST_FAILED;
        }
    }

    static void cancel(Context context, int notificationId) {
        if (context == null || notificationId <= 0) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(notificationId);
    }

    private static String clean(@Nullable String value) {
        return value == null ? "" : value.trim();
    }
}
