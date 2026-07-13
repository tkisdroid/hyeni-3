package com.hyeni.calendar;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class WebViewOriginPolicyTest {
    @Test
    public void allowsOnlyPackagedHttpsLocalhostOrigin() {
        assertTrue(WebViewOriginPolicy.isTrusted("https://localhost"));
        assertTrue(WebViewOriginPolicy.isTrusted("https://localhost/"));
        assertTrue(WebViewOriginPolicy.isTrusted("https://localhost:443"));

        assertFalse(WebViewOriginPolicy.isTrusted("http://localhost"));
        assertFalse(WebViewOriginPolicy.isTrusted("https://localhost.evil.example"));
        assertFalse(WebViewOriginPolicy.isTrusted("https://user@localhost"));
        assertFalse(WebViewOriginPolicy.isTrusted("https://hyeni-calendar-api.tkisdroid.workers.dev"));
        assertFalse(WebViewOriginPolicy.isTrusted("https://dapi.kakao.com"));
        assertFalse(WebViewOriginPolicy.isTrusted("javascript:alert(1)"));
        assertFalse(WebViewOriginPolicy.isTrusted(null));
    }
}
