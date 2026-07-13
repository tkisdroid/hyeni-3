package com.hyeni.calendar;

import androidx.annotation.Nullable;

import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** 원격청취 요청의 시간·대상·세션 경계를 Android 진입점들이 동일하게 사용한다. */
final class RemoteListenRequestPolicy {

    static final long REQUEST_TTL_MS = 60_000L;
    static final int DEFAULT_DURATION_SEC = 60;
    static final int MAX_DURATION_SEC = 60;

    private static final String[] TIMESTAMP_PATTERNS = {
        "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
        "yyyy-MM-dd'T'HH:mm:ssXXX",
        "yyyy-MM-dd HH:mm:ss.SSSXXX",
        "yyyy-MM-dd HH:mm:ssXXX",
        "yyyy-MM-dd HH:mm:ss.SSSX",
        "yyyy-MM-dd HH:mm:ssX"
    };

    private RemoteListenRequestPolicy() {}

    static int normalizeDurationSec(int durationSec) {
        if (durationSec < 5) return DEFAULT_DURATION_SEC;
        return Math.min(durationSec, MAX_DURATION_SEC);
    }

    static long effectiveExpiresAt(
            long receivedAtMs,
            long requestedAtMs,
            long explicitExpiresAtMs
    ) {
        if (receivedAtMs <= 0L) return 0L;
        long expiresAtMs = safeAdd(receivedAtMs, REQUEST_TTL_MS);
        if (requestedAtMs > 0L) {
            expiresAtMs = Math.min(expiresAtMs, safeAdd(requestedAtMs, REQUEST_TTL_MS));
        }
        if (explicitExpiresAtMs > 0L) {
            expiresAtMs = Math.min(expiresAtMs, explicitExpiresAtMs);
        }
        return expiresAtMs;
    }

    static boolean isFresh(
            long nowMs,
            long receivedAtMs,
            long requestedAtMs,
            long explicitExpiresAtMs
    ) {
        long expiresAtMs = effectiveExpiresAt(receivedAtMs, requestedAtMs, explicitExpiresAtMs);
        return expiresAtMs > 0L && nowMs >= receivedAtMs && nowMs <= expiresAtMs;
    }

    static boolean matchesContext(
            @Nullable String requestFamilyId,
            @Nullable String targetUserId,
            @Nullable String acceptedSessionNonce,
            @Nullable String currentFamilyId,
            @Nullable String currentUserId,
            @Nullable String currentSessionNonce
    ) {
        String requestFamily = clean(requestFamilyId);
        String targetUser = clean(targetUserId);
        String currentFamily = clean(currentFamilyId);
        String currentUser = clean(currentUserId);
        String acceptedNonce = clean(acceptedSessionNonce);
        String currentNonce = clean(currentSessionNonce);
        if (requestFamily.isEmpty() || targetUser.isEmpty()
                || currentFamily.isEmpty() || currentUser.isEmpty()
                || acceptedNonce.isEmpty() || currentNonce.isEmpty()) {
            return false;
        }
        if (!requestFamily.equals(currentFamily) || !targetUser.equals(currentUser)) {
            return false;
        }
        return acceptedNonce.equals(currentNonce);
    }

    static boolean matchesStop(
            @Nullable String activeRequestId,
            @Nullable String stopRequestId,
            @Nullable String activeTargetUserId,
            @Nullable String stopTargetUserId,
            @Nullable String activeSessionNonce,
            @Nullable String stopSessionNonce
    ) {
        String activeRequest = clean(activeRequestId);
        String requestedStop = clean(stopRequestId);
        String activeTarget = clean(activeTargetUserId);
        String stopTarget = clean(stopTargetUserId);
        String activeNonce = clean(activeSessionNonce);
        String stopNonce = clean(stopSessionNonce);
        if (activeRequest.isEmpty() || requestedStop.isEmpty()
                || activeTarget.isEmpty() || stopTarget.isEmpty()
                || activeNonce.isEmpty() || stopNonce.isEmpty()) {
            return false;
        }
        return activeRequest.equals(requestedStop)
            && activeTarget.equals(stopTarget)
            && activeNonce.equals(stopNonce);
    }

    static long parseTimestampMs(@Nullable String value) {
        String input = clean(value);
        if (input.isEmpty()) return 0L;
        for (String pattern : TIMESTAMP_PATTERNS) {
            SimpleDateFormat formatter = new SimpleDateFormat(pattern, Locale.US);
            formatter.setLenient(false);
            formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
            ParsePosition position = new ParsePosition(0);
            Date parsed = formatter.parse(input, position);
            if (parsed != null && position.getIndex() == input.length()) {
                return parsed.getTime();
            }
        }
        return 0L;
    }

    private static long safeAdd(long base, long delta) {
        if (base > Long.MAX_VALUE - delta) return Long.MAX_VALUE;
        return base + delta;
    }

    private static String clean(@Nullable String value) {
        return value == null ? "" : value.trim();
    }
}
