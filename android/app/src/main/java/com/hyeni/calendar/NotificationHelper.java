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
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.RequiresApi;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

public final class NotificationHelper {

    private static final String TAG = "NotificationHelper";

    /** 정규화한 큰 아이콘 캐시. 알림마다 자산을 다시 디코딩·스케일하지 않는다. */
    private static final Object LARGE_ICON_LOCK = new Object();
    private static Bitmap largeIconCache;
    private static int largeIconCacheCanvasPx;

    // Android 알림 채널의 잠금화면 공개 범위는 생성 뒤 바뀌지 않을 수 있다.
    // private ID로 이관해 기존 설치에서도 가족 메시지·일정·위치 상세를 가린다.
    public static final String CHANNEL_SCHEDULE = "hyeni_schedule_v7_private";
    public static final String CHANNEL_SAFETY = "hyeni_safety_v2_private";
    public static final String CHANNEL_EMERGENCY = "hyeni_alert_v7_private";
    public static final String CHANNEL_KKUK = "hyeni_kkuk_v7_private";
    // 무음 표시용 채널: JS 가 channel="silent" 로 보낸 알림을 사운드/진동/뱃지
    // 없이 조용히 게시한다. IMPORTANCE_LOW 라 heads-up 도 뜨지 않는다(의도된 무음).
    public static final String CHANNEL_SILENT = "hyeni_silent_v2_private";
    // 아이 알림이 위치 공유 상태와 한 묶음으로 접히지 않도록 기능별 독립 채널을 쓴다.
    // 세 채널 모두 기존 아이 메시지 채널의 사용자 설정을 최초 생성 때 이관한다.
    public static final String CHANNEL_FAMILY_MESSAGE = "hyeni_family_message_v1_private";
    public static final String CHANNEL_AI_FRIEND = "hyeni_ai_friend_v1_private";
    public static final String CHANNEL_STICKER = "hyeni_sticker_v1_private";
    private static final String CHANNEL_CHILD_MESSAGE_LEGACY = "hyeni_child_message_v2_private";
    // 원격 듣기(주변 소리) 채널 단일 소스. MyFirebaseMessagingService / LocationService /
    // NotificationPlugin / DeviceStatusReporter 가 모두 이 상수를 참조해 ID 드리프트를 막는다.
    // v6_consent는 이전 출시에서 만든 호환 ID다. 현재는 서버 승인 증표를 확인한
    // Activity가 아이 탭 없이 연결하되 화면·알림에 실행 사실을 계속 고지한다.
    // 기존 무음/full-screen/DND 우회 채널은 immutable이므로 이 ID를 유지한다.
    public static final String CHANNEL_REMOTE_LISTEN = "hyeni_remote_listen_v6_consent";

    private static final String DEDUPE_PREFS_NAME = "hyeni_notification_dedupe";
    private static final long DEDUPE_WINDOW_MS = 90_000L;

    public enum DeliveryStatus {
        POSTED(true, true),
        ALREADY_POSTED(true, false),
        QUIET_HOURS_SUPPRESSED(true, false),
        APP_NOTIFICATIONS_DISABLED(false, false),
        POST_NOTIFICATIONS_PERMISSION_DENIED(false, false),
        CHANNEL_DISABLED(false, false),
        CHANNEL_UNAVAILABLE(false, false),
        MANAGER_UNAVAILABLE(false, false),
        NOTIFY_FAILED(false, false);

        private final boolean shouldAcknowledge;
        private final boolean postedNow;

        DeliveryStatus(boolean shouldAcknowledge, boolean postedNow) {
            this.shouldAcknowledge = shouldAcknowledge;
            this.postedNow = postedNow;
        }

        boolean shouldAcknowledge() {
            return shouldAcknowledge;
        }

        boolean wasPostedNow() {
            return postedNow;
        }
    }

    public static final class DeliveryReceipt {
        private final DeliveryStatus status;

