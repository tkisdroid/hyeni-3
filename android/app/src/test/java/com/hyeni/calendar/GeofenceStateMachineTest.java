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
    // 70m: exit 50 밖이지만 조기 이탈 확정선(exit*farExitRatio=100m) 안 → 기존 180초 타이머 계약.
    private static final double OUTSIDE_LAT = 37.5 + 70.0 / 111_000.0, OUTSIDE_LNG = 127.0;

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
    public void grandmotherHomeDefaultRadius_coversLegacyPinOffset() {
        assertEquals(Double.valueOf(100.0), GeofenceStateMachine.defaultRegisteredPlaceRadiusM("OO초등학교"));
        assertEquals(Double.valueOf(150.0), GeofenceStateMachine.defaultRegisteredPlaceRadiusM("할머니댁"));
        assertEquals(Double.valueOf(150.0), GeofenceStateMachine.defaultRegisteredPlaceRadiusM("외할아버지 집"));
        assertEquals(null, GeofenceStateMachine.defaultRegisteredPlaceRadiusM("피아노 학원"));

        double lat101 = PLACE_LAT + 101.0 / 111_000.0;
        TransitionResult result = GeofenceStateMachine.evaluateTransition(
                GeofenceState.INITIAL,
                lat101,
                PLACE_LNG,
                18.0,
                0L,
                PLACE_LAT,
                PLACE_LNG,
                GeofenceStateMachine.defaultRegisteredPlaceRadiusM("할머니댁"),
                CFG);
        assertEquals(Action.PENDING_DWELL, result.action);
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
        // 70m — 반경 밖이지만 지터 가능 구간이라 기존 180초 이탈 타이머를 그대로 탄다.
        double outLat = PLACE_LAT + 70.0 / 111_000.0;
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
        // 70m — 반경 밖이지만 지터 가능 구간이라 기존 180초 이탈 타이머를 그대로 탄다.
        double outLat = PLACE_LAT + 70.0 / 111_000.0;
        GeofenceState s = new GeofenceState("in", 0L, null, null);
        TransitionResult r = GeofenceStateMachine.evaluateTransition(
                s, outLat, PLACE_LNG, null, 100_000L, PLACE_LAT, PLACE_LNG, 30.0, CFG);
        assertEquals(Action.OUTSIDE_ARMED, r.action);
        s = r.nextState;
        r = GeofenceStateMachine.evaluateTransition(
                s, outLat, PLACE_LNG, null, 300_000L, PLACE_LAT, PLACE_LNG, 30.0, CFG);
        assertEquals(Action.LEAVE, r.action);
    }

    // ── 2026-07-24 출발/도착 지연 개선 parity (shared/registeredPlaceGeofence.js) ──

    @Test
    public void farOutsideExit_settlesImmediately_withoutDepartureTimer() {
        // 이탈 반경(50m)의 2배를 넘게 멀어지면 180초 타이머를 기다리지 않는다.
        double farLat = PLACE_LAT + 200.0 / 111_000.0;
        GeofenceState s = new GeofenceState("in", 0L, null, null);
        TransitionResult r = GeofenceStateMachine.evaluateTransition(
                s, farLat, PLACE_LNG, null, 100_000L, PLACE_LAT, PLACE_LNG, 30.0, CFG);
        assertEquals(Action.LEAVE, r.action);
        assertEquals("out", r.nextState.phase);
        assertEquals(Long.valueOf(100_000L), r.nextState.lastDepartedAtMs);
    }

    @Test
    public void farOutsideExit_staysSilentForSilentEpisode() {
        double farLat = PLACE_LAT + 200.0 / 111_000.0;
        // 조용한 재진입 에피소드(lastDepartedAtMs 보존)
        GeofenceState s = new GeofenceState("in", 560_000L, null, 500_000L);
        TransitionResult r = GeofenceStateMachine.evaluateTransition(
                s, farLat, PLACE_LNG, null, 600_000L, PLACE_LAT, PLACE_LNG, 30.0, CFG);
        assertEquals(Action.SILENT_LEAVE, r.action);
    }

    @Test
    public void farOutsideExit_ignoredWhenAccuracyIsPoor() {
        // 120m 지만 오차가 ±60m — 실제로는 60m 일 수 있어 조기 확정하지 않는다.
        double noisyLat = PLACE_LAT + 120.0 / 111_000.0;
        GeofenceState s = new GeofenceState("in", 0L, null, null);
        TransitionResult r = GeofenceStateMachine.evaluateTransition(
                s, noisyLat, PLACE_LNG, 60.0, 100_000L, PLACE_LAT, PLACE_LNG, 30.0, CFG);
        assertEquals(Action.OUTSIDE_ARMED, r.action);
    }

    @Test
    public void timer_confirmsArrival_whenFixGapOutlastsDwell() {
        // 마지막 fix 는 반경 안(20m)이고 dwell 이 아직 안 찼다. 새 fix 없이 시간만 흘러도
        // dwell 을 채우면 도착으로 확정하고, episode 시각은 실측 fix 시각을 보존한다.
        double insideLat = PLACE_LAT + 20.0 / 111_000.0;
        GeofenceState s = new GeofenceState("pending", 1_000_000L, null, null);

        TransitionResult early = GeofenceStateMachine.evaluateTimer(
                s, insideLat, PLACE_LNG, 20.0, 1_100_000L, 1_150_000L,
                PLACE_LAT, PLACE_LNG, 30.0, CFG, GeofenceStateMachine.TIMER_FIX_FRESH_MS);
        assertEquals(Action.PENDING_CONTINUE, early.action);

        TransitionResult settled = GeofenceStateMachine.evaluateTimer(
                s, insideLat, PLACE_LNG, 20.0, 1_100_000L, 1_180_000L,
                PLACE_LAT, PLACE_LNG, 30.0, CFG, GeofenceStateMachine.TIMER_FIX_FRESH_MS);
        assertEquals(Action.ENTER, settled.action);
        assertEquals(Long.valueOf(1_000_000L), settled.nextState.firstInsideAtMs);
        assertEquals("in", settled.nextState.phase);
    }

    @Test
    public void timer_rejectsStaleFix_soFrozenCoordsCannotFakeTransition() {
        double insideLat = PLACE_LAT + 20.0 / 111_000.0;
        GeofenceState s = new GeofenceState("pending", 1_000_000L, null, null);
        // fix 가 5분보다 오래됐다 — 좌표가 frozen 인 상황이므로 진행시키지 않는다.
        TransitionResult r = GeofenceStateMachine.evaluateTimer(
                s, insideLat, PLACE_LNG, 20.0, 1_000_000L, 1_000_000L + 6 * 60_000L,
                PLACE_LAT, PLACE_LNG, 30.0, CFG, GeofenceStateMachine.TIMER_FIX_FRESH_MS);
        assertEquals(Action.OUTSIDE_NO_CHANGE, r.action);
        assertEquals("pending", r.nextState.phase);
    }

    @Test
    public void timer_confirmsDeparture_afterDepartureTimeout() {
        double outLat = PLACE_LAT + 70.0 / 111_000.0;
        GeofenceState s = new GeofenceState("in", 0L, 1_000_000L, null);

        TransitionResult pending = GeofenceStateMachine.evaluateTimer(
                s, outLat, PLACE_LNG, 10.0, 1_050_000L, 1_170_000L,
                PLACE_LAT, PLACE_LNG, 30.0, CFG, GeofenceStateMachine.TIMER_FIX_FRESH_MS);
        assertEquals(Action.OUTSIDE_PENDING_TIMER, pending.action);

        TransitionResult settled = GeofenceStateMachine.evaluateTimer(
                s, outLat, PLACE_LNG, 10.0, 1_050_000L, 1_181_000L,
                PLACE_LAT, PLACE_LNG, 30.0, CFG, GeofenceStateMachine.TIMER_FIX_FRESH_MS);
        assertEquals(Action.LEAVE, settled.action);
        assertEquals(Long.valueOf(1_181_000L), settled.nextState.lastDepartedAtMs);
    }

    @Test
    public void timer_doesNotArmDeparture_thatIsTheFixPath() {
        // armed 가 아직 없으면 타이머는 아무것도 하지 않는다(이탈 판정 시작은 실제 fix 의 몫).
        double outLat = PLACE_LAT + 70.0 / 111_000.0;
        GeofenceState s = new GeofenceState("in", 0L, null, null);
        TransitionResult r = GeofenceStateMachine.evaluateTimer(
                s, outLat, PLACE_LNG, 10.0, 1_050_000L, 1_300_000L,
                PLACE_LAT, PLACE_LNG, 30.0, CFG, GeofenceStateMachine.TIMER_FIX_FRESH_MS);
        assertEquals(Action.INSIDE_NO_CHANGE, r.action);
        assertEquals("in", r.nextState.phase);
    }
}
