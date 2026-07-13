package com.hyeni.calendar;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.Nullable;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * 원격청취 요청의 로컬 상태 저장소.
 *
 * 알림 표시 → 아이 수락 → 캡처 서비스의 승인 증표 1회 소비 순서를 강제한다.
 * requestId뿐 아니라 family/target/sessionNonce를 함께 저장해 로그아웃·계정 전환 뒤
 * 남은 알림이나 지연 Intent가 새 세션의 마이크를 시작하지 못하게 한다.
 */
final class RemoteListenRequestStore {

    private static final String PREFS_NAME = "hyeni_remote_listen_requests";
    private static final String STATE_PENDING = "pending";
    private static final String STATE_ACCEPTED = "accepted";
    private static final String STATE_STARTED = "started";
    private static final String STATE_DECLINED = "declined";
    private static final String STATE_EXPIRED = "expired";
    private static final String STATE_FINISHED = "finished";
    private static final long RETENTION_MS = TimeUnit.DAYS.toMillis(1);

    enum PendingStatus {
        READY,
        MISSING,
        EXPIRED,
        ALREADY_HANDLED,
        CONTEXT_MISMATCH
    }

    private RemoteListenRequestStore() {}

    static synchronized boolean markNotificationShown(
            Context context,
            @Nullable String requestId,
            long receivedAtMs,
            long requestedAtMs,
            long explicitExpiresAtMs,
            @Nullable String familyId,
            @Nullable String targetUserId,
            @Nullable String sessionNonce
    ) {
        if (context == null || isBlank(requestId) || isBlank(familyId) || isBlank(targetUserId)) {
            return false;
        }
        long nowMs = System.currentTimeMillis();
        if (!RemoteListenRequestPolicy.isFresh(
                nowMs,
                receivedAtMs,
                requestedAtMs,
                explicitExpiresAtMs)) {
            return false;
        }

        SharedPreferences prefs = prefs(context);
        pruneExpiredEntries(prefs, nowMs);
        String prefix = prefixFor(requestId);
        if (!prefs.getString(prefix + "state", "").isEmpty()) {
            return false;
        }
        return prefs.edit()
            .putString(prefix + "requestId", clean(requestId))
            .putString(prefix + "state", STATE_PENDING)
            .putLong(prefix + "receivedAt", receivedAtMs)
            .putLong(prefix + "requestedAt", requestedAtMs)
            .putLong(prefix + "explicitExpiresAt", explicitExpiresAtMs)
            .putString(prefix + "familyId", clean(familyId))
            .putString(prefix + "targetUserId", clean(targetUserId))
            .putString(prefix + "sessionNonce", clean(sessionNonce))
            .putLong(prefix + "updatedAt", nowMs)
            .commit();
    }

    static synchronized boolean isKnown(Context context, @Nullable String requestId) {
        if (context == null || isBlank(requestId)) return false;
        String prefix = prefixFor(requestId);
        SharedPreferences prefs = prefs(context);
        return clean(requestId).equals(prefs.getString(prefix + "requestId", ""))
            && !prefs.getString(prefix + "state", "").isEmpty();
    }

