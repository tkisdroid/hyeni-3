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
        LinkedHashSet<String> blockedSessionNonces = readBlockedSessionNonces(prefs);
        if (!blockedSessionNonces.isEmpty()
            && (nextSessionNonce.isEmpty() || blockedSessionNonces.contains(nextSessionNonce))) {
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
        long expectedGeneration
    ) {
        if (generation != expectedGeneration) return null;
        Snapshot stored = read(prefs);
        if (stored.accessToken.isEmpty() && stored.refreshToken.isEmpty()) return null;
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
            .remove("accessToken")
            .remove("refreshToken")
            .remove(SESSION_NONCE);
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

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
