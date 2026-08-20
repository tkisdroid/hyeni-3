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

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import okhttp3.OkHttpClient;

/**
 * Handles FCM push messages delivered by Google's push infrastructure.
 * Works even when the app process is completely dead — Android starts this
 * service automatically when an FCM message arrives.
 */
public class MyFirebaseMessagingService extends FirebaseMessagingService {

    private static final String TAG = "FCMService";
    private static final String PREFS_NAME = "hyeni_location_prefs";
    private static final String ALERT_CHANNEL_ID = NotificationHelper.CHANNEL_EMERGENCY;
    private static final String SCHEDULE_CHANNEL_ID = NotificationHelper.CHANNEL_SCHEDULE;
    private static final AtomicInteger notifId = new AtomicInteger(5000);
    private static final OkHttpClient HTTP_CLIENT = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build();

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        Log.i(TAG, "FCM token refreshed");
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        prefs.edit().putString("fcmToken", token).apply();
        NativePushTokenSync.sync(this, token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        Log.i(TAG, "FCM message received from: " + remoteMessage.getFrom());

        Map<String, String> data = remoteMessage.getData();

        SharedPreferences targetPrefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        SessionTokenStore.ContextSnapshot targetContext = SessionTokenStore.readContext(targetPrefs);
        NotificationTargetPolicy.Decision targetDecision = NotificationTargetPolicy.evaluate(
            data,
            targetContext.userId,
            targetContext.familyId,
            targetContext.role
        );
        if (!targetDecision.allowsDelivery()) {
            Log.w(TAG, "FCM payload rejected by target policy: " + targetDecision.name());
            return;
        }

        String action = data.get("action");
        String messageType = data.get("type");
        if ("notification_quiet_hours_updated".equals(action)
                || "notification_quiet_hours_updated".equals(messageType)) {
            handleNotificationQuietHoursUpdate(data, targetPrefs, targetContext);
            // 유효·무효·stale 모두 control command다. 일반 표시/ACK로 절대 흘리지 않는다.
            return;
        }
        if ("force_ring".equals(action)) {
            String eventId = firstNonBlank(data.get("event_id"), data.get("eventId"));
            if (ForceRingRequestStore.wasStoppedRecently(this, eventId)) {
                Log.i(TAG, "force_ring ignored because event was already stopped: event_id=" + eventId);
                cancelForceRingNotification();
                return;
            }
            if (ForceRingRequestStore.wasLauncherRecentlyShown(this, eventId)) {
                Log.i(TAG, "force_ring deduped for event_id=" + eventId);
                return;
            }
            ForceRingRequestStore.markLauncherShown(this, eventId);

            // Android 14+ (UDC, sdk 34) restricts FGS start from background FCM
            // context (specialUse FGS has no implicit grace window). Post a
            // high-importance fullScreenIntent notification on the alarm channel
            // instead — the system launches ForceRingActivity, which then
            // starts ForceRingService for sound/vibration in foreground context.
            // Pre-UDC keeps the direct FGS start (works on those API levels).
            String parentRole = data.get("parent_role");
            String childName = data.get("child_name");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                postForceRingFullScreenNotification(eventId,
                        data.get("message"), data.get("initiator_name"),
                        parentRole, childName);
            } else {
                Intent svc = new Intent(this, ForceRingService.class);
                svc.putExtra(ForceRingService.EXTRA_EVENT_ID, eventId);
                svc.putExtra(ForceRingService.EXTRA_MESSAGE, data.get("message"));
                svc.putExtra(ForceRingService.EXTRA_INITIATOR, data.get("initiator_name"));
                svc.putExtra(ForceRingService.EXTRA_PARENT_ROLE, parentRole);
                svc.putExtra(ForceRingService.EXTRA_CHILD_NAME, childName);
                ContextCompat.startForegroundService(this, svc);
            }
            return;
        }