    static synchronized PendingStatus inspectPending(
            Context context,
            @Nullable String requestId,
            @Nullable String currentFamilyId,
            @Nullable String currentUserId,
            @Nullable String currentSessionNonce,
            long nowMs
    ) {
        if (context == null || isBlank(requestId)) return PendingStatus.MISSING;
        SharedPreferences prefs = prefs(context);
        String prefix = prefixFor(requestId);
        if (!clean(requestId).equals(prefs.getString(prefix + "requestId", ""))) {
            return PendingStatus.MISSING;
        }
        String state = prefs.getString(prefix + "state", "");
        if (state.isEmpty()) return PendingStatus.MISSING;
        if (!STATE_PENDING.equals(state)) return PendingStatus.ALREADY_HANDLED;

        long receivedAtMs = prefs.getLong(prefix + "receivedAt", 0L);
        long requestedAtMs = prefs.getLong(prefix + "requestedAt", 0L);
        long explicitExpiresAtMs = prefs.getLong(prefix + "explicitExpiresAt", 0L);
        if (!RemoteListenRequestPolicy.isFresh(
                nowMs,
                receivedAtMs,
                requestedAtMs,
                explicitExpiresAtMs)) {
            updateState(prefs, prefix, STATE_EXPIRED, nowMs, "");
            return PendingStatus.EXPIRED;
        }

        if (!RemoteListenRequestPolicy.matchesContext(
                prefs.getString(prefix + "familyId", ""),
                prefs.getString(prefix + "targetUserId", ""),
                prefs.getString(prefix + "sessionNonce", ""),
                currentFamilyId,
                currentUserId,
                currentSessionNonce)) {
            return PendingStatus.CONTEXT_MISMATCH;
        }
        return PendingStatus.READY;
    }

    @Nullable
    static synchronized String accept(
            Context context,
            @Nullable String requestId,
            @Nullable String currentFamilyId,
            @Nullable String currentUserId,
            @Nullable String currentSessionNonce,
            long nowMs
    ) {
        if (inspectPending(
                context,
                requestId,
                currentFamilyId,
                currentUserId,
                currentSessionNonce,
                nowMs) != PendingStatus.READY) {
            return null;
        }
        SharedPreferences prefs = prefs(context);
        String prefix = prefixFor(requestId);
        String consentToken = UUID.randomUUID().toString();
        if (!updateState(prefs, prefix, STATE_ACCEPTED, nowMs, consentToken)) {
            return null;
        }
        return consentToken;
    }

    static synchronized boolean consumeAcceptance(
            Context context,
            @Nullable String requestId,
            @Nullable String consentToken,
            @Nullable String currentFamilyId,
            @Nullable String currentUserId,
            @Nullable String currentSessionNonce,
            long serverCaptureExpiresAtMs,
            long nowMs
    ) {
        if (context == null || isBlank(requestId) || isBlank(consentToken)) return false;
        SharedPreferences prefs = prefs(context);
        String prefix = prefixFor(requestId);
        if (!clean(requestId).equals(prefs.getString(prefix + "requestId", ""))
                || !STATE_ACCEPTED.equals(prefs.getString(prefix + "state", ""))
                || !clean(consentToken).equals(prefs.getString(prefix + "consentToken", ""))) {
            return false;
        }
        long storedCaptureExpiresAtMs = prefs.getLong(prefix + "serverCaptureExpiresAt", 0L);
        boolean serverConsentFresh = serverCaptureExpiresAtMs > nowMs
            && storedCaptureExpiresAtMs == serverCaptureExpiresAtMs;
        if (!serverConsentFresh) {
            updateState(prefs, prefix, STATE_EXPIRED, nowMs, "");
            return false;
        }
        if (!RemoteListenRequestPolicy.matchesContext(
                prefs.getString(prefix + "familyId", ""),
                prefs.getString(prefix + "targetUserId", ""),
                prefs.getString(prefix + "sessionNonce", ""),
                currentFamilyId,
                currentUserId,
                currentSessionNonce)) {
            return false;
        }
        return updateState(prefs, prefix, STATE_STARTED, nowMs, "");
    }

    static synchronized boolean confirmServerConsent(
            Context context,
            @Nullable String requestId,
            @Nullable String consentToken,
            long captureExpiresAtMs,
            long nowMs
    ) {
        if (context == null || isBlank(requestId) || isBlank(consentToken)
                || captureExpiresAtMs <= nowMs) {
            return false;
        }
        SharedPreferences prefs = prefs(context);
        String prefix = prefixFor(requestId);
        if (!clean(requestId).equals(prefs.getString(prefix + "requestId", ""))
                || !STATE_ACCEPTED.equals(prefs.getString(prefix + "state", ""))
                || !clean(consentToken).equals(prefs.getString(prefix + "consentToken", ""))) {
            return false;
        }
        return prefs.edit()
            .putLong(prefix + "serverConsentedAt", nowMs)
            .putLong(prefix + "serverCaptureExpiresAt", captureExpiresAtMs)
            .putLong(prefix + "updatedAt", nowMs)
            .commit();
    }

