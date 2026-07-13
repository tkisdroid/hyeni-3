package com.hyeni.calendar;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PendingRecoveryPolicyTest {
    @Test
    public void completeAuthenticatedParentOrChildContextRunsUnlockRecovery() {
        assertTrue(PendingRecoveryPolicy.shouldRun(
            "parent", "parent-1", "family-1", "https://api.example", "key", "access", ""
        ));
        assertTrue(PendingRecoveryPolicy.shouldRun(
            "PARENT", "parent-1", "family-1", "https://api.example", "key", "", "refresh"
        ));
        assertTrue(PendingRecoveryPolicy.shouldRun(
            "child", "child-1", "family-1", "https://api.example", "key", "access", "refresh"
        ));
        assertFalse(PendingRecoveryPolicy.shouldRun(
            "parent", "", "family-1", "https://api.example", "key", "access", "refresh"
        ));
        assertFalse(PendingRecoveryPolicy.shouldRun(
            "parent", "parent-1", "family-1", "https://api.example", "key", "", ""
        ));
    }
}