        if ("force_ring_stop".equals(action)) {
            // Defense in depth: only honor stop pushes that match the
            // currently-ringing event_id. The Edge Function authorizes the
            // stop server-side (initiator_user_id check), but a stale or
            // spoofed FCM should not silence a different alarm.
            String stopEventId = firstNonBlank(data.get("event_id"), data.get("eventId"));
            ForceRingRequestStore.markStopped(this, stopEventId);
            String activeEventId = ForceRingService.getActiveEventId();
            if (activeEventId != null && !isBlank(stopEventId)
                    && !activeEventId.equals(stopEventId)) {
                Log.w(TAG, "force_ring_stop ignored: event_id mismatch "
                        + "(active=" + activeEventId + ", stop=" + stopEventId + ")");
                return;
            }
            cancelForceRingNotification();
            stopService(new Intent(this, ForceRingService.class));
            sendBroadcast(new Intent("com.hyeni.calendar.FORCE_RING_STOP")
                    .setPackage(getPackageName()));
            // NTV-H7: drop the launcher dedup marker so the parent can
            // re-ring this event immediately after stopping it.
            ForceRingRequestStore.clearLauncherShown(this, stopEventId);
            return;
        }

        String title = data.get("title");
        String body = data.get("body");
        String type = messageType;

        // Fallback to notification payload if data payload is empty
        if (title == null && remoteMessage.getNotification() != null) {
            title = remoteMessage.getNotification().getTitle();
            body = remoteMessage.getNotification().getBody();
        }

        if (title == null) title = "혜니캘린더";
        if (body == null) body = "";

        String stableId = firstNonBlank(
            data.get("pushId"),
            data.get("idempotencyKey"),
            data.get("idempotency_key"),
            data.get("requestId"),
            type + ":" + title + ":" + body
        );

        // Skip if this notification was sent by me
        String senderUserId = data.get("senderUserId");
        if (senderUserId != null && !senderUserId.isEmpty()) {
            if (senderUserId.equals(targetContext.userId)) {
                Log.i(TAG, "Skipping self-notification for: " + type);
                return;
            }
        }

        if ("request_location".equals(type)) {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            if (PolledNotificationStore.isAcked(this, stableId)) {
                Log.i(TAG, "Skipping duplicate location refresh command: " + stableId);
                return;
            }
            if (!shouldHandleChildCommand(prefs)) {
                Log.i(TAG, "Location refresh skipped: this device is not child mode");
                return;
            }
            if (!isTargetedToThisUser(prefs, data, "Location refresh")) {
                return;
            }
            if (startLocationRefreshService(data, stableId)) {
                // ACK는 LocationService가 fresh fix의 서버 upsert 2xx를 확인한 뒤 기록한다.
                // 단순 FGS handoff 성공은 측위/업로드 성공이 아니므로 여기서는 완료하지 않는다.
                publishDeviceStatusFromFcm(data, prefs);
                return;
            }
            Log.w(TAG, "Location refresh request could not start native service");
            return;
        }

        if ("request_device_status".equals(type)) {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            if (!shouldHandleChildCommand(prefs)) {
                Log.i(TAG, "Device status refresh skipped: this device is not child mode");
                return;
            }
            if (!isTargetedToThisUser(prefs, data, "Device status refresh")) {
                return;
            }
            if (publishDeviceStatusFromFcm(data, prefs)) {
                return;
            }
            Log.w(TAG, "Device status refresh request could not publish native snapshot");
            return;
        }

        // 주변소리 FCM은 안내 알림만 게시한다. 마이크 시작은 FCM만으로 수행하지 않고
        // 서버 승인 증표를 확인한 RemoteListenActivity에서만 수행한다.
        if ("remote_listen".equals(type)) {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            if (!shouldHandleChildCommand(prefs)) {
                Log.i(TAG, "Remote listen skipped: this device is not child mode");
                return;
            }
            if (!isTargetedToThisUser(prefs, data, "Remote listen")) {
                return;
            }
            publishDeviceStatusFromFcm(data, prefs);
            RemoteListenNotification.Result result = RemoteListenNotification.show(
                this,
                new RemoteListenNotification.Request(
                    data.get("requestId"),
                    data.get("familyId"),
                    firstNonBlank(data.get("targetUserId"), data.get("target_user_id")),
                    data.get("senderUserId"),
                    data.get("requestedAt"),
                    data.get("expiresAt"),
                    readDurationSec(data)
                )
            );
            Log.i(TAG, "Remote listen consent notification result=" + result.name());
            return;
        }

        if ("remote_listen_stop".equals(type)) {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            if (!shouldHandleChildCommand(prefs)) {
                Log.i(TAG, "Remote listen stop skipped: this device is not child mode");
                return;
            }
            if (!isTargetedToThisUser(prefs, data, "Remote listen")) {
                return;
            }
            stopAmbientListenService(data);
            return;
        }

