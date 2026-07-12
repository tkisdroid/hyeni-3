package com.hyeni.calendar;

/** 실제 측위 시각과 부모 실시간 성공에 사용할 수 있는 신선도를 한곳에서 판정한다. */
final class LocationFixPolicy {
    private static final long LIVE_REFRESH_MAX_AGE_MS = 90_000L;

    private LocationFixPolicy() {}

    static long resolveCapturedAtMs(long providerTimeMs, long receivedAtMs) {
        if (providerTimeMs <= 0L) return receivedAtMs;
        return Math.min(providerTimeMs, receivedAtMs);
    }

    static long resolveCapturedAtMs(
        long providerTimeMs,
        long providerElapsedRealtimeNanos,
        long receivedAtMs,
        long receivedElapsedRealtimeNanos
    ) {
        if (providerElapsedRealtimeNanos > 0L
            && receivedElapsedRealtimeNanos >= providerElapsedRealtimeNanos) {
            long ageMs = (receivedElapsedRealtimeNanos - providerElapsedRealtimeNanos) / 1_000_000L;
            if (ageMs <= receivedAtMs) return receivedAtMs - ageMs;
        }
        return resolveCapturedAtMs(providerTimeMs, receivedAtMs);
    }

    static boolean isFreshForLiveRefresh(long capturedAtMs, long receivedAtMs) {
        if (capturedAtMs <= 0L || receivedAtMs < capturedAtMs) return false;
        return receivedAtMs - capturedAtMs <= LIVE_REFRESH_MAX_AGE_MS;
    }

    static long resolveFixAgeMs(long capturedAtMs, long receivedAtMs) {
        if (capturedAtMs <= 0L || receivedAtMs <= capturedAtMs) return 0L;
        return receivedAtMs - capturedAtMs;
    }

    static boolean isOutOfOrder(long capturedAtMs, long lastAcceptedAtMs) {
        return capturedAtMs > 0L
            && lastAcceptedAtMs > 0L
            && capturedAtMs < lastAcceptedAtMs;
    }

    static boolean isOutOfOrder(
        long capturedAtMs,
        long lastAcceptedAtMs,
        long fixElapsedRealtimeNanos,
        long lastAcceptedElapsedRealtimeNanos
    ) {
        if (fixElapsedRealtimeNanos > 0L && lastAcceptedElapsedRealtimeNanos > 0L) {
            return fixElapsedRealtimeNanos < lastAcceptedElapsedRealtimeNanos;
        }
        return isOutOfOrder(capturedAtMs, lastAcceptedAtMs);
    }

    static boolean isDuplicateAcceptedFix(
        long capturedAtMs,
        long lastAcceptedAtMs,
        long providerElapsedRealtimeNanos,
        long lastAcceptedElapsedRealtimeNanos,
        boolean forceUpload,
        boolean lastAcceptedWasForceUpload
    ) {
        boolean sameFix = providerElapsedRealtimeNanos > 0L && lastAcceptedElapsedRealtimeNanos > 0L
            ? providerElapsedRealtimeNanos == lastAcceptedElapsedRealtimeNanos
            : capturedAtMs > 0L && capturedAtMs == lastAcceptedAtMs;
        if (!sameFix) return false;
        // 상시 콜백이 먼저 온 경우 부모 요청(force)은 서버 ACK를 위해 한 번 허용한다.
        // force가 이미 처리됐거나 두 상시 콜백이 같은 fix를 주면 중복 업로드하지 않는다.
        return !forceUpload || lastAcceptedWasForceUpload;
    }
}
