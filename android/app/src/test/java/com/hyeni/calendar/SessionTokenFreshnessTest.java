package com.hyeni.calendar;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.Test;

public class SessionTokenFreshnessTest {
    private static String jwt(String subject, long issuedAt) {
        return jwt(subject, issuedAt, "same");
    }

    private static String jwt(String subject, long issuedAt, String marker) {
        String payload = "{\"sub\":\"" + subject + "\",\"iat\":" + issuedAt
            + ",\"marker\":\"" + marker + "\"}";
        String encoded = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(payload.getBytes(StandardCharsets.UTF_8));
        return "header." + encoded + ".signature";
    }

    @Test
    public void rejectsOlderTokenForSameUser() {
        assertFalse(SessionTokenFreshness.shouldReplaceStored(
            jwt("child-1", 200),
            jwt("child-1", 100)
        ));
    }

    @Test
    public void rejectsAmbiguousSameSecondTokenByDefault() {
        assertFalse(SessionTokenFreshness.shouldReplaceStored(
            jwt("child-1", 200, "native"),
            jwt("child-1", 200, "web")
        ));
    }

    @Test
    public void acceptsSameSecondTokenOnlyForAuthoritativeServerRefresh() {
        assertTrue(SessionTokenFreshness.shouldReplaceStored(
            jwt("child-1", 200, "native"),
            jwt("child-1", 200, "web"),
            true
        ));
    }

    @Test
    public void acceptsSameAccessTokenSoItsRefreshPairCanAdvance() {
        String token = jwt("child-1", 200);
        assertTrue(SessionTokenFreshness.shouldReplaceStored(token, token));
    }

    @Test
    public void acceptsNewerTokenForSameUser() {
        assertTrue(SessionTokenFreshness.shouldReplaceStored(
            jwt("child-1", 100),
            jwt("child-1", 200)
        ));
    }

    @Test
    public void acceptsIntentionalUserChangeAndMissingStoredToken() {
        assertTrue(SessionTokenFreshness.shouldReplaceStored(
            jwt("child-1", 200),
            jwt("child-2", 100)
        ));
        assertTrue(SessionTokenFreshness.shouldReplaceStored("", jwt("child-1", 100)));
    }

    @Test
    public void acceptsUnparseableTokensForBackwardCompatibility() {
        assertTrue(SessionTokenFreshness.shouldReplaceStored("legacy", "next"));
    }
}