    static synchronized void markDeclined(Context context, @Nullable String requestId, String reason) {
        markTerminal(context, requestId, STATE_DECLINED, reason);
    }

    static synchronized void markExpired(Context context, @Nullable String requestId) {
        markTerminal(context, requestId, STATE_EXPIRED, "expired");
    }

    static synchronized void markFinished(Context context, @Nullable String requestId, String reason) {
        markTerminal(context, requestId, STATE_FINISHED, reason);
    }

    static synchronized long effectiveExpiresAt(Context context, @Nullable String requestId) {
        if (context == null || isBlank(requestId)) return 0L;
        SharedPreferences prefs = prefs(context);
        String prefix = prefixFor(requestId);
        return RemoteListenRequestPolicy.effectiveExpiresAt(
            prefs.getLong(prefix + "receivedAt", 0L),
            prefs.getLong(prefix + "requestedAt", 0L),
            prefs.getLong(prefix + "explicitExpiresAt", 0L)
        );
    }

    private static void markTerminal(
            Context context,
            @Nullable String requestId,
            String state,
            String reason
    ) {
        if (context == null || isBlank(requestId)) return;
        SharedPreferences prefs = prefs(context);
        String prefix = prefixFor(requestId);
        if (!clean(requestId).equals(prefs.getString(prefix + "requestId", ""))) return;
        updateState(prefs, prefix, state, System.currentTimeMillis(), "", reason);
    }

    private static boolean updateState(
            SharedPreferences prefs,
            String prefix,
            String state,
            long nowMs,
            String consentToken
    ) {
        return updateState(prefs, prefix, state, nowMs, consentToken, "");
    }

    private static boolean updateState(
            SharedPreferences prefs,
            String prefix,
            String state,
            long nowMs,
            String consentToken,
            String reason
    ) {
        SharedPreferences.Editor editor = prefs.edit()
            .putString(prefix + "state", state)
            .putString(prefix + "consentToken", consentToken)
            .putLong(prefix + "updatedAt", nowMs);
        if (!isBlank(reason)) editor.putString(prefix + "reason", reason);
        return editor.commit();
    }

    private static void pruneExpiredEntries(SharedPreferences prefs, long nowMs) {
        ArrayList<String> prefixes = new ArrayList<>();
        for (Map.Entry<String, ?> entry : prefs.getAll().entrySet()) {
            String key = entry.getKey();
            if (!key.endsWith("updatedAt") || !(entry.getValue() instanceof Long)) continue;
            long updatedAtMs = (Long) entry.getValue();
            if (updatedAtMs <= 0L || nowMs - updatedAtMs <= RETENTION_MS) continue;
            prefixes.add(key.substring(0, key.length() - "updatedAt".length()));
        }
        if (prefixes.isEmpty()) return;
        SharedPreferences.Editor editor = prefs.edit();
        for (String prefix : prefixes) {
            for (String key : prefs.getAll().keySet()) {
                if (key.startsWith(prefix)) editor.remove(key);
            }
        }
        editor.apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static String prefixFor(@Nullable String requestId) {
        String value = clean(requestId);
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : bytes) hex.append(String.format(Locale.US, "%02x", b));
            return "request." + hex + ".";
        } catch (Exception ignored) {
            return "request." + Integer.toHexString(value.hashCode()) + ".";
        }
    }

    private static String clean(@Nullable String value) {
        return value == null ? "" : value.trim();
    }

    private static boolean isBlank(@Nullable String value) {
        return value == null || value.trim().isEmpty();
    }
}
