package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;

import com.hyeni.calendar.GeofenceStateMachine.Action;
import com.hyeni.calendar.GeofenceStateMachine.GeofenceConfig;
import com.hyeni.calendar.GeofenceStateMachine.GeofenceState;
import com.hyeni.calendar.GeofenceStateMachine.TransitionResult;

import org.junit.Test;

/**
 * GeofenceStateMachine 5층 방어 단위 테스트. 핵심 시퀀스는
 * tests/serverRegisteredPlaceGeofence.test.js 와 동일한 전이를 1:1 복제해
 * 클라/서버/네이티브 parity 를 보장한다.
 */
public class GeofenceStateMachineTest {

    private static final double PLACE_LAT = 37.5, PLACE_LNG = 127.0;
    private static final GeofenceConfig CFG = GeofenceConfig.DEFAULT; // 30/50/75, dwell60s, cooldown600s, dep180s
    private static final double INSIDE_LAT = 37.5, INSIDE_LNG = 127.0;      // dist 0 (< entry 30)
    private static final double OUTSIDE_LAT = 37.5 + 0.001, OUTSIDE_LNG = 127.0; // ~111m (> exit 50)

    private TransitionResult step(GeofenceState s, boolean inside, long tMs) {
        double lat = inside ? INSIDE_LAT : OUTSIDE_LAT;
        double lng = inside ? INSIDE_LNG : OUTSIDE_LNG;
        return GeofenceStateMachine.evaluateTransition(s, lat, lng, null, tMs, PLACE_LAT, PLACE_LNG, 30.0, CFG);
    }

    @Test
    public void bootstrapInitialInside_startsAsIn_withoutEnterAlert() {
        GeofenceState bootstrapped = GeofenceStateMachine.bootstrapInitialInside(
                GeofenceState.INITIAL, INSIDE_LAT, INSIDE_LNG, null, 1_000L,
                PLACE_LAT, PLACE_LNG, 30.0, CFG);

        assertEquals("in", bootstrapped.phase);
        assertEquals(Long.valueOf(1_000L), bootstrapped.firstInsideAtMs);
        TransitionResult r = step(bootstrapped, true, 61_000L);
        assertEquals(Action.INSIDE_NO_CHANGE, r.action);
    }

    @Test
    public void bootstrapInitialInside_keepsOut_whenFirstFixOutside() {
        GeofenceState bootstrapped = GeofenceStateMachine.bootstrapInitialInside(
                GeofenceState.INITIAL, OUTSIDE_LAT, OUTSIDE_LNG, null, 1_000L,
                PLACE_LAT, PLACE_LNG, 30.0, CFG);

        assertEquals("out", bootstrapped.phase);
        assertEquals(null, bootstrapped.firstInsideAtMs);
    }

    @Test
    public void bootstrapInitialInside_doesNotOverwriteNonPristineOutState() {
        GeofenceState afterLeave = new GeofenceState("out", null, null, 10_000L);
        GeofenceState bootstrapped = GeofenceStateMachine.bootstrapInitialInside(
                afterLeave, INSIDE_LAT, INSIDE_LNG, null, 30_000L,
                PLACE_LAT, PLACE_LNG, 30.0, CFG);

        assertEquals("out", bootstrapped.phase);
        assertEquals(Long.valueOf(10_000L), bootstrapped.lastDepartedAtMs);
    }

    @Test
    public void fullSequence_out_pending_enter_inside_armed_timer_leave_silentReenter() {
        GeofenceState s = GeofenceState.INITIAL;

        // 1. inside @0 → PENDING_DWELL
        TransitionResult r = step(s, true, 0L);
        assertEquals(Action.PENDING_DWELL, r.action);
        assertEquals("pending", r.nextState.phase);
        s = r.nextState;

        // 2. inside @30s → dwell 30s<60s → PENDING_CONTINUE
        r = step(s, true, 30_000L);
        assertEquals(Action.PENDING_CONTINUE, r.action);
        s = r.nextState;

        // 3. inside @60s → dwell satisfied → ENTER
        r = step(s, true, 60_000L);
        assertEquals(Action.ENTER, r.action);
        assertEquals("in", r.nextState.phase);
        s = r.nextState;

        // 4. inside @70s → INSIDE_NO_CHANGE
        r = step(s, true, 70_000L);
        assertEquals(Action.INSIDE_NO_CHANGE, r.action);
        s = r.nextState;

        // 5. outside @80s → OUTSIDE_ARMED
        r = step(s, false, 80_000L);
        assertEquals(Action.OUTSIDE_ARMED, r.action);
        assertEquals(Long.valueOf(80_000L), r.nextState.departureArmedAtMs);
        s = r.nextState;

        // 6. outside @200s → departure 120s<180s → OUTSIDE_PENDING_TIMER
        r = step(s, false, 200_000L);
        assertEquals(Action.OUTSIDE_PENDING_TIMER, r.action);
        s = r.nextState;

        // 7. outside @300s → departure 220s>=180s → LEAVE
        r = step(s, false, 300_000L);
        assertEquals(Action.LEAVE, r.action);
        assertEquals("out", r.nextState.phase);
        assertEquals(Long.valueOf(300_000L), r.nextState.lastDepartedAtMs);
        s = r.nextState;

        // 8. inside @350s → cooldown 50s<600s → SILENT_RE_ENTER (no ENTER alert)
        r = step(s, true, 350_000L);
        assertEquals(Action.SILENT_RE_ENTER, r.action);
        assertEquals("in", r.nextState.phase);
    }

    @Test
    public void lowAccuracy_isIgnored() {
        TransitionResult r = GeofenceStateMachine.evaluateTransition(
                GeofenceState.INITIAL, INSIDE_LAT, INSIDE_LNG, 200.0, 0L, PLACE_LAT, PLACE_LNG, 30.0, CFG);
        assertEquals(Action.IGNORE_LOW_ACCURACY, r.action);
    }

    @Test
    public void nullAccuracy_passesGate() {
        TransitionResult r = step(GeofenceState.INITIAL, true, 0L);
        assertEquals(Action.PENDING_DWELL, r.action); // null accuracy → not ignored
    }

    @Test
    public void pendingAborts_whenLeavingBeforeDwell() {
        GeofenceState s = step(GeofenceState.INITIAL, true, 0L).nextState; // pending
        TransitionResult r = step(s, false, 20_000L);
        assertEquals(Action.PENDING_ABORTED, r.action);
        assertEquals("out", r.nextState.phase);
    }

    @Test
    public void departureCancelled_whenReturningInsideWhileArmed() {
        GeofenceState s = GeofenceState.INITIAL;
        s = step(s, true, 0L).nextState;       // pending
        s = step(s, true, 60_000L).nextState;  // in
        s = step(s, false, 70_000L).nextState; // armed
        TransitionResult r = step(s, true, 80_000L); // back inside while armed
        assertEquals(Action.DEPARTURE_CANCELLED, r.action);
        assertEquals(null, r.nextState.departureArmedAtMs);
    }

    @Test
    public void hysteresis_betweenEntryAndExit_staysInside() {
        // a point 40m away: inside exit(50) when already in, but outside entry(30) when out
        double lat40 = PLACE_LAT + 40.0 / 111_000.0;
        GeofenceState in = new GeofenceState("in", 0L, null, null);
        TransitionResult r = GeofenceStateMachine.evaluateTransition(in, lat40, PLACE_LNG, null, 1000L, PLACE_LAT, PLACE_LNG, 30.0, CFG);
        assertEquals(Action.INSIDE_NO_CHANGE, r.action); // 40m <= exit 50 → still inside
    }
}
