package com.hyeni.calendar;

/** FCM endpoint 충돌 복구가 현재 로그인 한 번에만 실행되도록 하는 순수 정책. */
final class FcmTokenConflictRecoveryPolicy {
    private FcmTokenConflictRecoveryPolicy() {}

    static boolean canStart(
        String expectedUserId,
        String expectedFamilyId,
        String expectedSessionNonce,
        String currentUserId,
        String currentFamilyId,
        String currentSessionNonce,
        String lastRotatedSessionNonce,
        boolean recoveryInFlight
    ) {
        String nonce = clean(expectedSessionNonce);
        return !recoveryInFlight
            && !nonce.isEmpty()
            && clean(expectedUserId).equals(clean(currentUserId))
            && clean(expectedFamilyId).equals(clean(currentFamilyId))
            && nonce.equals(clean(currentSessionNonce))
            && !nonce.equals(clean(lastRotatedSessionNonce));
    }

    static boolean hasChangedToken(String conflictedToken, String currentToken) {
        String current = clean(currentToken);
        return !current.isEmpty() && !current.equals(clean(conflictedToken));
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