        // Friend playdate session lifecycle (Spec FP-D14: native 신규 채널/권한 0)
        if ("playdate_started".equals(type) || "playdate_ended".equals(type)) {
            String playdateTitle = "playdate_started".equals(type)
                ? "친구놀이 시작"
                : "친구놀이 종료";
            String placeName = data.get("place_name");
            String friendChildName = data.get("friend_child_name");
            String playdateBody = "playdate_started".equals(type)
                ? (placeName != null ? placeName : "안전장소")
                    + (friendChildName != null ? " — " + friendChildName + "와 함께" : "")
                : (placeName != null ? placeName + " 친구놀이가 종료됐어요" : "친구놀이가 종료됐어요");

            String sessionId = data.get("session_id");
            int playdateNotifId = sessionId != null
                ? Math.abs(sessionId.hashCode())
                : (int) (System.currentTimeMillis() & 0x7fffffff);

            NotificationHelper.DeliveryReceipt receipt = NotificationHelper.showNotification(
                this,
                playdateTitle,
                playdateBody,
                "schedule",
                false,
                false,
                playdateNotifId,
                null,
                NotificationQuietHoursPolicy.NotificationIdentity.of(type, "")
            );
            if (receipt.shouldAcknowledge()) {
                PolledNotificationStore.markAck(this, stableId);
            } else {
                Log.w(TAG, "Playdate notification was not posted: "
                        + receipt.getStatus().name());
            }
            return;
        }

        boolean isEmergency = isEmergencyNotification(type, data);
        if ("sticker".equals(type) && MainActivity.isAppForeground()) {
            Log.i(TAG, "Sticker FCM suppressed while app is foreground");
            return;
        }

        if ("new_memo".equals(type)) {
            String memoDisplayPermit = data.get("memoDisplayPermit");
            if (!MemoDisplayAuthorizationClient.authorize(targetContext, memoDisplayPermit)) {
                Log.w(TAG, "Memo notification display authorization denied");
                return;
            }

            SessionTokenStore.ContextSnapshot currentContext = SessionTokenStore.readContext(
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            );
            if (!NotificationTargetPolicy.evaluate(
                    data,
                    currentContext.userId,
                    currentContext.familyId,
                    currentContext.role
                ).allowsDelivery()) {
                Log.w(TAG, "Memo notification target changed before display");
                return;
            }
        }

