package com.hyeni.calendar;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class RegisteredPlaceResolver {
    static final double SAME_PHYSICAL_PLACE_RADIUS_M = 20.0;

    private RegisteredPlaceResolver() {}

    static final class PlaceCandidate {
        final String placeKey;
        final String name;
        final String source;
        final double lat;
        final double lng;

        PlaceCandidate(String placeKey, String name, String source, double lat, double lng) {
            this.placeKey = placeKey == null ? "" : placeKey;
            this.name = (name == null || name.trim().isEmpty()) ? "등록된 장소" : name;
            this.source = normalizeSource(source, placeKey);
            this.lat = lat;
            this.lng = lng;
        }
    }

    static List<PlaceCandidate> canonicalize(List<PlaceCandidate> places) {
        if (places == null || places.isEmpty()) return Collections.emptyList();
        List<PlaceCandidate> out = new ArrayList<>();
        for (PlaceCandidate candidate : places) {
            if (!isValid(candidate)) continue;
            int dupIndex = findSamePhysicalPlace(out, candidate);
            if (dupIndex < 0) {
                out.add(candidate);
                continue;
            }
            PlaceCandidate current = out.get(dupIndex);
            if (isPreferred(candidate, current)) {
                out.set(dupIndex, candidate);
            }
        }
        return out;
    }

    private static int findSamePhysicalPlace(List<PlaceCandidate> places, PlaceCandidate candidate) {
        for (int i = 0; i < places.size(); i++) {
            PlaceCandidate other = places.get(i);
            double dist = GeofenceStateMachine.haversineM(candidate.lat, candidate.lng, other.lat, other.lng);
            if (dist <= SAME_PHYSICAL_PLACE_RADIUS_M) return i;
        }
        return -1;
    }

    private static boolean isPreferred(PlaceCandidate next, PlaceCandidate current) {
        int nextRank = sourceRank(next.source);
        int currentRank = sourceRank(current.source);
        if (nextRank != currentRank) return nextRank < currentRank;
        return next.name.length() > current.name.length();
    }

    private static int sourceRank(String source) {
        if ("saved_place".equals(source)) return 0;
        if ("academy".equals(source)) return 1;
        return 2;
    }

    private static boolean isValid(PlaceCandidate place) {
        return place != null
                && !place.placeKey.isEmpty()
                && Double.isFinite(place.lat)
                && Double.isFinite(place.lng);
    }

    private static String normalizeSource(String source, String placeKey) {
        if ("saved_place".equals(source) || "academy".equals(source)) return source;
        String key = placeKey == null ? "" : placeKey;
        if (key.contains(":saved_place:")) return "saved_place";
        if (key.contains(":academy:")) return "academy";
        return "";
    }
}
