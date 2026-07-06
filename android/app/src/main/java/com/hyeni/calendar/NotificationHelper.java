package com.hyeni.calendar;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

public final class NotificationHelper {

    private static final String TAG = "NotificationHelper";

    public static final String CHANNEL_SCHEDULE = "hyeni_schedule_v6";
    // v5 → v6: 채널 속성은 생성 후 immutable. 기존 설치 기기에는 (구)
    // LocationService 가 delete+재생성해 둔 약한 진동({0,100,60,100})·
    // "일정 알림" 라벨의 v5 정의가 고착되어 있어, ID 범프로만 강한 긴급
    // 진동({0,300,120,300,120,600})·"긴급 알림" 라벨을 적용할 수 있다.
    public static final String CHANNEL_EMERGENCY = "hyeni_alert_v6";
    public static final String CHANNEL_KKUK = "hyeni_kkuk_v6";
    // 무음 표시용 채널: JS 가 channel="silent" 로 보낸 알림을 사운드/진동/뱃지
    // 없이 조용히 게시한다. IMPORTANCE_LOW 라 heads-up 도 뜨지 않는다(의도된 무음).
    public static final String CHANNEL_SILENT = "hyeni_silent_v1";
    // 아이가 받는 메시지(AI 친구 선제 대화·가족 메시지) 전용 채널. 새 ID 라서 구버전
    // 설치 기기에 고착된 약한 채널 설정과 무관하게 IMPORTANCE_HIGH(heads-up 팝업)가
    // 보장된다 — 상태표시줄 트레이 직행 방지. 전체화면(fullScreenIntent)은 쓰지 않는다.
    public static final String CHANNEL_CHILD_MESSAGE = "hyeni_child_message_v1";
    // 원격 듣기(주변 소리) 채널 단일 소스. MyFirebaseMessagingService / LocationService /
    // NotificationPlugin / DeviceStatusReporter 가 모두 이 상수를 참조해 ID 드리프트를 막는다.
    // v5_silent_cover: sound=null + vibration=false 무음, bypassDnd=true 로 폴더블 cover
    // display 에서도 알림이 노출돼 fullScreenIntent activity launch 가 발동한다.
    public static final String CHANNEL_REMOTE_LISTEN = "hyeni_remote_listen_v5_silent_cover";

    private static final String DEDUPE_PREFS_NAME = "hyeni_notification_dedupe";
    private static final long DEDUPE_WINDOW_MS = 90_000L;

    private static final String[] LEGACY_CHANNELS = {
            "hyeni_schedule",
            "hyeni_emergency",
            "hyeni_kkuk",
            "hyeni_schedule_channel",
            "hyeni_alert_channel",
            "hyeni_schedule_v2",
            "hyeni_alert_v2",
            "hyeni_kkuk_v2",
            "hyeni_schedule_v3",
            "hyeni_alert_v3",
            "hyeni_kkuk_v3",
            "hyeni_schedule_v4",
            "hyeni_alert_v4",
            "hyeni_kkuk_v4",
            "hyeni_schedule_v5",
            "hyeni_kkuk_v5",
            "hyeni_alert_v5"
    };

    private NotificationHelper() {}

