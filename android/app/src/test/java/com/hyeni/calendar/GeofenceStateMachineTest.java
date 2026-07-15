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
    private static final GeofenceConfig CFG = GeofenceConfig.DEFAULT; // 30/50/75, dwell180s(edge)/90s(deep), cooldown600s, dep180s
    private static final double INSIDE_LAT = 37.5, INSIDE_LNG = 127.0;      // dist 0 (< entry 30, 심부)
    // 경계 근처(25m): entry 30 안이지만 심부(entry*0.6=18m) 밖 → 기존 180초 dwell 계약.
    private static final double EDGE_LAT = 37.5 + 25.0 / 111_000.0, EDGE_LNG = 127.0;
    private static final double OUTSIDE_LAT = 37.5 + 0.001, OUTSIDE_LNG = 127.0; // ~111m (> exit 50)

    private TransitionResult step(GeofenceState s, boolean inside, long tMs) {
        double lat = inside ? INSIDE_LAT : OUTSIDE_LAT;
        double lng = inside ? INSIDE_LNG : OUTSIDE_LNG;
        return GeofenceStateMachine.evaluateTransition(s, lat, lng, null, tMs, PLACE_LAT, PLACE_LNG, 30.0, CFG);
    }

    private TransitionResult stepEdge(GeofenceState s, boolean inside, long tMs) {
        double lat = inside ? EDGE_LAT : OUTSIDE_LAT;
        double lng = inside ? EDGE_LNG : OUTSIDE_LNG;
        return GeofenceStateMachine.evaluateTransition(s, lat, lng, null, tMs, PLACE_LAT, PLACE_LNG, 30.0, CFG);
    }

    @Test
    public void bootstrapInitialInside_startsAsIn_withoutEnterAlert() {
        GeofenceState bootstrapped = GeofenceStateMachine.bootstrapInitialInside(
                GeofenceState.INITIAL, INSIDE_LAT, INSIDE_LNG, null, 1_000L,
                PLACE_LAT, PLACE_LNG, 30.0, CFG);

        assertEquals("in", bootstrapped.phase);
        assertEquals(Long.valueOf(1_000L), bootstrapped.firstInsideAtMs);
        TransitionResult r = step(bootstrapped, true, 181_000L);
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

        // 1. 경계 진입 @0 → PENDING_DWELL (경계는 180초 계약 유지)
        TransitionResult r = stepEdge(s, true, 0L);
        assertEquals(Action.PENDING_DWELL, r.action);
        assertEquals("pending", r.nextState.phase);
        s = r.nextState;

        // 2. 경계 @90s → dwell 90s<180s → PENDING_CONTINUE
        r = stepEdge(s, true, 90_000L);
        assertEquals(Action.PENDING_CONTINUE, r.action);
        s = r.nextState;

        // 3. 경계 @180s → dwell satisfied → ENTER
        r = stepEdge(s, true, 180_000L);
        assertEquals(Action.ENTER, r.action);
        assertEquals("in", r.nextState.phase);
        s = r.nextState;

        // 4. inside @190s → INSIDE_NO_CHANGE
        r = step(s, true, 190_000L);
        assertEquals(Action.INSIDE_NO_CHANGE, r.action);
        s = r.nextState;

        // 5. outside @200s → OUTSIDE_ARMED
        r = step(s, false, 200_000L);
        assertEquals(Action.OUTSIDE_ARMED, r.action);
        assertEquals(Long.valueOf(200_000L), r.nextState.departureArmedAtMs);
        s = r.nextState;

        // 6. outside @320s → departure 120s<180s → OUTSIDE_PENDING_TIMER
        r = step(s, false, 320_000L);
        assertEquals(Action.OUTSIDE_PENDING_TIMER, r.action);
        s = r.nextState;

        // 7. outside @420s → departure 220s>=180s → LEAVE
        r = step(s, false, 420_000L);
        assertEquals(Action.LEAVE, r.action);
        assertEquals("out", r.nextState.phase);
        assertEquals(Long.valueOf(420_000L), r.nextState.lastDepartedAtMs);
        s = r.nextState;

        // 8. inside @470s → cooldown 50s<600s → SILENT_RE_ENTER (no ENTER alert)
        r = step(s, true, 470_000L);
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
        s = step(s, true, 180_000L).nextState;  // in
        s = step(s, false, 190_000L).nextState; // armed
        TransitionResult r = step(s, true, 200_000L); // back inside while armed
        assertEquals(Action.DEPARTURE_CANCELLED, r.action);
        assertEquals(null, r.nextState.departureArmedAtMs);
    }

    @Test
    public void passingThroughUnderRegisteredDwell_doesNotEnter() {
        // 옆 건물 통과(경계 근처를 2분 이내 스침) — 도착 알림이 나가면 안 된다.
        GeofenceState s = GeofenceState.INITIAL;

        TransitionResult r = stepEdge(s, true, 0L);
        assertEquals(Action.PENDING_DWELL, r.action);
        s = r.nextState;

        r = stepEdge(s, true, 119_000L);
        assertEquals(Action.PENDING_CONTINUE, r.action);
        s = r.nextState;

        r = stepEdge(s, false, 130_000L);
        assertEquals(Action.PENDING_ABORTED, r.action);
        assertEquals("out", r.nextState.phase);
    }

    @Test
    public void deepInside_promotesAfterShortDwell90s() {
        // 반경 중심부(심부) 진입은 90초 체류로 도착 승격 — 도착 알림 지연 개선(2026-07-10).
        GeofenceState s = GeofenceState.INITIAL;

        TransitionResult r = step(s, true, 0L); // dist 0 = 심부
        assertEquals(Action.PENDING_DWELL, r.action);
        s = r.nextState;

        r = step(s, true, 60_000L); // 60s < 90s → 아직
        assertEquals(Action.PENDING_CONTINUE, r.action);
        s = r.nextState;

        r = step(s, true, 95_000L); // 95s ≥ 90s → ENTER
        assertEquals(Action.ENTER, r.action);
        assertEquals("in", r.nextState.phase);
    }

    @Test
    public void placeRadius_expandsEntryAndKeepsDeepDwell() {
        // 장소별 반경 100m: 70m 지점 진입(pending) 후 심부(60m 이내) 90초 → ENTER.
        double lat70 = PLACE_LAT + 70.0 / 111_000.0;
        double lat20 = PLACE_LAT + 20.0 / 111_000.0;
        GeofenceState s = GeofenceState.INITIAL;

        TransitionResult r = GeofenceStateMachine.evaluateTransition(
                s, lat70, PLACE_LNG, null, 0L, PLACE_LAT, PLACE_LNG, 100.0, CFG);
        assertEquals(Action.PENDING_DWELL, r.action);
        s = r.nextState;

        r = GeofenceStateMachine.evaluateTransition(
                s, lat20, PLACE_LNG, null, 95_000L, PLACE_LAT, PLACE_LNG, 100.0, CFG);
        assertEquals(Action.ENTER, r.action);
    }

    @Test
    public void hysteresis_betweenEntryAndExit_staysInside() {
        // a point 40m away: inside exit(50) when already in, but outside entry(30) when out
        double lat40 = PLACE_LAT + 40.0 / 111_000.0;
        GeofenceState in = new GeofenceState("in", 0L, null, null);
        TransitionResult r = GeofenceStateMachine.evaluateTransition(in, lat40, PLACE_LNG, null, 1000L, PLACE_LAT, PLACE_LNG, 30.0, CFG);
        assertEquals(Action.INSIDE_NO_CHANGE, r.action); // 40m <= exit 50 → still inside
    }

    @Test
    public void silentReenterEpisode_leavesSilently_withoutSecondLeaveAlert() {
        // 2026-07-16 회귀: LEAVE 후 쿨다운 내 SILENT_RE_ENTER 로 다시 들어간 에피소드는
        // 부모가 재도착 알림을 받은 적이 없으므로 재이탈도 SILENT_LEAVE(무알림)여야 한다.
        // ("집 출발"·"피아노 학원 출발" 이 사이 도착 없이 반복되던 실사고)
        double outLat = PLACE_LAT + 200.0 / 111_000.0;
        // 정상 도착 후 출발 완료 상태 (lastDepartedAtMs = 500s)
        GeofenceState s = new GeofenceState("out", null, null, 500_000L);

        // 쿨다운(600s) 내 재진입 → SILENT_RE_ENTER (lastDepartedAtMs 보존)
        TransitionResult r = GeofenceStateMachine.evaluateTransition(
                s, PLACE_LAT, PLACE_LNG, null, 560_000L, PLACE_LAT, PLACE_LNG, 30.0, CFG);
        assertEquals(Action.SILENT_RE_ENTER, r.action);
        s = r.nextState;

        // 다시 밖으로 → armed → 180s 뒤 이탈 확정은 SILENT_LEAVE
        r = GeofenceStateMachine.evaluateTransition(
                s, outLat, PLACE_LNG, null, 600_000L, PLACE_LAT, PLACE_LNG, 30.0, CFG);
        assertEquals(Action.OUTSIDE_ARMED, r.action);
        s = r.nextState;
        r = GeofenceStateMachine.evaluateTransition(
                s, outLat, PLACE_LNG, null, 800_000L, PLACE_LAT, PLACE_LNG, 30.0, CFG);
        assertEquals(Action.SILENT_LEAVE, r.action);
        assertEquals("out", r.nextState.phase);
        assertEquals(Long.valueOf(800_000L), r.nextState.lastDepartedAtMs);
    }

    @Test
    public void announcedEpisode_stillLeavesWithAlert() {
        // 정상 ENTER(lastDepartedAtMs=null) 에피소드의 출발은 그대로 LEAVE 알림.
        double outLat = PLACE_LAT + 200.0 / 111_000.0;
        GeofenceState s = new GeofenceState("in", 0L, null, null);
        TransitionResult r = GeofenceStateMachine.evaluateTransition(
                s, outLat, PLACE_LNG, null, 100_000L, PLACE_LAT, PLACE_LNG, 30.0, CFG);
        assertEquals(Action.OUTSIDE_ARMED, r.action);
        s = r.nextState;
        r = GeofenceStateMachine.evaluateTransition(
                s, outLat, PLACE_LNG, null, 300_000L, PLACE_LAT, PLACE_LNG, 30.0, CFG);
        assertEquals(Action.LEAVE, r.action);
    }
}
