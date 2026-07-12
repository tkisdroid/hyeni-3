package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class LocationFixPolicyTest {

    @Test
    public void resolveCapturedAtMs_preservesProviderFixTime() {
        long receivedAtMs = 1_000_000L;
        assertEquals(940_000L, LocationFixPolicy.resolveCapturedAtMs(940_000L, receivedAtMs));
    }

    @Test
    public void resolveCapturedAtMs_clampsFutureClockSkew() {
        long receivedAtMs = 1_000_000L;
        assertEquals(receivedAtMs, LocationFixPolicy.resolveCapturedAtMs(1_030_000L, receivedAtMs));
    }

    @Test
    public void resolveCapturedAtMs_prefersMonotonicElapsedAge() {
        long receivedAtMs = 1_000_000L;
        long receivedElapsedNanos = 50_000_000_000L;
        long fixElapsedNanos = 47_500_000_000L;
        assertEquals(
            997_500L,
            LocationFixPolicy.resolveCapturedAtMs(
                1_500_000L,
                fixElapsedNanos,
                receivedAtMs,
                receivedElapsedNanos
            )
        );
    }

    @Test
    public void liveRefresh_rejectsOldLastKnownButAcceptsRecentNetworkFix() {
        long receivedAtMs = 1_000_000L;
        assertTrue(LocationFixPolicy.isFreshForLiveRefresh(950_000L, receivedAtMs));
        assertFalse(LocationFixPolicy.isFreshForLiveRefresh(800_000L, receivedAtMs));
    }

    @Test
    public void resolveFixAgeMs_neverReturnsNegativeAge() {
        assertEquals(2_500L, LocationFixPolicy.resolveFixAgeMs(997_500L, 1_000_000L));
        assertEquals(0L, LocationFixPolicy.resolveFixAgeMs(1_100_000L, 1_000_000L));
    }

    @Test
    public void outOfOrder_rejectsOnlyStrictlyOlderFix() {
        assertTrue(LocationFixPolicy.isOutOfOrder(900_000L, 950_000L));
        assertFalse(LocationFixPolicy.isOutOfOrder(950_000L, 950_000L));
        assertFalse(LocationFixPolicy.isOutOfOrder(960_000L, 950_000L));
    }

    @Test
    public void outOfOrder_usesElapsedRealtimeWhenWallClockMovesBackward() {
        assertFalse(LocationFixPolicy.isOutOfOrder(
            800_000L,
            950_000L,
            52_000_000_000L,
            50_000_000_000L
        ));
        assertTrue(LocationFixPolicy.isOutOfOrder(
            1_100_000L,
            950_000L,
            49_000_000_000L,
            50_000_000_000L
        ));
    }

    @Test
    public void duplicateFix_rejectsTrackingCopyAfterForcedRefresh() {
        assertTrue(LocationFixPolicy.isDuplicateAcceptedFix(
            1_000_000L, 1_000_000L, 50_000L, 50_000L, false, true
        ));
        assertTrue(LocationFixPolicy.isDuplicateAcceptedFix(
            1_000_000L, 1_000_000L, 50_000L, 50_000L, true, true
        ));
        assertFalse(LocationFixPolicy.isDuplicateAcceptedFix(
            1_000_000L, 1_000_000L, 50_000L, 50_000L, true, false
        ));
    }
}
