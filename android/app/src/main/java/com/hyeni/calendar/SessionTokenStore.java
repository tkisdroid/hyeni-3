package com.hyeni.calendar;

import android.content.SharedPreferences;
import java.util.LinkedHashSet;

/** access/refresh 한 쌍의 최신성 비교와 SharedPreferences 저장을 한 임계구역에서 수행한다. */
final class SessionTokenStore {
    private static final String SESSION_NONCE = "sessionNonce";
    private static final String BLOCKED_SESSION_NONCES = "blockedSessionNonces";
    private static final int MAX_BLOCKED_SESSION_NONCES = 16;
    private static long generation = 0L;

    private SessionTokenStore() {}

    static final class Snapshot {
        final String accessToken;
        final String refreshToken;
        final boolean acceptedIncoming;

        Snapshot(String accessToken, String refreshToken, boolean acceptedIncoming) {
            this.accessToken = accessToken == null ? "" : accessToken;
            this.refreshToken = refreshToken == null ? "" : refreshToken;
            this.acceptedIncoming = acceptedIncoming;
        }
    }

    /**
     * 위치 서비스와 푸시 전달에 필요한 인증·대상 문맥의 한 시점 스냅샷이다.
     * 토큰과 identity를 따로 읽거나 저장하면 늦게 도착한 Intent가 새 토큰에 과거
     * user/family를 결합할 수 있으므로, 모든 필드는 같은 synchronized 구간에서 다룬다.
     */
    static final class ContextSnapshot {
        final String accessToken;
        final String refreshToken;
        final String userId;
        final String familyId;
        final String role;
        final String supabaseUrl;
        final String supabaseKey;
        final boolean serviceEnabled;
        final String locationIntervalMode;
        final boolean acceptedIncoming;

        ContextSnapshot(
            String accessToken,
            String refreshToken,
            String userId,
            String familyId,
            String role,
            String supabaseUrl,
            String supabaseKey,
            boolean serviceEnabled,
            String locationIntervalMode,
            boolean acceptedIncoming
        ) {
            this.accessToken = clean(accessToken);
            this.refreshToken = clean(refreshToken);
            this.userId = clean(userId);
            this.familyId = clean(familyId);
            this.role = clean(role);
            this.supabaseUrl = clean(supabaseUrl);
            this.supabaseKey = clean(supabaseKey);
            this.serviceEnabled = serviceEnabled;
            this.locationIntervalMode = normalizeIntervalMode(locationIntervalMode);
            this.acceptedIncoming = acceptedIncoming;
        }
    }

    static synchronized Snapshot reconcile(
        SharedPreferences prefs,
        String incomingAccess,
        String incomingRefresh,
        boolean authoritative,
        String incomingSessionNonce
    ) {
        String storedAccess = clean(prefs.getString("accessToken", ""));
        String storedRefresh = clean(prefs.getString("refreshToken", ""));
        String nextAccess = clean(incomingAccess);
        String nextRefresh = clean(incomingRefresh);
        String nextSessionNonce = clean(incomingSessionNonce);
        if (isBlockedSessionNonce(prefs, nextSessionNonce)) {
            return new Snapshot(storedAccess, storedRefresh, false);
        }
        boolean accept = !nextAccess.isEmpty()
            && SessionTokenFreshness.shouldReplaceStored(storedAccess, nextAccess, authoritative);
        if (!accept) return new Snapshot(storedAccess, storedRefresh, false);

        String resolvedRefresh = nextRefresh.isEmpty() ? storedRefresh : nextRefresh;
        SharedPreferences.Editor editor = prefs.edit()
            .putString("accessToken", nextAccess);
        if (!resolvedRefresh.isEmpty()) editor.putString("refreshToken", resolvedRefresh);
        if (!nextSessionNonce.isEmpty()) editor.putString(SESSION_NONCE, nextSessionNonce);
        editor.apply();
        return new Snapshot(nextAccess, resolvedRefresh, true);
    }