        private DeliveryReceipt(DeliveryStatus status) {
            this.status = status;
        }

        public static DeliveryReceipt forStatus(DeliveryStatus status) {
            return new DeliveryReceipt(status);
        }

        public DeliveryStatus getStatus() {
            return status;
        }

        public boolean shouldAcknowledge() {
            return status.shouldAcknowledge();
        }

        public boolean wasPostedNow() {
            return status.wasPostedNow();
        }
    }

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
            "hyeni_alert_v5",
            "hyeni_remote_listen_v5_silent_cover",
            "hyeni_schedule_v6",
            "hyeni_safety_v1",
            "hyeni_alert_v6",
            "hyeni_kkuk_v6",
            "hyeni_silent_v1",
            "hyeni_child_message_v1",
            CHANNEL_CHILD_MESSAGE_LEGACY
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

        Uri sound = Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.hyeni_notification);
        AudioAttributes audioAttr = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

        NotificationChannel schedule = new NotificationChannel(
                CHANNEL_SCHEDULE,
                "일정 알림",
                legacyImportance(nm, "hyeni_schedule_v6", NotificationManager.IMPORTANCE_HIGH)
        );
        schedule.setDescription("일정과 리마인더 안내");
        schedule.enableVibration(true);
        schedule.setVibrationPattern(new long[]{0, 120, 80, 120});
        schedule.setSound(sound, audioAttr);
        schedule.setShowBadge(true);
        applyLegacyChannelBehavior(schedule, nm.getNotificationChannel("hyeni_schedule_v6"));
        schedule.setLockscreenVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(schedule);

        NotificationChannel safety = new NotificationChannel(
                CHANNEL_SAFETY,
                "위치·안전 알림",
                legacyImportance(nm, "hyeni_safety_v1", NotificationManager.IMPORTANCE_HIGH)
        );
        safety.setDescription("도착·출발·위험 장소 등 위치와 안전 안내");
        safety.enableVibration(true);
        safety.setVibrationPattern(new long[]{0, 180, 100, 180});
        safety.setSound(sound, audioAttr);
        safety.setShowBadge(true);
        applyLegacyChannelBehavior(safety, nm.getNotificationChannel("hyeni_safety_v1"));
        safety.setLockscreenVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(safety);

        NotificationChannel emergency = new NotificationChannel(
                CHANNEL_EMERGENCY,
                "긴급 알림",
                legacyImportance(nm, "hyeni_alert_v6", NotificationManager.IMPORTANCE_HIGH)
        );
        emergency.setDescription("전체 화면 긴급 알림");
        emergency.enableVibration(true);
        emergency.setVibrationPattern(new long[]{0, 300, 120, 300, 120, 600});
        emergency.setSound(sound, audioAttr);
        emergency.setShowBadge(true);
        emergency.setBypassDnd(true);
        applyLegacyChannelBehavior(emergency, nm.getNotificationChannel("hyeni_alert_v6"));
        emergency.setLockscreenVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(emergency);

        NotificationChannel previousChildMessage = nm.getNotificationChannel(CHANNEL_CHILD_MESSAGE_LEGACY);
        String previousChildMessageId = CHANNEL_CHILD_MESSAGE_LEGACY;
        if (previousChildMessage == null) {
            previousChildMessage = nm.getNotificationChannel("hyeni_child_message_v1");
            previousChildMessageId = "hyeni_child_message_v1";
        }

        NotificationChannel familyMessage = new NotificationChannel(
                CHANNEL_FAMILY_MESSAGE,
                "가족 메시지",
                legacyImportance(nm, previousChildMessageId, NotificationManager.IMPORTANCE_HIGH)
        );
        familyMessage.setDescription("보호자와 아이가 주고받는 메시지를 팝업으로 알려줘요");
        familyMessage.enableVibration(true);
        familyMessage.setVibrationPattern(new long[]{0, 120, 80, 120});
        familyMessage.setSound(sound, audioAttr);
        familyMessage.setShowBadge(true);
        applyLegacyChannelBehavior(familyMessage, previousChildMessage);
        familyMessage.setLockscreenVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(familyMessage);

        NotificationChannel aiFriend = new NotificationChannel(
                CHANNEL_AI_FRIEND,
                "AI 친구 알림",
                legacyImportance(nm, previousChildMessageId, NotificationManager.IMPORTANCE_HIGH)
        );
        aiFriend.setDescription("AI 친구가 먼저 건네는 말을 팝업으로 알려줘요");
        aiFriend.enableVibration(true);
        aiFriend.setVibrationPattern(new long[]{0, 120, 80, 120});
        aiFriend.setSound(sound, audioAttr);
        aiFriend.setShowBadge(true);
        applyLegacyChannelBehavior(aiFriend, previousChildMessage);
        aiFriend.setLockscreenVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(aiFriend);

        NotificationChannel sticker = new NotificationChannel(
                CHANNEL_STICKER,
                "스티커 알림",
                legacyImportance(nm, previousChildMessageId, NotificationManager.IMPORTANCE_HIGH)
        );
        sticker.setDescription("보호자가 보낸 칭찬 스티커를 팝업으로 알려줘요");
        sticker.enableVibration(true);
        sticker.setVibrationPattern(new long[]{0, 120, 80, 120});
        sticker.setSound(sound, audioAttr);
        sticker.setShowBadge(true);
        applyLegacyChannelBehavior(sticker, previousChildMessage);
        sticker.setLockscreenVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(sticker);

        NotificationChannel kkuk = new NotificationChannel(
                CHANNEL_KKUK,
                "깨움 알림",
                legacyImportance(nm, "hyeni_kkuk_v6", NotificationManager.IMPORTANCE_HIGH)
        );
        kkuk.setDescription("깨움 알림 안내");
        kkuk.enableVibration(true);
        kkuk.setVibrationPattern(new long[]{0, 120, 80, 120});
        kkuk.setSound(sound, audioAttr);
        kkuk.setShowBadge(true);
        applyLegacyChannelBehavior(kkuk, nm.getNotificationChannel("hyeni_kkuk_v6"));
        kkuk.setLockscreenVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(kkuk);

        // 무음 표시용 채널 — 사운드/진동/뱃지 모두 off. IMPORTANCE_LOW 라 heads-up
        // 도 안 뜬다. JS 가 channel="silent" 로 보낼 때만 사용(조용한 정보성 알림).
        NotificationChannel silent = new NotificationChannel(
                CHANNEL_SILENT,
                "무음 알림",
                legacyImportance(nm, "hyeni_silent_v1", NotificationManager.IMPORTANCE_LOW)
        );
        silent.setDescription("소리·진동 없이 조용히 표시되는 알림");
        silent.enableVibration(false);
        silent.setVibrationPattern(null);
        silent.setSound(null, null);
        silent.setShowBadge(false);
        applyLegacyChannelBehavior(silent, nm.getNotificationChannel("hyeni_silent_v1"));
        silent.setLockscreenVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(silent);

        // 신규 private 채널 생성과 사용자 설정 이관이 끝난 뒤에만 구 채널을 정리한다.
        for (String legacyChannel : LEGACY_CHANNELS) {
            if (nm.getNotificationChannel(legacyChannel) != null) {
                nm.deleteNotificationChannel(legacyChannel);
            }
        }

        ensureRemoteListenConsentChannel(context);
    }

    @RequiresApi(Build.VERSION_CODES.O)
    static int legacyImportance(
            NotificationManager manager,
            String legacyId,
            int fallback
    ) {
        NotificationChannel previous = manager.getNotificationChannel(legacyId);
        if (previous == null
                || previous.getImportance() == NotificationManager.IMPORTANCE_UNSPECIFIED) {
            return fallback;
        }
        return previous.getImportance();
    }

    /** ID 마이그레이션이 사용자의 기존 차단·소리·진동 선택을 되돌리지 않게 한다. */
    @RequiresApi(Build.VERSION_CODES.O)
    static void applyLegacyChannelBehavior(
            NotificationChannel target,
            NotificationChannel previous
    ) {
        if (previous == null) return;
        target.setSound(previous.getSound(), previous.getAudioAttributes());
        target.setVibrationPattern(previous.getVibrationPattern());
        target.enableVibration(previous.shouldVibrate());
        target.setShowBadge(previous.canShowBadge());
        target.setBypassDnd(previous.canBypassDnd());
    }

    /** 위급 주변소리 실행 사실을 잠금화면에도 알리는 high-priority 채널. */
    public static void ensureRemoteListenConsentChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;

        Uri sound = Uri.parse(
            "android.resource://" + context.getPackageName() + "/" + R.raw.hyeni_notification
        );
        AudioAttributes audioAttr = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_REMOTE_LISTEN,
            "주변 소리 알림",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("위급 주변 소리 듣기가 진행될 때 아이 화면과 알림에 표시됩니다.");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 180, 100, 180});
        channel.setSound(sound, audioAttr);
        channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        channel.setShowBadge(true);
        nm.createNotificationChannel(channel);
    }

    public static int stableRequestCode(String stableId) {
        if (stableId == null || stableId.trim().isEmpty()) {
            return 20_000;
        }
        return 20_000 + Math.floorMod(stableId.hashCode(), 1_000_000_000);
    }

    public static boolean areRequiredDeliveryChannelsEnabled(NotificationManager nm) {
        if (nm == null) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        String[] required = {
            CHANNEL_SCHEDULE,
            CHANNEL_SAFETY,
            CHANNEL_EMERGENCY,
            CHANNEL_KKUK,
            CHANNEL_FAMILY_MESSAGE
        };
        for (String channelId : required) {
            NotificationChannel channel = nm.getNotificationChannel(channelId);
            if (channel == null || channel.getImportance() == NotificationManager.IMPORTANCE_NONE) {
                return false;
            }
        }
        return true;
    }

    /**
     * 알림 큰 아이콘. 원본을 정사각형으로 정규화해서 돌려준다.
     *
     * 혜니 캐릭터 원본은 세로가 더 길고 인물이 위아래 끝까지 닿아 있어서, 시스템 정사각 슬롯에
     * 채우기로 들어가면 머리 위와 옷 아래가 잘렸다. 그래서 자르지 않고 원형 크롭 여유를 남긴
     * 정사각 비트맵을 만들어 캐시한다(알림마다 재디코딩하지 않는다).
     */
    public static Bitmap largeIcon(Context context) {
        if (context == null) return null;
        int canvasPx = largeIconCanvasPx(context);
        synchronized (LARGE_ICON_LOCK) {
            if (largeIconCache != null
                    && !largeIconCache.isRecycled()
                    && largeIconCacheCanvasPx == canvasPx) {
                return largeIconCache;
            }
        }

        Bitmap source = decodeLargeIconSource(context, canvasPx);
        if (source == null) return null;
        Bitmap squared = squareLargeIcon(source, canvasPx);
        if (squared == null) return source;
        synchronized (LARGE_ICON_LOCK) {
            largeIconCache = squared;
            largeIconCacheCanvasPx = canvasPx;
        }
        return squared;
    }

    private static int largeIconCanvasPx(Context context) {
        int px = 0;
        try {
            px = context.getResources()
                .getDimensionPixelSize(android.R.dimen.notification_large_icon_width);
        } catch (RuntimeException error) {
            Log.w(TAG, "Notification large icon size lookup failed", error);
        }
        return NotificationLargeIconLayout.clampCanvasSize(px);
    }

    private static Bitmap decodeLargeIconSource(Context context, int canvasPx) {
        Bitmap icon = decodeSampledResource(context, R.drawable.hyeni_notification_large, canvasPx);
        if (icon != null) return icon;
        return decodeSampledResource(context, R.mipmap.ic_launcher_foreground, canvasPx);
    }

    /** 큰 자산을 통째로 올리지 않도록 경계만 먼저 읽고 2의 거듭제곱으로 축소 디코딩한다. */
    private static Bitmap decodeSampledResource(Context context, int resId, int targetPx) {
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeResource(context.getResources(), resId, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                return BitmapFactory.decodeResource(context.getResources(), resId);
            }
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = NotificationLargeIconLayout.sampleSize(
                bounds.outWidth,
                bounds.outHeight,
                targetPx
            );
            return BitmapFactory.decodeResource(context.getResources(), resId, options);
        } catch (OutOfMemoryError | RuntimeException error) {
            Log.w(TAG, "Notification large icon decode failed", error);
            return null;
        }
    }

    /** 원본을 자르지 않고 정사각 캔버스 가운데에 그린다. 실패하면 null 이라 호출부가 원본을 쓴다. */
    private static Bitmap squareLargeIcon(Bitmap source, int canvasPx) {
        NotificationLargeIconLayout.Box box = NotificationLargeIconLayout.contain(
            source.getWidth(),
            source.getHeight(),
            canvasPx,
            NotificationLargeIconLayout.SAFE_RATIO
        );
        if (box.isEmpty()) return null;
        try {
            Bitmap out = Bitmap.createBitmap(canvasPx, canvasPx, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(out);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setFilterBitmap(true);
            paint.setDither(true);
            canvas.drawBitmap(
                source,
                null,
                new Rect(box.left, box.top, box.left + box.width, box.top + box.height),
                paint
            );
            return out;
        } catch (OutOfMemoryError | RuntimeException error) {
            Log.w(TAG, "Notification large icon square normalize failed", error);
            return null;
        }
    }

    /** 잠금화면에는 가족 메시지·일정·위치·긴급 상세를 싣지 않는다. */
    public static Notification buildPublicVersion(
            Context context,
            String channelId,
            boolean urgent,
            PendingIntent contentIntent
    ) {
        NotificationCompat.Builder publicBuilder = new NotificationCompat.Builder(context, channelId)
                .setSmallIcon(R.drawable.ic_hyeni_notification)
                .setColor(ContextCompat.getColor(context, R.color.notification_accent))
                .setContentTitle(urgent ? "혜니캘린더 긴급 알림" : "혜니캘린더 알림")
                .setContentText("잠금을 해제해 확인해 주세요")
                .setCategory(urgent
                        ? NotificationCompat.CATEGORY_ALARM
                        : NotificationCompat.CATEGORY_STATUS)
                .setPriority(urgent
                        ? NotificationCompat.PRIORITY_MAX
                        : NotificationCompat.PRIORITY_DEFAULT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(!urgent);
        if (contentIntent != null) publicBuilder.setContentIntent(contentIntent);
        return publicBuilder.build();
    }

    public static DeliveryReceipt showNotification(
            Context context,
            String title,
            String body,
            String channel,
            boolean wakeScreen,
            boolean fullScreen,
            int notificationId
    ) {
        return showNotification(context, title, body, channel, wakeScreen, fullScreen, notificationId, null);
    }

    public static DeliveryReceipt showNotification(
            Context context,
            String title,
            String body,
            String channel,
            boolean wakeScreen,
            boolean fullScreen,
            int notificationId,
            String route
    ) {
        return showNotification(
            context,
            title,
            body,
            channel,
            wakeScreen,
            fullScreen,
            notificationId,
            route,
            null
        );
    }

    public static DeliveryReceipt showNotification(
            Context context,
            String title,
            String body,
            String channel,
            boolean wakeScreen,
            boolean fullScreen,
            int notificationId,
            String route,
            NotificationQuietHoursPolicy.NotificationIdentity identity
    ) {
        NotificationQuietHoursPolicy.Decision quietDecision = NotificationQuietHoursStore.decide(
            context,
            identity,
            System.currentTimeMillis()
        );
        if (quietDecision == NotificationQuietHoursPolicy.Decision.SUPPRESS) {
            return DeliveryReceipt.forStatus(DeliveryStatus.QUIET_HOURS_SUPPRESSED);
        }

        try {
            createChannels(context);
        } catch (RuntimeException error) {
            Log.w(TAG, "notification channel setup failed", error);
            return DeliveryReceipt.forStatus(DeliveryStatus.NOTIFY_FAILED);
        }

        int requestCode = Math.max(1, notificationId);
        Uri sound = Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.hyeni_notification);
        boolean emergency = "emergency".equals(channel);
        boolean kkuk = "kkuk".equals(channel);
        boolean silent = "silent".equals(channel);
        boolean familyMessage = "family_message".equals(channel);
        boolean aiFriend = "ai_friend".equals(channel);
        boolean sticker = "sticker".equals(channel);
        boolean childMessage = familyMessage || aiFriend || sticker;
        boolean safety = "safety".equals(channel);
        Bitmap largeIcon = largeIcon(context);

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
            case "family_message":
                channelId = CHANNEL_FAMILY_MESSAGE;
                break;
            case "ai_friend":
                channelId = CHANNEL_AI_FRIEND;
                break;
            case "sticker":
                channelId = CHANNEL_STICKER;
                break;
            case "safety":
                channelId = CHANNEL_SAFETY;
                break;
            default:
                channelId = CHANNEL_SCHEDULE;
                break;
        }

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) {
            return DeliveryReceipt.forStatus(DeliveryStatus.MANAGER_UNAVAILABLE);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
            return DeliveryReceipt.forStatus(DeliveryStatus.POST_NOTIFICATIONS_PERMISSION_DENIED);
        }
        try {
            if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
                return DeliveryReceipt.forStatus(DeliveryStatus.APP_NOTIFICATIONS_DISABLED);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel notificationChannel = nm.getNotificationChannel(channelId);
                if (notificationChannel == null) {
                    return DeliveryReceipt.forStatus(DeliveryStatus.CHANNEL_UNAVAILABLE);
                }
                if (notificationChannel.getImportance() == NotificationManager.IMPORTANCE_NONE) {
                    return DeliveryReceipt.forStatus(DeliveryStatus.CHANNEL_DISABLED);
                }
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "notification delivery state check failed", error);
            return DeliveryReceipt.forStatus(DeliveryStatus.NOTIFY_FAILED);
        }

        // 같은 stable ID의 FCM·pending 경로가 동시에 도착해도 이전 notify 성공 기록만
        // 중복으로 인정한다. 긴급도 같은 push ID는 한 번만 울리되, 차단/예외로
        // 게시되지 않은 시도는 기록하지 않아 다음 경로가 다시 시도할 수 있다.
        if (wasRecentlyPosted(context, requestCode)) {
            return DeliveryReceipt.forStatus(DeliveryStatus.ALREADY_POSTED);
        }

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

        String localRole = SessionTokenStore.readContext(
            context.getSharedPreferences("hyeni_location_prefs", Context.MODE_PRIVATE)
        ).role;
        String validatedRoute = NotificationRoutePolicy.resolveHashRoute(route, localRole);

        Intent contentIntent = new Intent(context, MainActivity.class);
        contentIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        contentIntent.putExtra("fromPush", true);
        // 알림 탭 시 특정 화면으로 직행해야 하는 알림(예: AI 선제 대화 → AI 채팅)은
        // 현재 역할의 허용 경로만 실어 MainActivity 가 WebView 에 진입 플래그를 주입하게 한다.
        if (validatedRoute != null) {
            contentIntent.putExtra("route", validatedRoute);
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
        if (validatedRoute != null) {
            alertIntent.putExtra("route", validatedRoute);
        }
        PendingIntent fullScreenPi = UrgentActivityPendingIntent.getActivity(
                context,
                requestCode + 10_000,
                alertIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
                .setSmallIcon(R.drawable.ic_hyeni_notification)
                .setLargeIcon(largeIcon)
                .setColor(ContextCompat.getColor(context, R.color.notification_accent))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(emergency
                        ? NotificationCompat.PRIORITY_MAX
                        : ((fullScreen || childMessage || safety) ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT))
                .setCategory(emergency
                        ? NotificationCompat.CATEGORY_ALARM
                        : ((kkuk || childMessage) ? NotificationCompat.CATEGORY_MESSAGE : NotificationCompat.CATEGORY_REMINDER))
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(buildPublicVersion(
                        context,
                        channelId,
                        emergency || kkuk || fullScreen,
                        contentPi
                ))
                .setGroup(NotificationGroupPolicy.groupFor(channel))
                .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
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

        // Android 14+(SDK 34) 진단: fullScreenIntent 권한이 없으면 시스템이 전체화면
        // 을 일반 heads-up 으로 강등한다. 동작은 그대로 두되, 강등을 로그로 남겨
        // "긴급인데 잠금화면 전체화면이 안 떴다"는 현장 보고를 추적할 수 있게 한다.
        if (fullScreen
                && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
                && nm != null
                && !nm.canUseFullScreenIntent()) {
            Log.w(TAG, "fullScreenIntent demoted to heads-up: USE_FULL_SCREEN_INTENT not granted (channel=" + channel + ")");
        }
        synchronized (NotificationHelper.class) {
            if (wasRecentlyPosted(context, requestCode)) {
                return DeliveryReceipt.forStatus(DeliveryStatus.ALREADY_POSTED);
            }
            try {
                nm.notify(requestCode, builder.build());
                markPosted(context, requestCode);
                return DeliveryReceipt.forStatus(DeliveryStatus.POSTED);
            } catch (RuntimeException error) {
                Log.w(TAG, "notification post failed (channel=" + channelId + ")", error);
                return DeliveryReceipt.forStatus(DeliveryStatus.NOTIFY_FAILED);
            }
        }
    }

    private static boolean wasRecentlyPosted(Context context, int notificationId) {
        long now = System.currentTimeMillis();
        SharedPreferences prefs = context.getSharedPreferences(DEDUPE_PREFS_NAME, Context.MODE_PRIVATE);
        String key = "n_" + notificationId;
        long lastShownAt = prefs.getLong(key, 0L);
        return lastShownAt > 0L && now - lastShownAt < DEDUPE_WINDOW_MS;
    }

    private static void markPosted(Context context, int notificationId) {
        context.getSharedPreferences(DEDUPE_PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putLong("n_" + notificationId, System.currentTimeMillis())
            .apply();
    }

    public static final String FORCE_RING_CHANNEL_ID = "force_ring_emergency_v4_private";

    public static void ensureForceRingChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        if (nm.getNotificationChannel(FORCE_RING_CHANNEL_ID) != null) return;

        NotificationChannel previous = nm.getNotificationChannel("force_ring_emergency_v3_alarm");

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
                legacyImportance(
                        nm,
                        "force_ring_emergency_v3_alarm",
                        NotificationManager.IMPORTANCE_HIGH
                )
        );
        ch.setDescription("부모가 직접 트리거한 응급 신호. 무음/방해금지를 우회합니다.");
        ch.setBypassDnd(true);
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 1000, 500, 1000, 500, 1000});
        ch.setSound(alarmSound, alarmAudioAttr);
        ch.setShowBadge(false);
        applyLegacyChannelBehavior(ch, previous);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(ch);
        if (previous != null) nm.deleteNotificationChannel("force_ring_emergency_v3_alarm");
    }
}
