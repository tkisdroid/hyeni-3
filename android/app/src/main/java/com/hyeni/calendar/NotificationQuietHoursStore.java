package com.hyeni.calendar;

import android.content.Context;
import android.content.SharedPreferences;

/** 현재 로그인 사용자에게 귀속된 조용한 시간 스냅샷을 원자적으로 저장한다. */
final class NotificationQuietHoursStore {
    static final String KEY_USER_ID = "notificationQuietHoursUserId";
    static final String KEY_ENABLED = "notificationQuietHoursEnabled";
    static final String KEY_START_MINUTE = "notificationQuietHoursStartMinute";
    static final String KEY_END_MINUTE = "notificationQuietHoursEndMinute";
    static final String KEY_TIME_ZONE = "notificationQuietHoursTimeZone";
    static final String KEY_UPDATED_AT_MS = "notificationQuietHoursUpdatedAtMs";

    static final String SEOUL_TIME_ZONE_ID = "Asia/Seoul";

    private static final String PREFS_NAME = "hyeni_location_prefs";
    private static final int DEFAULT_START_MINUTE = 1320;
    private static final int DEFAULT_END_MINUTE = 420;

    enum SaveResult {
        SAVED,
        STALE_SESSION,
        STALE_UPDATE,
        INVALID_POLICY
    }

    static final class Snapshot {
        final String userId;
        final boolean enabled;
        final int startMinute;
        final int endMinute;
        final String timeZoneId;
        final long updatedAtMs;

        Snapshot(
            String userId,
            boolean enabled,
            int startMinute,
            int endMinute,
            String timeZoneId,
            long updatedAtMs
        ) {
            this.userId = clean(userId);
            this.enabled = enabled;
            this.startMinute = startMinute;
            this.endMinute = endMinute;
            this.timeZoneId = clean(timeZoneId);
            this.updatedAtMs = updatedAtMs;
        }
    }

    private NotificationQuietHoursStore() {}

    static boolean isValidTimeZone(String value) {
        if (value == null || value.length() > 100) return false;
        return "UTC".equals(value) || (value.contains("/") && java.util.Arrays.asList(java.util.TimeZone.getAvailableIDs()).contains(value));
    }

    static synchronized Snapshot read(SharedPreferences prefs) {
        if (prefs == null) {
            return defaultSnapshot();
        }
        return new Snapshot(
            prefs.getString(KEY_USER_ID, ""),
            prefs.getBoolean(KEY_ENABLED, false),
            prefs.getInt(KEY_START_MINUTE, DEFAULT_START_MINUTE),
            prefs.getInt(KEY_END_MINUTE, DEFAULT_END_MINUTE),
            prefs.getString(KEY_TIME_ZONE, SEOUL_TIME_ZONE_ID),
            prefs.getLong(KEY_UPDATED_AT_MS, 0L)
        );
    }

    static synchronized SaveResult saveIfCurrentSession(
        SharedPreferences prefs,
        String expectedUserId,
        boolean enabled,
        int startMinute,
        int endMinute,
        String timeZoneId,
        long updatedAtMs
    ) {
        String resolvedUserId = clean(expectedUserId);
        if (prefs == null
            || resolvedUserId.isEmpty()
            || !isMinuteOfDay(startMinute)
            || !isMinuteOfDay(endMinute)
            || startMinute == endMinute
            || !isValidTimeZone(timeZoneId)
            || updatedAtMs < 0L) {
            return SaveResult.INVALID_POLICY;
        }

        // clear()와 같은 SessionTokenStore 임계구역에서 현재 사용자 확인과 저장을
        // 끝내 로그아웃·계정 전환 직후 늦게 도착한 설정이 되살아나지 않게 한다.
        synchronized (SessionTokenStore.class) {
            String currentUserId = SessionTokenStore.readContext(prefs).userId;
            if (!resolvedUserId.equals(currentUserId)) {
                return SaveResult.STALE_SESSION;
            }

            Snapshot current = read(prefs);
            if (resolvedUserId.equals(current.userId) && updatedAtMs < current.updatedAtMs) {
                return SaveResult.STALE_UPDATE;
            }

            prefs.edit()
                .putString(KEY_USER_ID, resolvedUserId)
                .putBoolean(KEY_ENABLED, enabled)
                .putInt(KEY_START_MINUTE, startMinute)
                .putInt(KEY_END_MINUTE, endMinute)
                .putString(KEY_TIME_ZONE, timeZoneId)
                .putLong(KEY_UPDATED_AT_MS, updatedAtMs)
                .apply();
            return SaveResult.SAVED;
        }
    }

    static NotificationQuietHoursPolicy.Decision decide(
        Context context,
        NotificationQuietHoursPolicy.NotificationIdentity identity,
        long nowMs
    ) {
        NotificationQuietHoursPolicy.Decision identityDecision =
            NotificationQuietHoursPolicy.decide(null, identity, nowMs);
        if (identityDecision == NotificationQuietHoursPolicy.Decision.COMMAND) {
            return identityDecision;
        }
        if (context == null) {
            return NotificationQuietHoursPolicy.Decision.ALLOW;
        }

        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            SessionTokenStore.ContextSnapshot session;
            Snapshot snapshot;
            // saveIfCurrentSession과 같은 Store -> Session 잠금 순서를 유지한다.
            synchronized (NotificationQuietHoursStore.class) {
                synchronized (SessionTokenStore.class) {
                    session = SessionTokenStore.readContext(prefs);
                    snapshot = read(prefs);
                }
            }
            NotificationQuietHoursPolicy.Decision decision =
                NotificationQuietHoursPolicy.decide(snapshot, identity, nowMs);
            if (decision == NotificationQuietHoursPolicy.Decision.COMMAND) {
                return decision;
            }
            if (session.userId.isEmpty() || !session.userId.equals(snapshot.userId)) {
                return NotificationQuietHoursPolicy.Decision.ALLOW;
            }
            return decision;
        } catch (RuntimeException error) {
            // 로컬 캐시가 없거나 손상돼도 일반 알림 자체를 잃지 않도록 fail-open 한다.
            return NotificationQuietHoursPolicy.Decision.ALLOW;
        }
    }

    private static Snapshot defaultSnapshot() {
        return new Snapshot(
            "",
            false,
            DEFAULT_START_MINUTE,
            DEFAULT_END_MINUTE,
            SEOUL_TIME_ZONE_ID,
            0L
        );
    }

    private static boolean isMinuteOfDay(int value) {
        return value >= 0 && value < 24 * 60;
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