    /**
     * 토큰과 푸시/위치 identity를 하나의 editor로 승인·저장한다.
     * 거부 시에는 어떤 identity/config/service 플래그도 쓰지 않고 현재 스냅샷만 반환한다.
     */
    static synchronized ContextSnapshot reconcileContext(
        SharedPreferences prefs,
        String incomingAccess,
        String incomingRefresh,
        boolean authoritative,
        String incomingSessionNonce,
        String incomingUserId,
        String incomingFamilyId,
        String incomingRole,
        String incomingSupabaseUrl,
        String incomingSupabaseKey,
        boolean incomingServiceEnabled,
        String incomingLocationIntervalMode
    ) {
        ContextSnapshot stored = readContext(prefs);
        String nextAccess = clean(incomingAccess);
        String nextRefresh = clean(incomingRefresh);
        String nextSessionNonce = clean(incomingSessionNonce);
        String nextUserId = clean(incomingUserId);
        String nextFamilyId = clean(incomingFamilyId);
        String nextRole = clean(incomingRole);
        String nextSupabaseUrl = clean(incomingSupabaseUrl);
        String nextSupabaseKey = clean(incomingSupabaseKey);

        boolean completeContext = !nextUserId.isEmpty()
            && !nextFamilyId.isEmpty()
            && !nextRole.isEmpty()
            && !nextSupabaseUrl.isEmpty()
            && !nextSupabaseKey.isEmpty();
        boolean hasIncomingToken = !nextAccess.isEmpty() || !nextRefresh.isEmpty();
        if (!completeContext || !hasIncomingToken || isBlockedSessionNonce(prefs, nextSessionNonce)) {
            return stored;
        }

        boolean accept;
        if (!nextAccess.isEmpty()) {
            accept = SessionTokenFreshness.shouldReplaceStored(
                stored.accessToken,
                nextAccess,
                authoritative
            );
            // 동일 access token으로 다른 identity를 덮는 조합은 정상 로그인/refresh가 아니다.
            if (accept
                && nextAccess.equals(stored.accessToken)
                && !stored.userId.isEmpty()
                && !stored.userId.equals(nextUserId)) {
                accept = false;
            }
        } else {
            // access 없이 refresh만 들어오는 문맥은 저장소가 비어 있는 최초 복구에서만 허용한다.
            accept = stored.accessToken.isEmpty() && stored.refreshToken.isEmpty();
        }
        if (!accept) return stored;

        String resolvedAccess = nextAccess.isEmpty() ? stored.accessToken : nextAccess;
        String resolvedRefresh = nextRefresh.isEmpty() ? stored.refreshToken : nextRefresh;
        String resolvedIntervalMode = normalizeIntervalMode(incomingLocationIntervalMode);
        SharedPreferences.Editor editor = prefs.edit()
            .putString("accessToken", resolvedAccess)
            .putString("refreshToken", resolvedRefresh)
            .putString("userId", nextUserId)
            .putString("familyId", nextFamilyId)
            .putString("role", nextRole)
            .putString("supabaseUrl", nextSupabaseUrl)
            .putString("supabaseKey", nextSupabaseKey)
            .putBoolean("serviceEnabled", incomingServiceEnabled)
            .putString("locationIntervalMode", resolvedIntervalMode)
            .remove("kakaoRestKey");
        if (!nextSessionNonce.isEmpty()) editor.putString(SESSION_NONCE, nextSessionNonce);
        editor.apply();

        return new ContextSnapshot(
            resolvedAccess,
            resolvedRefresh,
            nextUserId,
            nextFamilyId,
            nextRole,
            nextSupabaseUrl,
            nextSupabaseKey,
            incomingServiceEnabled,
            resolvedIntervalMode,
            true
        );
    }

    static synchronized ContextSnapshot readContext(SharedPreferences prefs) {
        return new ContextSnapshot(
            prefs.getString("accessToken", ""),
            prefs.getString("refreshToken", ""),
            prefs.getString("userId", ""),
            prefs.getString("familyId", ""),
            prefs.getString("role", ""),
            prefs.getString("supabaseUrl", ""),
            prefs.getString("supabaseKey", ""),
            prefs.getBoolean("serviceEnabled", false),
            prefs.getString("locationIntervalMode", "balanced"),
            false
        );
    }

