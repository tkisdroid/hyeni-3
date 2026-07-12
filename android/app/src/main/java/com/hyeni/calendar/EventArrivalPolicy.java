package com.hyeni.calendar;

final class EventArrivalPolicy {
    static final long MAX_FIX_AGE_MS = 15L * 60L * 1000L;
    static final float MAX_ACCURACY_M = 150f;

    enum ArrivalDecision {
        AT_LOCATION,
        AWAY,
        UNKNOWN
    }

    private EventArrivalPolicy() {}

    static int minutesFromStart(int nowMinutes, int eventMinutes) {
        return nowMinutes - eventMinutes;
    }

    static ArrivalDecision classify(
            float distanceM,
            float accuracyM,
            long fixCapturedAtMs,
            long nowMs,
            float radiusM
    ) {
        if (!Float.isFinite(distanceM)
                || !Float.isFinite(accuracyM)
                || accuracyM < 0f
                || accuracyM > MAX_ACCURACY_M
                || fixCapturedAtMs <= 0L
                || nowMs < fixCapturedAtMs
                || nowMs - fixCapturedAtMs > MAX_FIX_AGE_MS) {
            return ArrivalDecision.UNKNOWN;
        }
        if (distanceM <= radiusM) return ArrivalDecision.AT_LOCATION;
        if (distanceM <= radiusM + accuracyM) return ArrivalDecision.UNKNOWN;
        return ArrivalDecision.AWAY;
    }
}
