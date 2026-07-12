package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class EventArrivalPolicyTest {
    @Test
    public void timingUsesMinutesElapsedAfterStart() {
        assertEquals(5, EventArrivalPolicy.minutesFromStart(10 * 60 + 5, 10 * 60));
        assertEquals(-5, EventArrivalPolicy.minutesFromStart(9 * 60 + 55, 10 * 60));
    }

    @Test
    public void staleOrInaccurateFixIsUnknown() {
        long now = 1_000_000L;
        assertEquals(
            EventArrivalPolicy.ArrivalDecision.UNKNOWN,
            EventArrivalPolicy.classify(300f, 20f, now - EventArrivalPolicy.MAX_FIX_AGE_MS - 1L, now, 80f)
        );
        assertEquals(
            EventArrivalPolicy.ArrivalDecision.UNKNOWN,
            EventArrivalPolicy.classify(300f, 151f, now - 1_000L, now, 80f)
        );
    }

    @Test
    public void uncertaintyCircleMustClearArrivalRadiusBeforeDeclaringAway() {
        long now = 1_000_000L;
        assertEquals(
            EventArrivalPolicy.ArrivalDecision.UNKNOWN,
            EventArrivalPolicy.classify(100f, 30f, now - 1_000L, now, 80f)
        );
        assertEquals(
            EventArrivalPolicy.ArrivalDecision.AWAY,
            EventArrivalPolicy.classify(111f, 30f, now - 1_000L, now, 80f)
        );
        assertEquals(
            EventArrivalPolicy.ArrivalDecision.AT_LOCATION,
            EventArrivalPolicy.classify(60f, 30f, now - 1_000L, now, 80f)
        );
    }
}