    static synchronized void setServiceEnabled(SharedPreferences prefs, boolean enabled) {
        prefs.edit().putBoolean("serviceEnabled", enabled).apply();
    }

    static synchronized Snapshot read(SharedPreferences prefs) {
        return new Snapshot(
            clean(prefs.getString("accessToken", "")),
            clean(prefs.getString("refreshToken", "")),
            false
        );
    }

    static synchronized long generation() {
        return generation;
    }

    /** refresh 요청 도중 명시적 로그아웃(clear)이 일어났으면 늦은 응답을 저장하지 않는다. */
    static synchronized Snapshot reconcileIfGeneration(
        SharedPreferences prefs,
        String incomingAccess,
        String incomingRefresh,
        boolean authoritative,
        long expectedGeneration,
        String expectedUserId,
        String expectedFamilyId,
        String expectedRole
    ) {
        if (generation != expectedGeneration) return null;
        ContextSnapshot context = readContext(prefs);
        if (context.accessToken.isEmpty() && context.refreshToken.isEmpty()) return null;
        if (!context.userId.equals(clean(expectedUserId))
                || !context.familyId.equals(clean(expectedFamilyId))
                || !context.role.equalsIgnoreCase(clean(expectedRole))) {
            return null;
        }
        return reconcile(
            prefs,
            incomingAccess,
            incomingRefresh,
            authoritative,
            clean(prefs.getString(SESSION_NONCE, ""))
        );
    }

    static synchronized void clear(SharedPreferences prefs, String requestedRetiringSessionNonce) {
        generation++;
        String retiringSessionNonce = clean(requestedRetiringSessionNonce);
        if (retiringSessionNonce.isEmpty()) {
            retiringSessionNonce = clean(prefs.getString(SESSION_NONCE, ""));
        }
        SharedPreferences.Editor editor = prefs.edit()
            .remove("userId")
            .remove("familyId")
            .remove("role")
            .remove("supabaseUrl")
            .remove("supabaseKey")
            .remove("accessToken")
            .remove("refreshToken")
            .remove(SESSION_NONCE)
            .putBoolean("serviceEnabled", false);
        if (!retiringSessionNonce.isEmpty()) {
            LinkedHashSet<String> blockedSessionNonces = readBlockedSessionNonces(prefs);
            blockedSessionNonces.remove(retiringSessionNonce);
            blockedSessionNonces.add(retiringSessionNonce);
            while (blockedSessionNonces.size() > MAX_BLOCKED_SESSION_NONCES) {
                blockedSessionNonces.remove(blockedSessionNonces.iterator().next());
            }
            editor.putString(BLOCKED_SESSION_NONCES, String.join("|", blockedSessionNonces));
        }
        editor.apply();
    }

    private static LinkedHashSet<String> readBlockedSessionNonces(SharedPreferences prefs) {
        LinkedHashSet<String> result = new LinkedHashSet<>();
        String encoded = clean(prefs.getString(BLOCKED_SESSION_NONCES, ""));
        if (encoded.isEmpty()) return result;
        for (String value : encoded.split("\\|")) {
            String nonce = clean(value);
            if (!nonce.isEmpty()) result.add(nonce);
        }
        return result;
    }

    private static boolean isBlockedSessionNonce(SharedPreferences prefs, String sessionNonce) {
        LinkedHashSet<String> blockedSessionNonces = readBlockedSessionNonces(prefs);
        return !blockedSessionNonces.isEmpty()
            && (clean(sessionNonce).isEmpty() || blockedSessionNonces.contains(clean(sessionNonce)));
    }

    private static String normalizeIntervalMode(String mode) {
        String value = clean(mode);
        if ("live".equals(value) || "saver".equals(value) || "balanced".equals(value)) {
            return value;
        }
        return "balanced";
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
