package com.hyeni.calendar;

/** 같은 도착 episode의 등록장소·일정 알림 이중 발사를 막는 순수 정책. */
final class RegisteredPlaceScheduleOverlapPolicy {
    private static final double MAX_PLACE_DISTANCE_M = 80.0;
    private static final int MAX_EARLY_MIN = 15;
    private static final int MAX_LATE_MIN = 60;
    private static final double EARTH_RADIUS_M = 6_371_000.0;

    private RegisteredPlaceScheduleOverlapPolicy() {}

    static boolean shouldSuppress(
            double placeLat,
            double placeLng,
            double eventLat,
            double eventLng,
            int eventMinute,
            int nowMinute) {
        if (!Double.isFinite(placeLat) || !Double.isFinite(placeLng)
                || !Double.isFinite(eventLat) || !Double.isFinite(eventLng)) return false;
        int minutesFromStart = nowMinute - eventMinute;
        if (minutesFromStart < -MAX_EARLY_MIN || minutesFromStart > MAX_LATE_MIN) return false;
        return distanceM(placeLat, placeLng, eventLat, eventLng) <= MAX_PLACE_DISTANCE_M;
    }

    static boolean shouldAssociate(
            double placeLat,
            double placeLng,
            double eventLat,
            double eventLng,
            int eventMinute,
            int nowMinute) {
        if (!Double.isFinite(placeLat) || !Double.isFinite(placeLng)
                || !Double.isFinite(eventLat) || !Double.isFinite(eventLng)) return false;
        if (Math.abs(nowMinute - eventMinute) > MAX_LATE_MIN) return false;
        return distanceM(placeLat, placeLng, eventLat, eventLng) <= MAX_PLACE_DISTANCE_M;
    }

    static boolean isBetterCandidate(
            int eventMinute,
            String eventId,
            int bestEventMinute,
            String bestEventId,
            int nowMinute) {
        if (bestEventId == null) return true;
        int distance = Math.abs(nowMinute - eventMinute);
        int bestDistance = Math.abs(nowMinute - bestEventMinute);
        if (distance != bestDistance) return distance < bestDistance;
        if (eventMinute != bestEventMinute) return eventMinute < bestEventMinute;
        return String.valueOf(eventId).compareTo(String.valueOf(bestEventId)) < 0;
    }

    private static double distanceM(double lat1, double lng1, double lat2, double lng2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2.0) * Math.sin(dLat / 2.0)
            + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
            * Math.sin(dLng / 2.0) * Math.sin(dLng / 2.0);
        return 2.0 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
    }
}
