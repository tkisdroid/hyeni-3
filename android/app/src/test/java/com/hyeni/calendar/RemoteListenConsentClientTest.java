package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import org.junit.Test;

public class RemoteListenConsentClientTest {

    private static String jwtWithExpiry(long expiresAtSeconds) {
        String payload = "{\"sub\":\"child-1\",\"iat\":100,\"exp\":" + expiresAtSeconds + "}";
        String encoded = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(payload.getBytes(StandardCharsets.UTF_8));
        return "header." + encoded + ".signature";
    }

    @Test
    public void successfulResponseRequiresServerCaptureExpiry() {
        RemoteListenConsentClient.Result success = RemoteListenConsentClient.parseResponse(
            200,
            "{\"capture_expires_at_ms\":4070908910000}"
        );
        assertTrue(success.isSuccess());
        assertEquals(4070908910000L, success.getCaptureExpiresAtMs());

        assertFalse(RemoteListenConsentClient.parseResponse(200, "{}").isSuccess());
        assertFalse(RemoteListenConsentClient.parseResponse(409, "{}").isSuccess());
    }

    @Test
    public void captureDeadlineNeverExceedsServerExpiryOrSixtySeconds() {
        assertEquals(
            160_000L,
            RemoteListenConsentClient.captureDeadlineMs(100_000L, 160_500L)
        );
        assertEquals(
            140_000L,
            RemoteListenConsentClient.captureDeadlineMs(100_000L, 140_000L)
        );
        assertEquals(0L, RemoteListenConsentClient.captureDeadlineMs(100_000L, 99_999L));
    }

    @Test
    public void onlyFirstUnauthorizedResponseCanTriggerRefreshRetry() {
        assertTrue(RemoteListenConsentClient.shouldRetryAfterUnauthorized(401, false));
        assertFalse(RemoteListenConsentClient.shouldRetryAfterUnauthorized(401, true));
        assertFalse(RemoteListenConsentClient.shouldRetryAfterUnauthorized(403, false));
        assertFalse(RemoteListenConsentClient.shouldRetryAfterUnauthorized(500, false));
    }

    @Test
    public void refreshResultMustBelongToSameIdentityAndSessionNonce() {
        assertTrue(RemoteListenConsentClient.matchesRefreshSession(
            "child-1", "family-1", "child", "nonce-1",
            "child-1", "family-1", "child", "nonce-1"
        ));
        assertFalse(RemoteListenConsentClient.matchesRefreshSession(
            "child-1", "family-1", "child", "nonce-1",
            "child-1", "family-1", "child", "nonce-2"
        ));
        assertFalse(RemoteListenConsentClient.matchesRefreshSession(
            "child-1", "family-1", "child", "nonce-1",
            "child-2", "family-1", "child", "nonce-1"
        ));
    }

    @Test
    public void accessTokenMustRemainValidForCaptureAndNetworkSettleWindow() {
        long nowMs = 1_000_000L;
        assertFalse(RemoteListenConsentClient.requiresRefreshForCapture(
            jwtWithExpiry((nowMs + 90_000L) / 1000L), nowMs
        ));
        assertTrue(RemoteListenConsentClient.requiresRefreshForCapture(
            jwtWithExpiry((nowMs + 60_000L) / 1000L), nowMs
        ));
        assertTrue(RemoteListenConsentClient.requiresRefreshForCapture("not-a-jwt", nowMs));
    }
}
