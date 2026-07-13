package com.hyeni.calendar;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class NativePushTokenSyncTest {
    @Test
    public void networkRegistrationRequiresTheSameCapturedSessionContext() {
        assertTrue(NativePushTokenSync.isSameRegistrationContext(
            "user-a", "family-a", "session-a",
            "user-a", "family-a", "session-a"
        ));
        assertFalse(NativePushTokenSync.isSameRegistrationContext(
            "user-a", "family-a", "session-a",
            "user-a", "family-a", "session-new"
        ));
        assertFalse(NativePushTokenSync.isSameRegistrationContext(
            "user-a", "family-a", "session-a",
            "user-b", "family-a", "session-a"
        ));
        assertFalse(NativePushTokenSync.isSameRegistrationContext(
            "user-a", "family-a", "session-a",
            "user-a", "family-b", "session-a"
        ));
        assertFalse(NativePushTokenSync.isSameRegistrationContext(
            "user-a", "family-a", "",
            "user-a", "family-a", ""
        ));
    }

    @Test
    public void accessRefreshRetryIsLimitedToOne401WithARefreshToken() {
        assertTrue(NativePushTokenSync.isRefreshRetryEligible(401, false, "refresh-a"));
        assertFalse(NativePushTokenSync.isRefreshRetryEligible(401, true, "refresh-a"));
        assertFalse(NativePushTokenSync.isRefreshRetryEligible(403, false, "refresh-a"));
        assertFalse(NativePushTokenSync.isRefreshRetryEligible(500, false, "refresh-a"));
        assertFalse(NativePushTokenSync.isRefreshRetryEligible(401, false, ""));
    }

    @Test
    public void refreshResponseMustStillBelongToTheCapturedSessionAndRefreshChain() {
        assertTrue(NativePushTokenSync.isSameRefreshContext(
            "user-a", "family-a", "child", "session-a", "refresh-a",
            "user-a", "family-a", "child", "session-a", "refresh-a"
        ));
        assertFalse(NativePushTokenSync.isSameRefreshContext(
            "user-a", "family-a", "child", "session-a", "refresh-a",
            "user-a", "family-a", "child", "session-new", "refresh-a"
        ));
        assertFalse(NativePushTokenSync.isSameRefreshContext(
            "user-a", "family-a", "child", "session-a", "refresh-a",
            "user-a", "family-a", "child", "session-a", "refresh-new"
        ));
        assertFalse(NativePushTokenSync.isSameRefreshContext(
            "user-a", "family-a", "child", "session-a", "refresh-a",
            "user-b", "family-a", "child", "session-a", "refresh-a"
        ));
    }
}
