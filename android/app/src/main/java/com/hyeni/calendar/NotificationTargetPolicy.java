package com.hyeni.calendar;

import java.util.Collections;
import java.util.Map;

/** 수신 payload의 명시 대상을 현재 네이티브 세션과 대조하는 순수 정책. */
public final class NotificationTargetPolicy {

    private static final String[] USER_KEYS = {
        "targetUserId", "target_user_id"
    };
    private static final String[] FAMILY_KEYS = {
        "targetFamilyId", "target_family_id", "familyId", "family_id"
    };
    private static final String[] ROLE_KEYS = {
        "targetRole", "target_role"
    };

    public enum Decision {
        ALLOW,
        LOCAL_SESSION_MISSING,
        TARGET_MISSING,
        USER_MISMATCH,
        FAMILY_MISMATCH,
        ROLE_MISMATCH;

        public boolean allowsDelivery() {
            return this == ALLOW;
        }
    }

    private NotificationTargetPolicy() {}

    public static Decision evaluate(
            Map<String, String> payload,
            String localUserId,
            String localFamilyId,
            String localRole
    ) {
        Map<String, String> safePayload = payload != null ? payload : Collections.emptyMap();
        if (clean(localUserId).isEmpty()
                || clean(localFamilyId).isEmpty()
                || clean(localRole).isEmpty()) {
            return Decision.LOCAL_SESSION_MISSING;
        }
        // 현재 Worker가 발송하는 사용자별 알림은 user와 family 대상을 모두 포함한다.
        // 둘 중 하나라도 없는 레거시 payload는 새 로그인 세션에 잘못 전달될 수 있으므로 닫는다.
        if (!hasTarget(safePayload, USER_KEYS) || !hasTarget(safePayload, FAMILY_KEYS)) {
            return Decision.TARGET_MISSING;
        }
        if (!allTargetsMatch(safePayload, USER_KEYS, localUserId, false)) {
            return Decision.USER_MISMATCH;
        }
        if (!allTargetsMatch(safePayload, FAMILY_KEYS, localFamilyId, false)) {
            return Decision.FAMILY_MISMATCH;
        }
        if (!allTargetsMatch(safePayload, ROLE_KEYS, localRole, true)) {
            return Decision.ROLE_MISMATCH;
        }
        return Decision.ALLOW;
    }

    private static boolean allTargetsMatch(
            Map<String, String> payload,
            String[] keys,
            String localValue,
            boolean ignoreCase
    ) {
        String normalizedLocal = clean(localValue);
        for (String key : keys) {
            String target = clean(payload.get(key));
            if (target.isEmpty()) {
                continue;
            }
            if (normalizedLocal.isEmpty()) {
                return false;
            }
            boolean matches = ignoreCase
                ? target.equalsIgnoreCase(normalizedLocal)
                : target.equals(normalizedLocal);
            if (!matches) {
                return false;
            }
        }
        return true;
    }

    private static boolean hasTarget(Map<String, String> payload, String[] keys) {
        for (String key : keys) {
            if (!clean(payload.get(key)).isEmpty()) return true;
        }
        return false;
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
