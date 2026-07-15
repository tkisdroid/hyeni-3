package com.hyeni.calendar;

/**
 * 등록장소 도착·이탈 5층 방어 상태머신 — 클라(src/lib/registeredPlaceGeofence.js)·
 * 서버(supabase/functions/_shared/registeredPlaceGeofence.js)의
 * evaluateRegisteredPlaceTransition 을 Java 로 1:1 포팅 (Phase C 네이티브 즉시 geofence).
 *
 * 3중 parity 가 핵심: 네이티브가 클라/서버와 동일한 ENTER/LEAVE 결정을 내려야 같은
 * 10분 버킷 멱등키로 push_idempotency 에서 1건만 통과한다. GeofenceStateMachineTest 가
 * serverRegisteredPlaceGeofence.test.js 의 시퀀스를 1:1 복제해 드리프트를 막는다.
 *
 * Android 비의존 순수 static 함수 (build.gradle returnDefaultValues=true 가
 * Location.distanceBetween 을 0 반환시키므로 거리도 자체 haversineM 사용).
 *
 * tMs 의미(★): 평가 시각 wall-clock(System.currentTimeMillis()) 을 넣는다. fix 가 안
 * 들어와도 시간이 흘러 dwell(180s)/departure(180s) 가 진행되도록 — 클라 App.jsx 동일.
 */
final class GeofenceStateMachine {

    private GeofenceStateMachine() {}

    enum Action {
        IGNORE_LOW_ACCURACY, PENDING_DWELL, PENDING_CONTINUE, PENDING_ABORTED,
        ENTER, SILENT_RE_ENTER, INSIDE_NO_CHANGE, DEPARTURE_CANCELLED,
        // SILENT_LEAVE: 조용한 재진입(SILENT_RE_ENTER) 에피소드의 출발 — 부모는 재도착
        // 알림을 받은 적이 없으므로 출발 알림도 발사하지 않고 상태만 갱신(서버/클라 parity).
        OUTSIDE_ARMED, OUTSIDE_PENDING_TIMER, LEAVE, SILENT_LEAVE, OUTSIDE_NO_CHANGE
    }

    static final class GeofenceConfig {
        final double entryRadiusM, exitRadiusM, maxAccuracyM;
        final long dwellMs, cooldownMs, departureTimeoutMs;
        // 심부 진입 단축 dwell — 반경 중심부(entryR*deepInsideRatio 이내) fix 는 확실한
        // 방문이므로 90초만 머물면 승격(도착 알림 지연 개선). 경계 fix 는 dwellMs 유지.
        final long deepDwellMs;
        final double deepInsideRatio;
        GeofenceConfig(double entryRadiusM, double exitRadiusM, double maxAccuracyM,
                       long dwellMs, long cooldownMs, long departureTimeoutMs,
                       long deepDwellMs, double deepInsideRatio) {
            this.entryRadiusM = entryRadiusM; this.exitRadiusM = exitRadiusM; this.maxAccuracyM = maxAccuracyM;
            this.dwellMs = dwellMs; this.cooldownMs = cooldownMs; this.departureTimeoutMs = departureTimeoutMs;
            this.deepDwellMs = deepDwellMs; this.deepInsideRatio = deepInsideRatio;
        }
        GeofenceConfig(double entryRadiusM, double exitRadiusM, double maxAccuracyM,
                       long dwellMs, long cooldownMs, long departureTimeoutMs) {
            this(entryRadiusM, exitRadiusM, maxAccuracyM, dwellMs, cooldownMs, departureTimeoutMs, dwellMs, 0);
        }
        // SERVER_GEOFENCE_CONFIG / locationConstants.js 동일 값. 진입은 경계 근처면 3분,
        // 심부(60% 이내)면 90초 체류 후 도착으로 승격한다. 학원가 옆 건물 통과 오탐 방지 유지.
        static final GeofenceConfig DEFAULT = new GeofenceConfig(30, 50, 75, 180_000L, 600_000L, 180_000L, 90_000L, 0.6);
    }

