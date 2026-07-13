package com.hyeni.calendar;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class FcmTokenConflictRecoveryPolicyTest {
    @Test
    public void rotationStartsOnlyForTheCurrentUnretiredSession() {
        assertTrue(FcmTokenConflictRecoveryPolicy.canStart(
            "user-b", "family-b", "session-b",
            "user-b", "family-b", "session-b",
            "", false
        ));
        assertFalse(FcmTokenConflictRecoveryPolicy.canStart(
            "user-b", "family-b", "session-b",
            "user-a", "family-b", "session-b",
            "", false
        ));
        assertFalse(FcmTokenConflictRecoveryPolicy.canStart(
            "user-b", "family-b", "session-b",
            "user-b", "family-b", "session-old",
            "", false
        ));
        assertFalse(FcmTokenConflictRecoveryPolicy.canStart(
            "user-b", "family-b", "session-b",
            "user-b", "family-b", "session-b",
            "session-b", false
        ));
        assertFalse(FcmTokenConflictRecoveryPolicy.canStart(
            "user-b", "family-b", "session-b",
            "user-b", "family-b", "session-b",
            "", true
        ));
    }

    @Test
    public void anAlreadyChangedTokenIsReusedWithoutDeletingItAgain() {
        assertTrue(FcmTokenConflictRecoveryPolicy.hasChangedToken("old-token", "new-token"));
        assertFalse(FcmTokenConflictRecoveryPolicy.hasChangedToken("old-token", "old-token"));
        assertFalse(FcmTokenConflictRecoveryPolicy.hasChangedToken("old-token", ""));
    }
}
