package com.hyeni.calendar;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertEquals;

import java.lang.reflect.Method;

import org.junit.Test;

public class RemoteListenRequestPolicyTest {

    private static Object invoke(String methodName, Class<?>[] parameterTypes, Object... args)
            throws Exception {
        Class<?> policy = Class.forName("com.hyeni.calendar.RemoteListenRequestPolicy");
        Method method = policy.getDeclaredMethod(methodName, parameterTypes);
        method.setAccessible(true);
        return method.invoke(null, args);
    }

    @Test
    public void captureDurationNeverExceedsOneMinute() throws Exception {
        assertEquals(60, invoke("normalizeDurationSec", new Class<?>[]{ int.class }, 0));
        assertEquals(5, invoke("normalizeDurationSec", new Class<?>[]{ int.class }, 5));
        assertEquals(60, invoke("normalizeDurationSec", new Class<?>[]{ int.class }, 60));
        assertEquals(60, invoke("normalizeDurationSec", new Class<?>[]{ int.class }, 120));
    }

    @Test
    public void requestExpiresAtTheEarlierOfServerExpiryAndSixtySeconds() throws Exception {
        long receivedAt = 1_000_000L;
        long requestedAt = receivedAt - 5_000L;
        assertEquals(
            requestedAt + 60_000L,
            invoke(
                "effectiveExpiresAt",
                new Class<?>[]{ long.class, long.class, long.class },
                receivedAt,
                requestedAt,
                0L
            )
        );
        assertEquals(
            receivedAt + 20_000L,
            invoke(
                "effectiveExpiresAt",
                new Class<?>[]{ long.class, long.class, long.class },
                receivedAt,
                requestedAt,
                receivedAt + 20_000L
            )
        );
        assertTrue((Boolean) invoke(
            "isFresh",
            new Class<?>[]{ long.class, long.class, long.class, long.class },
            receivedAt + 19_999L,
            receivedAt,
            requestedAt,
            receivedAt + 20_000L
        ));
        assertFalse((Boolean) invoke(
            "isFresh",
            new Class<?>[]{ long.class, long.class, long.class, long.class },
            receivedAt + 20_001L,
            receivedAt,
            requestedAt,
            receivedAt + 20_000L
        ));
    }

    @Test
    public void parsesBothIsoAndWorkerPendingTimestamps() throws Exception {
        long iso = (Long) invoke(
            "parseTimestampMs",
            new Class<?>[]{ String.class },
            "2026-07-14T03:04:05.678Z"
        );
        long worker = (Long) invoke(
            "parseTimestampMs",
            new Class<?>[]{ String.class },
            "2026-07-14 03:04:05.678+00"
        );
        assertTrue(iso > 0L);
        assertEquals(iso, worker);
        assertEquals(0L, invoke(
            "parseTimestampMs",
            new Class<?>[]{ String.class },
            "not-a-time"
        ));
    }

    @Test
    public void consentIsBoundToFamilyTargetAndLoginSession() throws Exception {
        Class<?>[] types = {
            String.class, String.class, String.class,
            String.class, String.class, String.class
        };
        assertTrue((Boolean) invoke(
            "matchesContext",
            types,
            "family-1", "child-1", "session-1",
            "family-1", "child-1", "session-1"
        ));
        assertFalse((Boolean) invoke(
            "matchesContext",
            types,
            "family-1", "child-2", "session-1",
            "family-1", "child-1", "session-1"
        ));
        assertFalse((Boolean) invoke(
            "matchesContext",
            types,
            "family-1", "child-1", "session-old",
            "family-1", "child-1", "session-new"
        ));
        assertFalse((Boolean) invoke(
            "matchesContext",
            types,
            "family-1", "", "session-1",
            "family-1", "child-1", "session-1"
        ));
        assertFalse((Boolean) invoke(
            "matchesContext",
            types,
            "family-1", "child-1", "",
            "family-1", "child-1", ""
        ));
    }

    @Test
    public void stopOnlyMatchesTheActiveRequestTargetAndSession() throws Exception {
        Class<?>[] types = {
            String.class, String.class,
            String.class, String.class,
            String.class, String.class
        };
        assertTrue((Boolean) invoke(
            "matchesStop",
            types,
            "request-1", "request-1",
            "child-1", "child-1",
            "session-1", "session-1"
        ));
        assertFalse((Boolean) invoke(
            "matchesStop",
            types,
            "request-1", "request-2",
            "child-1", "child-1",
            "session-1", "session-1"
        ));
        assertFalse((Boolean) invoke(
            "matchesStop",
            types,
            "request-1", "request-1",
            "child-1", "child-2",
            "session-1", "session-1"
        ));
        assertFalse((Boolean) invoke(
            "matchesStop",
            types,
            "request-1", "request-1",
            "child-1", "child-1",
            "session-1", "session-2"
        ));
        assertFalse((Boolean) invoke(
            "matchesStop",
            types,
            "request-1", "request-1",
            "child-1", "child-1",
            "", ""
        ));
    }
}