    // 불변 상태. ms 필드는 null 가능(미설정) → Long.
    static final class GeofenceState {
        final String phase; // "out" | "pending" | "in"
        final Long firstInsideAtMs;
        final Long departureArmedAtMs;
        final Long lastDepartedAtMs;
        GeofenceState(String phase, Long firstInsideAtMs, Long departureArmedAtMs, Long lastDepartedAtMs) {
            this.phase = (phase == null) ? "out" : phase;
            this.firstInsideAtMs = firstInsideAtMs;
            this.departureArmedAtMs = departureArmedAtMs;
            this.lastDepartedAtMs = lastDepartedAtMs;
        }
        static final GeofenceState INITIAL = new GeofenceState("out", null, null, null);
    }

    static final class TransitionResult {
        final Action action;
        final GeofenceState nextState;
        TransitionResult(Action action, GeofenceState nextState) { this.action = action; this.nextState = nextState; }
    }

    static double haversineM(double la1, double lo1, double la2, double lo2) {
        double R = 6371000, p1 = la1 * Math.PI / 180, p2 = la2 * Math.PI / 180;
        double dp = (la2 - la1) * Math.PI / 180, dl = (lo2 - lo1) * Math.PI / 180;
        double a = Math.sin(dp / 2) * Math.sin(dp / 2)
                + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    private static String normPhase(GeofenceState s) {
        if (s == null) return "out";
        return ("in".equals(s.phase) || "pending".equals(s.phase) || "out".equals(s.phase)) ? s.phase : "out";
    }

    /**
     * @param accuracy fix 정확도 m (null = 미상 → Layer1 자동통과; 서버 fix 처럼).
     * @param placeRadiusM 사용자 지정 알림 반경 m (null = config 기본).
     * @param tMs 평가 시각 (wall-clock).
     */
    static TransitionResult evaluateTransition(
            GeofenceState state, double lat, double lng, Double accuracy, long tMs,
            double placeLat, double placeLng, Double placeRadiusM, GeofenceConfig cfg) {
        GeofenceState prev = new GeofenceState(normPhase(state),
                state == null ? null : state.firstInsideAtMs,
                state == null ? null : state.departureArmedAtMs,
                state == null ? null : state.lastDepartedAtMs);

        if (!Double.isFinite(lat) || !Double.isFinite(lng)) return new TransitionResult(Action.INSIDE_NO_CHANGE, prev);
        if (!Double.isFinite(placeLat) || !Double.isFinite(placeLng)) return new TransitionResult(Action.OUTSIDE_NO_CHANGE, prev);

        // Layer1 정확도 게이트: accuracy 가 유한이고 임계 초과면 평가 skip.
        if (accuracy != null && Double.isFinite(accuracy) && accuracy > cfg.maxAccuracyM) {
            return new TransitionResult(Action.IGNORE_LOW_ACCURACY, prev);
        }

        double dist = haversineM(lat, lng, placeLat, placeLng);
        double[] radii = resolveRadii(placeRadiusM, cfg);
        double entryR = radii[0], exitR = radii[1];
        boolean inside = "in".equals(prev.phase) ? dist <= exitR : dist <= entryR;
        boolean deepInside = cfg.deepInsideRatio > 0 && dist <= entryR * cfg.deepInsideRatio;

        switch (prev.phase) {
            case "out": return fromOut(prev, tMs, inside, cfg);
            case "pending": return fromPending(prev, tMs, inside, cfg, deepInside);
            case "in": return fromIn(prev, tMs, inside, cfg);
            default: return new TransitionResult(Action.OUTSIDE_NO_CHANGE, GeofenceState.INITIAL);
        }
    }

    static GeofenceState bootstrapInitialInside(
            GeofenceState state, double lat, double lng, Double accuracy, long tMs,
            double placeLat, double placeLng, Double placeRadiusM, GeofenceConfig cfg) {
        GeofenceState prev = new GeofenceState(normPhase(state),
                state == null ? null : state.firstInsideAtMs,
                state == null ? null : state.departureArmedAtMs,
                state == null ? null : state.lastDepartedAtMs);

        if (!isPristineOut(prev) || cfg == null) return prev;
        if (!Double.isFinite(lat) || !Double.isFinite(lng)) return prev;
        if (!Double.isFinite(placeLat) || !Double.isFinite(placeLng)) return prev;
        if (accuracy != null && Double.isFinite(accuracy) && accuracy > cfg.maxAccuracyM) return prev;

        double dist = haversineM(lat, lng, placeLat, placeLng);
        double[] radii = resolveRadii(placeRadiusM, cfg);
        if (dist > radii[0]) return prev;

        return new GeofenceState("in", tMs, null, null);
    }

    private static double[] resolveRadii(Double placeRadiusM, GeofenceConfig cfg) {
        boolean hasUser = placeRadiusM != null && Double.isFinite(placeRadiusM) && placeRadiusM > 0;
        if (!hasUser) return new double[]{ cfg.entryRadiusM, cfg.exitRadiusM };
        double entryR = Math.max(placeRadiusM, cfg.entryRadiusM);
        double ratio = cfg.exitRadiusM / cfg.entryRadiusM;
        double exitR = Math.max(placeRadiusM * ratio, cfg.exitRadiusM);
        return new double[]{ entryR, exitR };
    }

    private static boolean isPristineOut(GeofenceState state) {
        return "out".equals(state.phase)
                && state.firstInsideAtMs == null
                && state.departureArmedAtMs == null
                && state.lastDepartedAtMs == null;
    }

    private static TransitionResult fromOut(GeofenceState prev, long tMs, boolean inside, GeofenceConfig cfg) {
        if (!inside) return new TransitionResult(Action.OUTSIDE_NO_CHANGE, prev);
        boolean cooldownActive = prev.lastDepartedAtMs != null && (tMs - prev.lastDepartedAtMs) < cfg.cooldownMs;
        if (cooldownActive) {
            return new TransitionResult(Action.SILENT_RE_ENTER,
                    new GeofenceState("in", tMs, null, prev.lastDepartedAtMs));
        }
        return new TransitionResult(Action.PENDING_DWELL,
                new GeofenceState("pending", tMs, null, prev.lastDepartedAtMs));
    }

    private static TransitionResult fromPending(GeofenceState prev, long tMs, boolean inside, GeofenceConfig cfg,
                                                boolean deepInside) {
        if (!inside) {
            return new TransitionResult(Action.PENDING_ABORTED,
                    new GeofenceState("out", null, null, prev.lastDepartedAtMs));
        }
        long requiredDwellMs = deepInside ? cfg.deepDwellMs : cfg.dwellMs;
        boolean dwellSatisfied = prev.firstInsideAtMs != null && (tMs - prev.firstInsideAtMs) >= requiredDwellMs;
        if (!dwellSatisfied) return new TransitionResult(Action.PENDING_CONTINUE, prev);
        return new TransitionResult(Action.ENTER,
                new GeofenceState("in", prev.firstInsideAtMs, null, null));
    }

    private static TransitionResult fromIn(GeofenceState prev, long tMs, boolean inside, GeofenceConfig cfg) {
        if (inside) {
            if (prev.departureArmedAtMs != null) {
                return new TransitionResult(Action.DEPARTURE_CANCELLED,
                        new GeofenceState("in", prev.firstInsideAtMs, null, prev.lastDepartedAtMs));
            }
            return new TransitionResult(Action.INSIDE_NO_CHANGE, prev);
        }
        if (prev.departureArmedAtMs == null) {
            return new TransitionResult(Action.OUTSIDE_ARMED,
                    new GeofenceState("in", prev.firstInsideAtMs, tMs, prev.lastDepartedAtMs));
        }
        boolean departureSatisfied = (tMs - prev.departureArmedAtMs) >= cfg.departureTimeoutMs;
        if (!departureSatisfied) return new TransitionResult(Action.OUTSIDE_PENDING_TIMER, prev);
        // 정상 ENTER 는 lastDepartedAtMs 를 null 로 지우고 SILENT_RE_ENTER 만 보존하므로,
        // non-null = 조용한 재진입 에피소드 → 출발도 조용히(SILENT_LEAVE) 처리한다.
        boolean enteredSilently = prev.lastDepartedAtMs != null;
        return new TransitionResult(enteredSilently ? Action.SILENT_LEAVE : Action.LEAVE,
                new GeofenceState("out", null, null, tMs));
    }
}
