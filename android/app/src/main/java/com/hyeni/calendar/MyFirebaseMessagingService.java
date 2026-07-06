package com.hyeni.calendar;

import android.Manifest;
import android.app.ActivityOptions;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
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
    // v5_silent_cover: 무음 + 폴더블 cover display 호환 채널.
    // - sound=null + vibration=false → 사용자(아이) 에게 들키지 않음
    // - bypassDnd=true → Samsung One UI 가 폴더 닫힌 상태에서도 알림을 cover display
    //   에 표시 → fullScreenIntent 가 RemoteListenActivity launch 가능. bypassDnd 는
    //   "표시 정책" 이고 sound 는 별개라 무음과 양립한다.
    // 채널 ID 가 v4 → v5 로 바뀐 이유: NotificationChannel 의 importance/sound/
    // bypassDnd 는 한 번 생성되면 immutable. v4_silent 은 bypassDnd=false 라 폴더
    // 닫힌 상태에서 cover display 표시 실패. 새 ID 로 재생성해야 갱신됨.
    // 채널 ID 단일 소스 = NotificationHelper.CHANNEL_REMOTE_LISTEN.
    private static final String REMOTE_LISTEN_CHANNEL_ID = NotificationHelper.CHANNEL_REMOTE_LISTEN;
    private static final int DEFAULT_REMOTE_LISTEN_DURATION_SEC = 60;
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

        String action = data.get("action");
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
        String type = data.get("type");

        // Fallback to notification payload if data payload is empty
        if (title == null && remoteMessage.getNotification() != null) {
            title = remoteMessage.getNotification().getTitle();
            body = remoteMessage.getNotification().getBody();
        }

        if (title == null) title = "혜니캘린더";
        if (body == null) body = "";

        // Skip if this notification was sent by me
        String senderUserId = data.get("senderUserId");
        if (senderUserId != null && !senderUserId.isEmpty()) {
            String myUserId = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString("userId", "");
            if (senderUserId.equals(myUserId)) {
                Log.i(TAG, "Skipping self-notification for: " + type);
                return;
            }
        }

        if ("request_location".equals(type)) {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            if (!shouldHandleChildCommand(prefs)) {
                Log.i(TAG, "Location refresh skipped: this device is not child mode");
                return;
            }
            if (!isTargetedToThisUser(prefs, data, "Location refresh")) {
                return;
            }
            if (startLocationRefreshService(data)) {
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

        // Remote listen: silently launch app for mic recording
        if ("remote_listen".equals(type)) {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            if (!shouldHandleChildCommand(prefs)) {
                Log.i(TAG, "Remote listen skipped: this device is not child mode");
                return;
            }
            if (!isTargetedToThisUser(prefs, data, "Remote listen")) {
                return;
            }
            String requestId = resolveRemoteListenRequestId(data);
            Log.i(TAG, "Remote listen request - launching app requestId=" + requestId);
            publishDeviceStatusFromFcm(data, prefs);
            wakeScreen();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                int launcherNotificationId = showRemoteListenLauncher(data);
                launchRemoteListenActivity(data, launcherNotificationId);
                Log.i(TAG, "Remote listen native start skipped on Android 14+");
                // 2026-05-08: background 에서 startForegroundService(AmbientListen)
                // 호출 제거. Android 14+ 는 mic capture 를 위해 FGS type=MICROPHONE
                // 이 필수인데, 그 type 은 background 시작을 거부한다 (SPECIAL_USE
                // 로 우회하면 mic 가 silently muted 되어 peak16=0 무음 PCM 이 된다).
                // 따라서 서비스 시작은 전적으로 RemoteListenActivity.onCreate (foreground
                // context) 에서만 수행한다. cover display 등 activity launch 가 deferred
                // 되는 기기는 폴더를 열어야 동작한다 (system 제약, 우회 불가).
                return;
            }
            if (startAmbientListenService(data)) {
                RemoteListenRequestStore.markLauncherShown(this, requestId);
                return;
            }
            if (!launchRemoteListenActivity(data, 0)) {
                Log.w(TAG, "Remote listen launch fallback notification required");
                showRemoteListenLauncher(data);
            }
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

            NotificationHelper.showNotification(
                this,
                playdateTitle,
                playdateBody,
                "schedule",
                false,
                false,
                playdateNotifId
            );
            return;
        }

        boolean isEmergency = isEmergencyNotification(type, data);
        String stableId = firstNonBlank(
            data.get("pushId"),
            data.get("idempotencyKey"),
            data.get("idempotency_key"),
            type + ":" + title + ":" + body
        );

        showNotification(title, body, type, isEmergency, stableId);
    }

    private void wakeScreen() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null) return;
        // FULL_WAKE_LOCK is deprecated but still wakes the screen on
        // OEM-customised Android (Samsung One UI). 30s covers FCM-arrival →
        // notification post → fullScreenIntent → activity onCreate → mic
        // foreground-service start (each step can take 1-3s on a cold app).
        @SuppressWarnings("deprecation")
        PowerManager.WakeLock wl = pm.newWakeLock(
            PowerManager.FULL_WAKE_LOCK
                | PowerManager.ACQUIRE_CAUSES_WAKEUP
                | PowerManager.ON_AFTER_RELEASE,
            "hyeni:fcm_wake"
        );
        wl.setReferenceCounted(false);
        wl.acquire(30_000);
    }

    private void showNotification(String title, String body, String type, boolean isEmergency, String stableId) {
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
        // AI 친구 메시지는 child_message 채널(IMPORTANCE_HIGH)로 heads-up 팝업 보장.
        boolean isChildMessage = "ai_proactive".equals(type);
        String channel = isEmergency ? "emergency" : (isKkuk ? "kkuk" : (isChildMessage ? "child_message" : "schedule"));
        // AI 선제 대화 알림은 탭하면 AI 채팅 화면으로 직행해야 대화가 이어진다.
        String route = "ai_proactive".equals(type) ? "ai-chat" : null;
        NotificationHelper.showNotification(
            this, title, body,
            channel, fullScreen, fullScreen, currentNotifId, route
        );
        // DB-H3: record the ack so the LocationService poll skips this push.
        PolledNotificationStore.markAck(this, stableId);
    }

    private boolean isEmergencyNotification(String type, Map<String, String> data) {
        if ("emergency".equals(type) || "sos".equals(type)) {
            return true;
        }
        if ("true".equalsIgnoreCase(data.get("urgent"))) {
            return true;
        }
        if (!"parent_alert".equals(type)) {
            return false;
        }
        String severity = firstNonBlank(data.get("severity"), "");
        String alertType = firstNonBlank(data.get("alertType"), data.get("alert_type"), "");
        if ("emergency".equalsIgnoreCase(severity)
                || "critical".equalsIgnoreCase(severity)
                || "urgent".equalsIgnoreCase(severity)) {
            return true;
        }
        return "not_arrived".equals(alertType)
                || "missed_arrival".equals(alertType)
                || "danger_zone".equals(alertType)
                || "danger_enter".equals(alertType)
                || "danger_entry".equals(alertType)
                || "danger_exit".equals(alertType)
                || "sos".equals(alertType)
                || "sos_followup".equals(alertType);
    }

    private boolean shouldHandleChildCommand(SharedPreferences prefs) {
        String role = prefs != null ? prefs.getString("role", "") : "";
        return isBlank(role) || "child".equalsIgnoreCase(role);
    }

    private boolean isTargetedToThisUser(SharedPreferences prefs, Map<String, String> data, String commandLabel) {
        String pushFamilyId = data != null ? data.get("familyId") : null;
        String prefsFamilyId = prefs != null ? prefs.getString("familyId", "") : "";
        if (!isBlank(pushFamilyId) && !isBlank(prefsFamilyId) && !pushFamilyId.equals(prefsFamilyId)) {
            Log.i(TAG, commandLabel + " skipped: family mismatch");
            return false;
        }

        String targetUserId = data != null ? firstNonBlank(data.get("targetUserId"), data.get("target_user_id")) : "";
        String userId = prefs != null ? prefs.getString("userId", "") : "";
        if (!isBlank(targetUserId) && !targetUserId.equals(userId)) {
            Log.i(TAG, commandLabel + " skipped: target user mismatch");
            return false;
        }
        return true;
    }

    private boolean startLocationRefreshService(Map<String, String> data) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "Location refresh skipped: ACCESS_FINE_LOCATION permission missing");
            return false;
        }

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String userId = prefs.getString("userId", "");
        String prefsFamilyId = prefs.getString("familyId", "");
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
        String supabaseUrl = prefs.getString("supabaseUrl", "");
        String supabaseKey = prefs.getString("supabaseKey", "");
        String accessToken = prefs.getString("accessToken", "");

        if (isBlank(userId) || isBlank(familyId) || isBlank(supabaseUrl) || isBlank(supabaseKey)) {
            Log.w(TAG, "Location refresh skipped: push context missing");
            return false;
        }

        Intent intent = new Intent(this, LocationService.class);
        intent.setAction(LocationService.ACTION_REFRESH_NOW);
        intent.putExtra("userId", userId);
        intent.putExtra("familyId", familyId);
        intent.putExtra("supabaseUrl", supabaseUrl);
        intent.putExtra("supabaseKey", supabaseKey);
        intent.putExtra("accessToken", accessToken);
        intent.putExtra("role", "child");
        String requestId = resolveRemoteListenRequestId(data);
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
        String userId = prefs.getString("userId", "");
        String prefsFamilyId = prefs.getString("familyId", "");
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
        String supabaseUrl = prefs.getString("supabaseUrl", "");
        String supabaseKey = prefs.getString("supabaseKey", "");
        String accessToken = prefs.getString("accessToken", "");
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

    private int showRemoteListenLauncher(Map<String, String> data) {
        String channelId = REMOTE_LISTEN_CHANNEL_ID;
        int currentNotifId = notifId.getAndIncrement();
        ensureRemoteListenChannel(channelId);

        Intent launchIntent = createRemoteListenIntent(data, currentNotifId);
        PendingIntent launchPendingIntent = createRemoteListenPendingIntent(
            launchIntent,
            currentNotifId
        );

        // 주변 소리 듣기는 아이가 모르게 깨워야 의미가 있어서 알람이 아닌 silent
        // notification 으로 처리. fullScreenIntent 는 그대로 — 잠금화면에서도
        // RemoteListenActivity 가 launch 되어 mic FGS 가 시작될 수 있게.
        // Android 12+ setSilent(true) + 채널 자체 sound=null 로 이중 보장.
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_hyeni_notification)
            .setColor(ContextCompat.getColor(this, R.color.notification_accent))
            .setContentTitle("주변 소리 연결 요청")
            .setContentText("탭해서 아이 기기에서 연결을 시작하세요.")
            .setStyle(new NotificationCompat.BigTextStyle().bigText("탭하면 아이 기기에서 마이크 연결 화면이 열립니다."))
            .setAutoCancel(false)
            .setContentIntent(launchPendingIntent)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setFullScreenIntent(launchPendingIntent, true)
            .setWhen(System.currentTimeMillis());

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(currentNotifId, builder.build());
        }
        return currentNotifId;
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

        PendingIntent fullScreenPI = PendingIntent.getActivity(
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
                .setColor(ContextCompat.getColor(this, R.color.notification_accent))
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
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

    private boolean launchRemoteListenActivity(Map<String, String> data, int launcherNotificationId) {
        Intent launchIntent = createRemoteListenIntent(data, launcherNotificationId);

        int requestCode = notifId.getAndIncrement();
        PendingIntent launchPendingIntent = createRemoteListenPendingIntent(
            launchIntent,
            requestCode
        );

        try {
            launchPendingIntent.send(this, 0, null, null, null, null, remoteListenSendOptions());
            return true;
        } catch (PendingIntent.CanceledException pendingIntentError) {
            Log.w(TAG, "PendingIntent remote listen launch failed", pendingIntentError);
        }

        try {
            startActivity(launchIntent);
            return true;
        } catch (Exception launchError) {
            Log.w(TAG, "Direct remote listen launch failed", launchError);
            return false;
        }
    }

    private Intent createRemoteListenIntent(Map<String, String> data, int launcherNotificationId) {
        Intent launchIntent = new Intent(this, RemoteListenActivity.class);
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        launchIntent.putExtra("fromPush", true);
        launchIntent.putExtra("remoteListen", true);
        if (launcherNotificationId > 0) {
            launchIntent.putExtra("launcherNotificationId", launcherNotificationId);
        }
        putRemoteListenExtras(launchIntent, data);
        return launchIntent;
    }

    private PendingIntent createRemoteListenPendingIntent(Intent launchIntent, int requestCode) {
        return PendingIntent.getActivity(
            this,
            requestCode,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE,
            remoteListenCreatorOptions()
        );
    }

    private Bundle remoteListenCreatorOptions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            return null;
        }

        ActivityOptions options = ActivityOptions.makeBasic();
        options.setPendingIntentCreatorBackgroundActivityStartMode(
            ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
        );
        // 폴더블 접힘: 내부 화면이 꺼져 있으면 켜진 커버 디스플레이로 띄운다.
        options.setLaunchDisplayId(RemoteListenActivity.activeLaunchDisplayId(this));
        return options.toBundle();
    }

    private Bundle remoteListenSendOptions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return null;
        }

        ActivityOptions options = ActivityOptions.makeBasic();
        options.setPendingIntentBackgroundActivityStartMode(
            ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
        );
        // 폴더블 접힘: 내부 화면이 꺼져 있으면 켜진 커버 디스플레이로 띄운다.
        options.setLaunchDisplayId(RemoteListenActivity.activeLaunchDisplayId(this));
        return options.toBundle();
    }

    private boolean startAmbientListenService(Map<String, String> data) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "Remote listen native start skipped: RECORD_AUDIO permission missing");
            return false;
        }
        // 2026-05-08: 이 경로는 pre-UDC14 (API < 34) 분기에서만 호출된다.
        // UDC+ 에서는 onMessageReceived 의 UDC+ 분기에서 RemoteListenActivity
        // 만 launch 하고, AmbientListenService 는 RemoteListenActivity.onCreate
        // (foreground context) 에서 단일 시작한다. background 에서 직접 호출하면
        // FOREGROUND_SERVICE_TYPE_MICROPHONE 이 ForegroundServiceStartNotAllowed
        // 로 거부되고, SPECIAL_USE 로 우회하면 mic 가 silently muted 되기 때문.

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String userId = prefs.getString("userId", "");
        String prefsFamilyId = prefs.getString("familyId", "");
        String pushFamilyId = data != null ? data.get("familyId") : null;
        if (!isBlank(pushFamilyId) && !isBlank(prefsFamilyId) && !pushFamilyId.equals(prefsFamilyId)) {
            Log.w(TAG, "Remote listen native start skipped: family mismatch");
            return false;
        }

        String familyId = firstNonBlank(pushFamilyId, prefsFamilyId);
        String supabaseUrl = prefs.getString("supabaseUrl", "");
        String supabaseKey = prefs.getString("supabaseKey", "");
        String accessToken = prefs.getString("accessToken", "");

        if (isBlank(userId) || isBlank(familyId) || isBlank(supabaseUrl) || isBlank(supabaseKey)) {
            Log.w(TAG, "Remote listen native start skipped: push context missing");
            return false;
        }

        Intent intent = new Intent(this, AmbientListenService.class);
        intent.setAction(AmbientListenService.ACTION_START);
        intent.putExtra(AmbientListenService.EXTRA_USER_ID, userId);
        intent.putExtra(AmbientListenService.EXTRA_FAMILY_ID, familyId);
        intent.putExtra(AmbientListenService.EXTRA_SUPABASE_URL, supabaseUrl);
        intent.putExtra(AmbientListenService.EXTRA_SUPABASE_KEY, supabaseKey);
        intent.putExtra(AmbientListenService.EXTRA_ACCESS_TOKEN, accessToken);
        intent.putExtra(AmbientListenService.EXTRA_DURATION_SEC, readDurationSec(data));

        String senderUserId = data != null ? data.get("senderUserId") : null;
        if (!isBlank(senderUserId)) {
            intent.putExtra(AmbientListenService.EXTRA_INITIATOR_USER_ID, senderUserId);
        }
        String requestId = resolveRemoteListenRequestId(data);
        if (!isBlank(requestId)) {
            intent.putExtra(AmbientListenService.EXTRA_REQUEST_ID, requestId);
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent);
            } else {
                startService(intent);
            }
            Log.i(TAG, "Remote listen native foreground service started from FCM");
            return true;
        } catch (Exception error) {
            Log.w(TAG, "Remote listen native service start failed from FCM", error);
            return false;
        }
    }

    private boolean stopAmbientListenService(Map<String, String> data) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String prefsFamilyId = prefs.getString("familyId", "");
        String pushFamilyId = data != null ? data.get("familyId") : null;
        if (!isBlank(pushFamilyId) && !isBlank(prefsFamilyId) && !pushFamilyId.equals(prefsFamilyId)) {
            Log.w(TAG, "Remote listen native stop skipped: family mismatch");
            return false;
        }

        Intent intent = new Intent(this, AmbientListenService.class);
        intent.setAction(AmbientListenService.ACTION_STOP);
        boolean stopped = stopService(intent);
        Log.i(TAG, "Remote listen native stop requested from FCM requestId="
            + resolveRemoteListenRequestId(data)
            + " stopped=" + stopped);
        return stopped;
    }

    private void putRemoteListenExtras(Intent intent, Map<String, String> data) {
        if (intent == null || data == null) return;
        putIfPresent(intent, "familyId", data.get("familyId"));
        putIfPresent(intent, "senderUserId", data.get("senderUserId"));
        putIfPresent(intent, "durationSec", data.get("durationSec"));
        putIfPresent(intent, "requestId", resolveRemoteListenRequestId(data));
        putIfPresent(intent, "targetUserId", data.get("targetUserId"));
    }

    private void putIfPresent(Intent intent, String key, String value) {
        if (!isBlank(value)) {
            intent.putExtra(key, value);
        }
    }

    private int readDurationSec(Map<String, String> data) {
        String raw = data != null ? data.get("durationSec") : null;
        if (isBlank(raw)) return DEFAULT_REMOTE_LISTEN_DURATION_SEC;
        try {
            int durationSec = Integer.parseInt(raw);
            if (durationSec < 5) return DEFAULT_REMOTE_LISTEN_DURATION_SEC;
            return Math.min(durationSec, 120);
        } catch (NumberFormatException ignored) {
            return DEFAULT_REMOTE_LISTEN_DURATION_SEC;
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

    private void ensureRemoteListenChannel(String channelId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;

        NotificationChannel existing = nm.getNotificationChannel(channelId);
        if (existing != null) return;

        // IMPORTANCE_HIGH 는 setFullScreenIntent 가 잠금화면 / cover display 에서
        // RemoteListenActivity 를 launch 하도록 유지. sound=null + vibration=false
        // 로 무음. bypassDnd=true 는 Samsung 폴더블 cover display 에 알림이 노출되어야
        // fullScreenIntent activity launch 가 발동하기 때문에 다시 켠다 (DND 우회는
        // 표시 정책, 사운드는 별개 — 채널이 sound=null 이면 우회해도 무음).
        // 사용자 보고(2026-05-07): "폴더가 닫힌 상태에서 주변 소리 듣기 안 됨".
        NotificationChannel channel = new NotificationChannel(
            channelId, "원격 듣기 연결 (cover 호환 무음)", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("폴더 닫힘 / 잠금화면에서도 화면만 조용히 켜고 마이크 연결을 시작");
        channel.enableVibration(false);
        channel.setVibrationPattern(null);
        channel.setBypassDnd(true);
        channel.setSound(null, null);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

}
