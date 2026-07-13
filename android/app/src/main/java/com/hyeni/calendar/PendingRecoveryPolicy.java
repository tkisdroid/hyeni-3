package com.hyeni.calendar;

/** 잠금 해제 후 부모·아이 표시형 pending 알림 복구가 실행될 최소 인증 문맥. */
final class PendingRecoveryPolicy {
    private PendingRecoveryPolicy() {}

    static boolean shouldRun(
        String role,
        String userId,
        String familyId,
        String supabaseUrl,
        String supabaseKey,
        String accessToken,
        String refreshToken
    ) {
        String normalizedRole = clean(role);
        return ("parent".equalsIgnoreCase(normalizedRole) || "child".equalsIgnoreCase(normalizedRole))
            && !clean(userId).isEmpty()
            && !clean(familyId).isEmpty()
            && !clean(supabaseUrl).isEmpty()
            && !clean(supabaseKey).isEmpty()
            && (!clean(accessToken).isEmpty() || !clean(refreshToken).isEmpty());
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