        showNotification(title, body, type, isEmergency, stableId, data);
    }

    private void handleNotificationQuietHoursUpdate(
            Map<String, String> data,
            SharedPreferences targetPrefs,
            SessionTokenStore.ContextSnapshot targetContext
    ) {
        String targetUserId = data.get("targetUserId");
        String familyId = data.get("familyId");
        String enabledValue = data.get("enabled");
        Integer startMinute = parseMinuteOfDay(data.get("startMinute"));
        Integer endMinute = parseMinuteOfDay(data.get("endMinute"));
        String timeZoneId = data.get("timeZoneId");
        long updatedAtMs = parseQuietHoursTimestampMs(data.get("updatedAt"));

        if (targetContext == null
                || targetUserId == null
                || !targetUserId.equals(targetContext.userId)
                || familyId == null
                || !familyId.equals(targetContext.familyId)
                || (!("true".equals(enabledValue)) && !("false".equals(enabledValue)))
                || startMinute == null
                || endMinute == null
                || startMinute.equals(endMinute)
                || !NotificationQuietHoursStore.SEOUL_TIME_ZONE_ID.equals(timeZoneId)
                || updatedAtMs <= 0L) {
            Log.w(TAG, "Quiet-hours control payload rejected");
            return;
        }

        NotificationQuietHoursStore.SaveResult result =
                NotificationQuietHoursStore.saveIfCurrentSession(
                        targetPrefs,
                        targetContext.userId,
                        "true".equals(enabledValue),
                        startMinute,
                        endMinute,
                        timeZoneId,
                        updatedAtMs
                );
        Log.i(TAG, "Quiet-hours control result=" + result.name());
    }

    private static Integer parseMinuteOfDay(String value) {
        if (value == null || !value.matches("\\d{1,4}")) return null;
        try {
            int minute = Integer.parseInt(value);
            return minute >= 0 && minute <= 1439 ? minute : null;
        } catch (NumberFormatException error) {
            return null;
        }
    }

    private static long parseQuietHoursTimestampMs(String value) {
        if (value == null) return 0L;
        String normalized = value.trim();
        if (normalized.matches("\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?")) {
            normalized = normalized.replace(' ', 'T') + "Z";
        }
        return RemoteListenRequestPolicy.parseTimestampMs(normalized);
    }

    private void showNotification(
            String title,
            String body,
            String type,
            boolean isEmergency,
            String stableId,
            Map<String, String> data
    ) {
        // DB-H3: if the LocationService pending-notification poll already
        // displayed this push, skip the FCM copy. markAck below lets the poll
        // skip us in the reverse order — both channels carry the same pushId.
        if (PolledNotificationStore.isAcked(this, stableId)) {
            Log.i(TAG, "Skipping FCM notification already shown via poll: " + stableId);
            return;
        }
        int currentNotifId = stableId != null && !stableId.trim().isEmpty()
            ? NotificationHelper.stableRequestCode(stableId)
            : notifId.getAndIncrement();
        boolean isKkuk = "kkuk".equals(type);
        // 꾹은 긴급 등급 — 전체화면(fullScreenIntent)으로 띄운다.
        boolean fullScreen = isEmergency || isKkuk;
        // AI 친구·부모 메모·칭찬 스티커는 서로 다른 high 채널과 그룹으로 보내
        // 위치 공유 상시 알림이나 다른 기능 아래에 메시지가 묻히지 않게 한다.
        boolean isSticker = "sticker".equals(type);
        boolean isMemo = "new_memo".equals(type);
        String alertType = firstNonBlank(data.get("alertType"), data.get("alert_type"), "");
        String channel = NotificationChannelPolicy.channelFor(type, alertType, isEmergency);
        // AI 선제 대화/부모 메모/스티커 알림은 탭하면 관련 아이 화면으로 직행한다.
        String route = data.get("route");
        if (isBlank(route)) {
            String localRole = SessionTokenStore.readContext(
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            ).role;
            route = "ai_proactive".equals(type)
                ? "ai-chat"
                : (isMemo
                    ? ("parent".equalsIgnoreCase(localRole) ? "/parent/memo" : "child-memo")
                    : (isSticker ? "child-sticker" : null));
        }
        NotificationHelper.DeliveryReceipt receipt = NotificationHelper.showNotification(
            this, title, body,
            channel, fullScreen, fullScreen, currentNotifId, route,
            NotificationQuietHoursPolicy.NotificationIdentity.of(type, alertType)
        );
        // DB-H3: 실제 notify 성공 또는 과거 성공 중복일 때만 폴링 경로를 완료한다.
        if (receipt.shouldAcknowledge()) {
            PolledNotificationStore.markAck(this, stableId);
        } else {
            Log.w(TAG, "FCM notification was not posted: " + receipt.getStatus().name());
        }
    }

    private boolean isEmergencyNotification(String type, Map<String, String> data) {
        return NotificationUrgencyPolicy.isEmergency(
            type,
            data.get("urgent"),
            firstNonBlank(data.get("severity"), ""),
            firstNonBlank(data.get("alertType"), data.get("alert_type"), "")
        );
    }

    private boolean shouldHandleChildCommand(SharedPreferences prefs) {
        String role = prefs != null ? SessionTokenStore.readContext(prefs).role : "";
        return isBlank(role) || "child".equalsIgnoreCase(role);
    }

    private boolean isTargetedToThisUser(SharedPreferences prefs, Map<String, String> data, String commandLabel) {
        SessionTokenStore.ContextSnapshot context = prefs != null
            ? SessionTokenStore.readContext(prefs)
            : null;
        NotificationTargetPolicy.Decision decision = NotificationTargetPolicy.evaluate(
            data,
            context != null ? context.userId : "",
            context != null ? context.familyId : "",
            context != null ? context.role : ""
        );
        if (!decision.allowsDelivery()) {
            Log.i(TAG, commandLabel + " skipped by target policy: " + decision.name());
        }
        return decision.allowsDelivery();
    }

    private boolean startLocationRefreshService(Map<String, String> data, String stableId) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "Location refresh skipped: ACCESS_FINE_LOCATION permission missing");
            return false;
        }

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        SessionTokenStore.ContextSnapshot context = SessionTokenStore.readContext(prefs);
        String userId = context.userId;
        String prefsFamilyId = context.familyId;
        String pushFamilyId = data != null ? data.get("familyId") : null;
        if (!isBlank(pushFamilyId) && !isBlank(prefsFamilyId) && !pushFamilyId.equals(prefsFamilyId)) {
            Log.w(TAG, "Location refresh skipped: family mismatch");
            return false;
        }
        String targetUserId = data != null ? firstNonBlank(data.get("targetUserId"), data.get("target_user_id")) : "";
        if (!isBlank(targetUserId) && !targetUserId.equals(userId)) {
            Log.i(TAG, "Location refresh skipped: target user mismatch");
            return false;
        }

        String familyId = firstNonBlank(pushFamilyId, prefsFamilyId);
        String supabaseUrl = context.supabaseUrl;
        String supabaseKey = context.supabaseKey;
        String accessToken = context.accessToken;
        String refreshToken = context.refreshToken;

        if (isBlank(userId) || isBlank(familyId) || isBlank(supabaseUrl) || isBlank(supabaseKey)) {
            Log.w(TAG, "Location refresh skipped: push context missing");
            return false;
        }
        if (isBlank(accessToken) && isBlank(refreshToken)) {
            Log.w(TAG, "Location refresh skipped: auth token missing");
            return false;
        }

        Intent intent = new Intent(this, LocationService.class);
        intent.setAction(LocationService.ACTION_REFRESH_NOW);
        intent.putExtra("userId", userId);
        intent.putExtra("familyId", familyId);
        intent.putExtra("supabaseUrl", supabaseUrl);
        intent.putExtra("supabaseKey", supabaseKey);
        intent.putExtra("accessToken", accessToken);
        intent.putExtra("refreshToken", refreshToken);
        intent.putExtra("role", "child");
        String requestId = firstNonBlank(stableId, resolveRemoteListenRequestId(data));
        if (!isBlank(requestId)) {
            intent.putExtra("requestId", requestId);
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent);
            } else {
                startService(intent);
            }
            Log.i(TAG, "Location refresh foreground service started from FCM");
            return true;
        } catch (Exception error) {
            Log.w(TAG, "Location refresh service start failed from FCM", error);
            return false;
        }
    }

    private boolean publishDeviceStatusFromFcm(Map<String, String> data, SharedPreferences prefs) {
        SessionTokenStore.ContextSnapshot context = SessionTokenStore.readContext(prefs);
        String userId = context.userId;
        String prefsFamilyId = context.familyId;
        String pushFamilyId = data != null ? data.get("familyId") : null;
        if (!isBlank(pushFamilyId) && !isBlank(prefsFamilyId) && !pushFamilyId.equals(prefsFamilyId)) {
            Log.w(TAG, "Device status refresh skipped: family mismatch");
            return false;
        }

        String targetUserId = data != null ? firstNonBlank(data.get("targetUserId"), data.get("target_user_id")) : "";
        if (!isBlank(targetUserId) && !targetUserId.equals(userId)) {
            Log.i(TAG, "Device status refresh skipped: target user mismatch");
            return true;
        }

        String familyId = firstNonBlank(pushFamilyId, prefsFamilyId);
        String supabaseUrl = context.supabaseUrl;
        String supabaseKey = context.supabaseKey;
        String accessToken = context.accessToken;
        if (isBlank(userId) || isBlank(familyId) || isBlank(supabaseUrl) || isBlank(supabaseKey)) {
            Log.w(TAG, "Device status refresh skipped: push context missing");
            return false;
        }

        return DeviceStatusReporter.publish(
            this,
            HTTP_CLIENT,
            supabaseUrl,
            supabaseKey,
            familyId,
            userId,
            accessToken,
            data != null ? data.get("requestId") : null,
            data != null ? data.get("requesterUserId") : null
        );
    }

    // UDC+ force_ring path: post a fullScreenIntent notification instead of
    // starting ForceRingService directly. The system permits the system-driven
    // activity launch under FGS background-start restrictions; ForceRingActivity
    // onCreate then starts ForceRingService from foreground context for sound.
    private void postForceRingFullScreenNotification(String eventId, String message,
            String initiator, String parentRole, String childName) {
        NotificationHelper.ensureForceRingChannel(this);

        Intent activityIntent = new Intent(this, ForceRingActivity.class);
        activityIntent.putExtra(ForceRingService.EXTRA_EVENT_ID, eventId);
        activityIntent.putExtra(ForceRingService.EXTRA_MESSAGE, message);
        activityIntent.putExtra(ForceRingService.EXTRA_INITIATOR, initiator);
        activityIntent.putExtra(ForceRingService.EXTRA_PARENT_ROLE, parentRole);
        activityIntent.putExtra(ForceRingService.EXTRA_CHILD_NAME, childName);
        activityIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_NO_HISTORY);

        PendingIntent fullScreenPI = UrgentActivityPendingIntent.getActivity(
                this,
                ForceRingService.NOTIF_ID,
                activityIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String role = (parentRole != null && !parentRole.isEmpty()) ? parentRole : null;
        String name = (childName != null && !childName.isEmpty()) ? childName : null;
        String title = "응급 신호";
        String body;
        if (role != null && name != null) {
            body = KoreanText.withSubjectParticle(role) + " "
                    + KoreanText.withObjectParticle(name) + " 찾고 있어요";
        } else if (role != null) {
            body = KoreanText.withSubjectParticle(role) + " 너를 찾고 있어요";
        } else if (initiator != null && !initiator.isEmpty()) {
            body = KoreanText.withSubjectParticle(initiator) + " 너를 찾고 있어요";
        } else {
            body = "부모님이 너를 찾고 있어요";
        }

        Notification notif = new NotificationCompat.Builder(this, NotificationHelper.FORCE_RING_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_hyeni_notification)
                .setLargeIcon(NotificationHelper.largeIcon(this))
                .setColor(ContextCompat.getColor(this, R.color.notification_accent))
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(NotificationHelper.buildPublicVersion(
                        this,
                        NotificationHelper.FORCE_RING_CHANNEL_ID,
                        true,
                        fullScreenPI
                ))
                .setOngoing(true)
                .setAutoCancel(false)
                .setOnlyAlertOnce(true)
                .setFullScreenIntent(fullScreenPI, true)
                .setContentIntent(fullScreenPI)
                .build();

        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            nm.notify(ForceRingService.NOTIF_ID, notif);
        }
    }

    private void cancelForceRingNotification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            nm.cancel(ForceRingService.NOTIF_ID);
        }
    }

    private boolean stopAmbientListenService(Map<String, String> data) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        SessionTokenStore.ContextSnapshot current = SessionTokenStore.readContext(prefs);
        String prefsFamilyId = current.familyId;
        String pushFamilyId = data != null ? data.get("familyId") : null;
        if (!isBlank(pushFamilyId) && !isBlank(prefsFamilyId) && !pushFamilyId.equals(prefsFamilyId)) {
            Log.w(TAG, "Remote listen native stop skipped: family mismatch");
            return false;
        }

        String requestId = data != null ? data.get("requestId") : "";
        String targetUserId = data != null
            ? firstNonBlank(data.get("targetUserId"), data.get("target_user_id"))
            : "";
        String sessionNonce = prefs.getString("sessionNonce", "");
        if (isBlank(requestId)
                || isBlank(targetUserId)
                || !targetUserId.equals(current.userId)
                || !AmbientListenService.matchesActiveSession(
                    requestId,
                    targetUserId,
                    sessionNonce)) {
            Log.w(TAG, "Remote listen native stop skipped: session mismatch");
            return false;
        }

        Intent intent = new Intent(this, AmbientListenService.class);
        intent.setAction(AmbientListenService.ACTION_STOP);
        intent.putExtra(AmbientListenService.EXTRA_REQUEST_ID, requestId);
        intent.putExtra(AmbientListenService.EXTRA_TARGET_USER_ID, targetUserId);
        intent.putExtra(AmbientListenService.EXTRA_SESSION_NONCE, sessionNonce);
        try {
            startService(intent);
            Log.i(TAG, "Remote listen native stop requested from FCM requestId=" + requestId);
            return true;
        } catch (RuntimeException error) {
            Log.w(TAG, "Remote listen native stop dispatch failed", error);
            return false;
        }
    }

    private int readDurationSec(Map<String, String> data) {
        String raw = data != null ? data.get("durationSec") : null;
        if (isBlank(raw)) return RemoteListenRequestPolicy.DEFAULT_DURATION_SEC;
        try {
            return RemoteListenRequestPolicy.normalizeDurationSec(Integer.parseInt(raw));
        } catch (NumberFormatException ignored) {
            return RemoteListenRequestPolicy.DEFAULT_DURATION_SEC;
        }
    }

    private String resolveRemoteListenRequestId(Map<String, String> data) {
        if (data == null) return "";
        return firstNonBlank(
            data.get("requestId"),
            data.get("pushId"),
            data.get("idempotencyKey"),
            data.get("idempotency_key")
        );
    }

    private String firstNonBlank(String... values) {
        if (values == null) return "";
        for (String value : values) {
            if (!isBlank(value)) {
                return value.trim();
            }
        }
        return "";
    }

    private boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

}
