package com.hyeni.calendar;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public class ForceRingService extends Service {
    public static final String EXTRA_EVENT_ID = "event_id";
    public static final String EXTRA_MESSAGE = "message";
    public static final String EXTRA_INITIATOR = "initiator_name";
    public static final String EXTRA_PARENT_ROLE = "parent_role";
    public static final String EXTRA_CHILD_NAME = "child_name";
    public static final int NOTIF_ID = 7301;
    private static final long HARD_CAP_MS = 15_000L;
    private static final String TAG = "ForceRingService";

    private MediaPlayer mediaPlayer;
    private Vibrator vibrator;
    private AudioManager audioManager;
    private int originalAlarmVolume = -1;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable autoStop = this::stopForTimeout;
    private boolean stopBroadcastSent = false;

    // Set when the service is started, cleared on destroy. Used by
    // MyFirebaseMessagingService to verify that an incoming force_ring_stop
    // FCM matches the currently-ringing event before stopping — defense in
    // depth against a spoofed/stale stop that would otherwise silence any
    // running alarm.
    private static volatile String activeEventId = null;
    public static String getActiveEventId() { return activeEventId; }
    private String currentEventId;

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        currentEventId = intent.getStringExtra(EXTRA_EVENT_ID);
        if (ForceRingRequestStore.wasStoppedRecently(this, currentEventId)) {
            android.util.Log.i(TAG, "start ignored because event was already stopped");
            cancelForceRingNotification();
            sendStopBroadcast();
            stopSelf();
            return START_NOT_STICKY;
        }
        activeEventId = currentEventId;
        String message = intent.getStringExtra(EXTRA_MESSAGE);
        String initiator = intent.getStringExtra(EXTRA_INITIATOR);
        String parentRole = intent.getStringExtra(EXTRA_PARENT_ROLE);
        String childName = intent.getStringExtra(EXTRA_CHILD_NAME);

        ForceRingRequestStore.markLauncherShown(this, currentEventId);
        NotificationHelper.ensureForceRingChannel(this);

        Intent activityIntent = new Intent(this, ForceRingActivity.class);
        activityIntent.putExtra(EXTRA_EVENT_ID, currentEventId);
        activityIntent.putExtra(EXTRA_MESSAGE, message);
        activityIntent.putExtra(EXTRA_INITIATOR, initiator);
        activityIntent.putExtra(EXTRA_PARENT_ROLE, parentRole);
        activityIntent.putExtra(EXTRA_CHILD_NAME, childName);
        activityIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_NO_HISTORY);

        PendingIntent fullScreenPI = PendingIntent.getActivity(
                this, 0, activityIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        int iconRes = R.drawable.ic_hyeni_notification;

        String role = (parentRole != null && !parentRole.isEmpty()) ? parentRole : null;
        String name = (childName != null && !childName.isEmpty()) ? childName : null;
        String contentTitle;
        if (role != null && name != null) {
            contentTitle = KoreanText.withSubjectParticle(role) + " "
                    + KoreanText.withObjectParticle(name) + " 찾고 있어요";
        } else if (role != null) {
            contentTitle = KoreanText.withSubjectParticle(role) + " 너를 찾고 있어요";
        } else if (initiator != null && !initiator.isEmpty()) {
            contentTitle = KoreanText.withSubjectParticle(initiator) + " 너를 찾고 있어요";
        } else {
            contentTitle = "부모님이 너를 찾고 있어요";
        }

        Notification notif = new NotificationCompat.Builder(this, NotificationHelper.FORCE_RING_CHANNEL_ID)
                .setSmallIcon(iconRes)
                .setLargeIcon(NotificationHelper.largeIcon(this))
                .setColor(ContextCompat.getColor(this, R.color.notification_accent))
                .setContentTitle(contentTitle)
                .setContentText(message != null ? message : "")
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(NotificationHelper.buildPublicVersion(
                        this,
                        NotificationHelper.FORCE_RING_CHANNEL_ID,
                        true,
                        fullScreenPI
                ))
                .setFullScreenIntent(fullScreenPI, true)
                .setOnlyAlertOnce(true)
                .setOngoing(true)
                .setAutoCancel(false)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIF_ID, notif);
        }

        stopAlarmPlayback();
        stopVibration();
        playAlarm();
        startVibration();
        // autoStop 중복 등록 방지 — 동일 service 인스턴스에 재진입 시 timer 리셋
        handler.removeCallbacks(autoStop);
        handler.postDelayed(autoStop, HARD_CAP_MS);

        // Defense-in-depth: stop FCM이 도달 못해도 DB 폴링으로 자가종료
        startStopPolling(currentEventId);

        return START_NOT_STICKY;
    }

    private void stopForTimeout() {
        ForceRingRequestStore.markStopped(this, currentEventId);
        postStopReasonToServer(currentEventId, "auto_timeout");
        cancelForceRingNotification();
        sendStopBroadcast();
        stopSelf();
    }

    // ── stop 신뢰성 보장: force_ring_events.stopped_at 폴링 ──────────────
    // 부모가 "그만 울리기"를 눌렀을 때 stop FCM이 doze/네트워크/포그라운드
    // 제약 등으로 도달하지 못해도, 자녀 기기가 직접 DB 상태를 확인해
    // 종료할 수 있도록 한다. 2초 간격으로 HARD_CAP_MS 동안만 폴링.
    private static final long STOP_POLL_INTERVAL_MS = 2_000L;
    private Thread stopPollThread;

    private void startStopPolling(final String eventId) {
        if (eventId == null || eventId.isEmpty()) return;
        final android.content.SharedPreferences prefs =
                getSharedPreferences("hyeni_location_prefs", MODE_PRIVATE);
        final String supabaseUrl = prefs.getString("supabaseUrl", null);
        final String supabaseKey = prefs.getString("supabaseKey", null);
        final String accessToken = prefs.getString("accessToken", null);
        if (supabaseUrl == null || supabaseKey == null) {
            android.util.Log.w(TAG, "stop poll skipped: push context missing");
            return;
        }
        stopPollThread = new Thread(() -> {
            okhttp3.OkHttpClient client = new okhttp3.OkHttpClient.Builder()
                    .connectTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
                    .readTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
                    .build();
            String bearer = (accessToken != null && !accessToken.isEmpty())
                    ? accessToken : supabaseKey;
            String url = supabaseUrl
                    + "/rest/v1/force_ring_events?id=eq." + eventId
                    + "&select=stopped_at";
            long deadline = System.currentTimeMillis() + HARD_CAP_MS;
            while (!Thread.currentThread().isInterrupted()
                    && System.currentTimeMillis() < deadline) {
                try {
                    Thread.sleep(STOP_POLL_INTERVAL_MS);
                    okhttp3.Request req = new okhttp3.Request.Builder()
                            .url(url)
                            .header("apikey", supabaseKey)
                            .header("Authorization", "Bearer " + bearer)
                            .header("Accept", "application/json")
                            .get()
                            .build();
                    try (okhttp3.Response res = client.newCall(req).execute()) {
                        if (!res.isSuccessful()) continue;
                        String bodyStr = res.body() != null ? res.body().string() : "";
                        // 응답: [{"stopped_at": "..."}] 또는 [{"stopped_at": null}]
                        if (bodyStr.contains("\"stopped_at\"")
                                && !bodyStr.contains("\"stopped_at\":null")) {
                            android.util.Log.i(TAG,
                                    "stop poll detected stopped_at — terminating");
                            handler.post(() -> {
                                sendBroadcast(new Intent(
                                        "com.hyeni.calendar.FORCE_RING_STOP")
                                        .setPackage(getPackageName()));
                                stopSelf();
                            });
                            return;
                        }
                    }
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return;
                } catch (Exception e) {
                    android.util.Log.w(TAG, "stop poll iteration failed", e);
                }
            }
        }, "force-ring-stop-poll");
        stopPollThread.setDaemon(true);
        stopPollThread.start();
    }

    private void playAlarm() {
        try {
            audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (audioManager != null) {
                try {
                    if (originalAlarmVolume < 0) {
                        originalAlarmVolume = audioManager.getStreamVolume(AudioManager.STREAM_ALARM);
                    }
                    int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM);
                    audioManager.setStreamVolume(AudioManager.STREAM_ALARM, max, 0);
                } catch (SecurityException volumeBlocked) {
                    android.util.Log.w(TAG, "Cannot raise alarm volume (DND policy)", volumeBlocked);
                }
            }

            Uri alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (alarmUri == null) {
                alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }
            if (alarmUri == null) {
                android.util.Log.e(TAG, "No system alarm/notification ringtone available");
                return;
            }

            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();

            mediaPlayer = new MediaPlayer();
            mediaPlayer.setAudioAttributes(attrs);
            mediaPlayer.setDataSource(this, alarmUri);
            mediaPlayer.setLooping(true);
            mediaPlayer.prepare();
            mediaPlayer.start();
        } catch (Exception e) {
            android.util.Log.e(TAG, "Failed to play alarm", e);
        }
    }

    private void startVibration() {
        vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        long[] pattern = { 0, 1000, 500, 1000, 500, 1000 };
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            } else {
                vibrator.vibrate(pattern, 0);
            }
        } catch (Exception e) {
            android.util.Log.w(TAG, "Vibration failed", e);
        }
    }

    private void stopAlarmPlayback() {
        if (mediaPlayer == null) return;
        try {
            mediaPlayer.stop();
        } catch (Exception ignored) {}
        try {
            mediaPlayer.release();
        } catch (Exception ignored) {}
        mediaPlayer = null;
    }

    private void stopVibration() {
        if (vibrator == null) return;
        try {
            vibrator.cancel();
        } catch (Exception ignored) {}
        vibrator = null;
    }

    private void postStopReasonToServer(String eventId, String reason) {
        if (eventId == null || eventId.trim().isEmpty()) return;
        SharedPreferences prefs = getSharedPreferences("hyeni_location_prefs", MODE_PRIVATE);
        String supabaseUrl = prefs.getString("supabaseUrl", null);
        String supabaseKey = prefs.getString("supabaseKey", null);
        String accessToken = prefs.getString("accessToken", null);
        if (supabaseUrl == null || supabaseKey == null) {
            android.util.Log.w(TAG, "auto-timeout update skipped: push context missing");
            return;
        }

        new Thread(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("stopped_at", isoNow());
                body.put("stop_reason", reason);
                String bearer = (accessToken != null && !accessToken.isEmpty())
                        ? accessToken : supabaseKey;
                okhttp3.Request req = new okhttp3.Request.Builder()
                        .url(supabaseUrl + "/rest/v1/force_ring_events?id=eq."
                                + eventId + "&stopped_at=is.null")
                        .header("apikey", supabaseKey)
                        .header("Authorization", "Bearer " + bearer)
                        .header("Content-Type", "application/json")
                        .header("Prefer", "return=minimal")
                        .patch(okhttp3.RequestBody.create(
                                body.toString(),
                                okhttp3.MediaType.get("application/json")))
                        .build();
                okhttp3.OkHttpClient client = new okhttp3.OkHttpClient.Builder()
                        .connectTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
                        .readTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
                        .build();
                try (okhttp3.Response res = client.newCall(req).execute()) {
                    if (!res.isSuccessful()) {
                        android.util.Log.w(TAG,
                                "auto-timeout update failed: " + res.code());
                    }
                }
            } catch (Exception e) {
                android.util.Log.w(TAG, "auto-timeout update error", e);
            }
        }, "force-ring-auto-timeout").start();
    }

    private String isoNow() {
        SimpleDateFormat formatter =
                new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(new Date());
    }

    private void cancelForceRingNotification() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {}
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            nm.cancel(NOTIF_ID);
        }
    }

    private void sendStopBroadcast() {
        if (stopBroadcastSent) return;
        stopBroadcastSent = true;
        sendBroadcast(new Intent("com.hyeni.calendar.FORCE_RING_STOP")
                .setPackage(getPackageName()));
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        activeEventId = null;
        handler.removeCallbacks(autoStop);
        if (stopPollThread != null) {
            try { stopPollThread.interrupt(); } catch (Exception ignored) {}
            stopPollThread = null;
        }
        stopAlarmPlayback();
        if (audioManager != null && originalAlarmVolume >= 0) {
            try {
                audioManager.setStreamVolume(AudioManager.STREAM_ALARM, originalAlarmVolume, 0);
            } catch (Exception ignored) {}
        }
        stopVibration();

        cancelForceRingNotification();
        sendStopBroadcast();
    }
}
