package com.hyeni.calendar;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class RegisteredPlaceScheduleOverlapPolicyTest {
    @Test
    public void suppressesRegisteredArrivalForNearbyActiveSchedule() {
        assertTrue(RegisteredPlaceScheduleOverlapPolicy.shouldSuppress(
            37.5165, 127.0200, 37.51655, 127.0200, 10 * 60, 10 * 60 + 30));
    }

    @Test
    public void keepsDifferentPlaceOrDistantTime() {
        assertFalse(RegisteredPlaceScheduleOverlapPolicy.shouldSuppress(
            37.5165, 127.0200, 37.5265, 127.0200, 10 * 60, 10 * 60));
        assertFalse(RegisteredPlaceScheduleOverlapPolicy.shouldSuppress(
            37.5165, 127.0200, 37.51655, 127.0200, 10 * 60, 12 * 60 + 1));
        assertFalse(RegisteredPlaceScheduleOverlapPolicy.shouldSuppress(
            37.5165, 127.0200, 37.51655, 127.0200, 10 * 60 + 16, 10 * 60));
        assertTrue(RegisteredPlaceScheduleOverlapPolicy.shouldSuppress(
            37.5165, 127.0200, 37.51655, 127.0200, 10 * 60 + 15, 10 * 60));
    }

    @Test
    public void choosesNearestScheduleWithStableTieBreak() {
        assertTrue(RegisteredPlaceScheduleOverlapPolicy.isBetterCandidate(
            10 * 60 + 5, "b", 9 * 60 + 10, "z", 10 * 60));
        assertTrue(RegisteredPlaceScheduleOverlapPolicy.isBetterCandidate(
            9 * 60 + 55, "a", 10 * 60 + 5, "b", 10 * 60));
        assertFalse(RegisteredPlaceScheduleOverlapPolicy.isBetterCandidate(
            10 * 60 + 5, "b", 9 * 60 + 55, "a", 10 * 60));
    }

    @Test
    public void associatesVeryEarlyArrivalWithoutCallingItScheduleArrival() {
        assertFalse(RegisteredPlaceScheduleOverlapPolicy.shouldSuppress(
            37.5165, 127.0200, 37.51655, 127.0200, 10 * 60 + 57, 10 * 60));
        assertTrue(RegisteredPlaceScheduleOverlapPolicy.shouldAssociate(
            37.5165, 127.0200, 37.51655, 127.0200, 10 * 60 + 57, 10 * 60));
    }
}