    public static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) {
            return;
        }

        for (String legacyChannel : LEGACY_CHANNELS) {
            if (nm.getNotificationChannel(legacyChannel) != null) {
                nm.deleteNotificationChannel(legacyChannel);
            }
        }

        Uri sound = Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.hyeni_notification);
        AudioAttributes audioAttr = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

        NotificationChannel schedule = new NotificationChannel(
                CHANNEL_SCHEDULE,
                "일정 알림",
                NotificationManager.IMPORTANCE_HIGH
        );
        schedule.setDescription("일정과 리마인더 안내");
        schedule.enableVibration(true);
        schedule.setVibrationPattern(new long[]{0, 120, 80, 120});
        schedule.setSound(sound, audioAttr);
        schedule.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        schedule.setShowBadge(true);
        nm.createNotificationChannel(schedule);

        NotificationChannel emergency = new NotificationChannel(
                CHANNEL_EMERGENCY,
                "긴급 알림",
                NotificationManager.IMPORTANCE_HIGH
        );
        emergency.setDescription("전체 화면 긴급 알림");
        emergency.enableVibration(true);
        emergency.setVibrationPattern(new long[]{0, 300, 120, 300, 120, 600});
        emergency.setSound(sound, audioAttr);
        emergency.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        emergency.setShowBadge(true);
        emergency.setBypassDnd(true);
        nm.createNotificationChannel(emergency);

        NotificationChannel childMessage = new NotificationChannel(
                CHANNEL_CHILD_MESSAGE,
                "AI 친구·가족 메시지",
                NotificationManager.IMPORTANCE_HIGH
        );
        childMessage.setDescription("AI 친구와 가족이 보낸 메시지를 팝업으로 알려줘요");
        childMessage.enableVibration(true);
        childMessage.setVibrationPattern(new long[]{0, 120, 80, 120});
        childMessage.setSound(sound, audioAttr);
        childMessage.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        childMessage.setShowBadge(true);
        nm.createNotificationChannel(childMessage);

        NotificationChannel kkuk = new NotificationChannel(
                CHANNEL_KKUK,
                "깨움 알림",
                NotificationManager.IMPORTANCE_HIGH
        );
        kkuk.setDescription("깨움 알림 안내");
        kkuk.enableVibration(true);
        kkuk.setVibrationPattern(new long[]{0, 120, 80, 120});
        kkuk.setSound(sound, audioAttr);
        kkuk.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        kkuk.setShowBadge(true);
        nm.createNotificationChannel(kkuk);

        // 무음 표시용 채널 — 사운드/진동/뱃지 모두 off. IMPORTANCE_LOW 라 heads-up
        // 도 안 뜬다. JS 가 channel="silent" 로 보낼 때만 사용(조용한 정보성 알림).
        NotificationChannel silent = new NotificationChannel(
                CHANNEL_SILENT,
                "무음 알림",
                NotificationManager.IMPORTANCE_LOW
        );
        silent.setDescription("소리·진동 없이 조용히 표시되는 알림");
        silent.enableVibration(false);
        silent.setVibrationPattern(null);
        silent.setSound(null, null);
        silent.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        silent.setShowBadge(false);
        nm.createNotificationChannel(silent);
    }

    public static int stableRequestCode(String stableId) {
        if (stableId == null || stableId.trim().isEmpty()) {
            return 20_000;
        }
        return 20_000 + Math.floorMod(stableId.hashCode(), 1_000_000_000);
    }

    public static Bitmap largeIcon(Context context) {
        Bitmap icon = BitmapFactory.decodeResource(context.getResources(), R.drawable.hyeni_notification_large);
        if (icon != null) {
            return icon;
        }
        return BitmapFactory.decodeResource(context.getResources(), R.mipmap.ic_launcher_foreground);
    }

    public static void showNotification(
            Context context,
            String title,
            String body,
            String channel,
            boolean wakeScreen,
            boolean fullScreen,
            int notificationId
    ) {
        showNotification(context, title, body, channel, wakeScreen, fullScreen, notificationId, null);
    }

    public static void showNotification(
            Context context,
            String title,
            String body,
            String channel,
            boolean wakeScreen,
            boolean fullScreen,
            int notificationId,
            String route
    ) {
        createChannels(context);

        int requestCode = Math.max(1, notificationId);
        // 긴급 알림(미도착·SOS·위험지역)은 dedup 을 우회한다 — 90초 창 또는
        // notificationId 해시 충돌로 안전 알림이 억제되면 안 되며, 동일 긴급
        // 이벤트의 재알림도 항상 표시되어야 한다 (NTV-C2).
        if (!"emergency".equals(channel) && isDuplicate(context, requestCode)) {
            return;
        }

        Uri sound = Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.hyeni_notification);
        boolean emergency = "emergency".equals(channel);
        boolean kkuk = "kkuk".equals(channel);
        boolean silent = "silent".equals(channel);
        boolean childMessage = "child_message".equals(channel);
        Bitmap largeIcon = largeIcon(context);

        if (wakeScreen) {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isInteractive()) {
                @SuppressWarnings("deprecation")
                PowerManager.WakeLock wl = pm.newWakeLock(
                        PowerManager.FULL_WAKE_LOCK
                                | PowerManager.ACQUIRE_CAUSES_WAKEUP
                                | PowerManager.ON_AFTER_RELEASE,
                        "hyeni:notification_wake"
                );
                wl.acquire(15_000);
            }
        }

        Intent contentIntent = new Intent(context, MainActivity.class);
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        contentIntent.putExtra("fromPush", true);
        // 알림 탭 시 특정 화면으로 직행해야 하는 알림(예: AI 선제 대화 → AI 채팅)은
        // route extra 를 실어 MainActivity 가 WebView 에 진입 플래그를 주입하게 한다.
        if (route != null && !route.trim().isEmpty()) {
            contentIntent.putExtra("route", route);
        }
        PendingIntent contentPi = PendingIntent.getActivity(
                context,
                requestCode,
                contentIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent alertIntent = new Intent(context, PushAlertActivity.class);
        alertIntent.putExtra("title", title);
        alertIntent.putExtra("body", body);
        // 전체화면 UI 가 긴급/꾹 변형 스타일을 구분할 수 있게 채널을 전달한다.
        alertIntent.putExtra("channel", channel);
        PendingIntent fullScreenPi = PendingIntent.getActivity(
                context,
                requestCode + 10_000,
                alertIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String channelId;
        switch (channel) {
            case "emergency":
                channelId = CHANNEL_EMERGENCY;
                break;
            case "kkuk":
                channelId = CHANNEL_KKUK;
                break;
            case "silent":
                channelId = CHANNEL_SILENT;
                break;
            case "child_message":
                channelId = CHANNEL_CHILD_MESSAGE;
                break;
            default:
                channelId = CHANNEL_SCHEDULE;
                break;
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
                .setSmallIcon(R.drawable.ic_hyeni_notification)
                .setLargeIcon(largeIcon)
                .setColor(ContextCompat.getColor(context, R.color.notification_accent))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(emergency
                        ? NotificationCompat.PRIORITY_MAX
                        : ((fullScreen || childMessage) ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT))
                .setCategory(emergency
                        ? NotificationCompat.CATEGORY_ALARM
                        : ((kkuk || childMessage) ? NotificationCompat.CATEGORY_MESSAGE : NotificationCompat.CATEGORY_REMINDER))
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setContentIntent(contentPi)
                .setWhen(System.currentTimeMillis());

        if (emergency) {
            builder.setVibrate(new long[]{0, 300, 120, 300, 120, 600});
        } else if (kkuk) {
            builder.setVibrate(new long[]{0, 120, 80, 120});
        }

        // 무음 의도: 사운드/진동/heads-up 알림음을 모두 끈다. 채널(IMPORTANCE_LOW)
        // 자체도 무음이지만 pre-O 기기와 NotificationCompat 경로를 이중으로 보장.
        if (silent) {
            builder.setSilent(true);
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O && !silent) {
            builder.setSound(sound);
        }

        if (fullScreen) {
            builder.setFullScreenIntent(fullScreenPi, true);
        }

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        // Android 14+(SDK 34) 진단: fullScreenIntent 권한이 없으면 시스템이 전체화면
        // 을 일반 heads-up 으로 강등한다. 동작은 그대로 두되, 강등을 로그로 남겨
        // "긴급인데 잠금화면 전체화면이 안 떴다"는 현장 보고를 추적할 수 있게 한다.
        if (fullScreen
                && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
                && nm != null
                && !nm.canUseFullScreenIntent()) {
            Log.w(TAG, "fullScreenIntent demoted to heads-up: USE_FULL_SCREEN_INTENT not granted (channel=" + channel + ")");
        }
        if (nm != null) {
            nm.notify(requestCode, builder.build());
        }
    }

    private static boolean isDuplicate(Context context, int notificationId) {
        long now = System.currentTimeMillis();
        SharedPreferences prefs = context.getSharedPreferences(DEDUPE_PREFS_NAME, Context.MODE_PRIVATE);
        String key = "n_" + notificationId;
        long lastShownAt = prefs.getLong(key, 0L);
        if (lastShownAt > 0L && now - lastShownAt < DEDUPE_WINDOW_MS) {
            return true;
        }
        prefs.edit().putLong(key, now).apply();
        return false;
    }

    public static final String FORCE_RING_CHANNEL_ID = "force_ring_emergency_v3_alarm";

    public static void ensureForceRingChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        if (nm.getNotificationChannel(FORCE_RING_CHANNEL_ID) != null) return;

        Uri alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (alarmSound == null) {
            alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        }
        if (alarmSound == null) {
            alarmSound = Uri.parse("android.resource://" + ctx.getPackageName() + "/" + R.raw.hyeni_notification);
        }
        AudioAttributes alarmAudioAttr = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

        NotificationChannel ch = new NotificationChannel(
                FORCE_RING_CHANNEL_ID,
                "응급 강제 알람",
                NotificationManager.IMPORTANCE_HIGH
        );
        ch.setDescription("부모가 직접 트리거한 응급 신호. 무음/방해금지를 우회합니다.");
        ch.setBypassDnd(true);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 1000, 500, 1000, 500, 1000});
        ch.setSound(alarmSound, alarmAudioAttr);
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }
}
