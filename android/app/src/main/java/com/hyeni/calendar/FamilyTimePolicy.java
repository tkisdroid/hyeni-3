package com.hyeni.calendar;

import java.util.Calendar;
import java.util.HashSet;
import java.util.Set;
import java.util.TimeZone;

/** 서버와 같은 DST 규칙: 중복 시각은 첫 발생, 없는 시각은 전환 간격 뒤. */
final class FamilyTimePolicy {
    private FamilyTimePolicy() {}

    static long wallTimeMs(String dateKey, int minute, String zoneId) {
        if (!NotificationQuietHoursStore.isValidTimeZone(zoneId)) throw new IllegalArgumentException("시간대 오류");
        String[] date = dateKey.split("-");
        if (date.length != 3) throw new IllegalArgumentException("날짜 오류");
        Calendar wall = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        wall.clear();
        wall.setLenient(false);
        wall.set(Integer.parseInt(date[0]), Integer.parseInt(date[1]), Integer.parseInt(date[2]), 0, 0);
        long desired = wall.getTimeInMillis() + minute * 60000L;
        TimeZone zone = TimeZone.getTimeZone(zoneId);
        Set<Integer> offsets = new HashSet<>();
        for (int hour = -36; hour <= 36; hour += 6) offsets.add(zone.getOffset(desired + hour * 3600000L));
        long exact = Long.MAX_VALUE, later = Long.MAX_VALUE, difference = Long.MAX_VALUE;
        for (int offset : offsets) {
            long candidate = desired - offset;
            long delta = candidate + zone.getOffset(candidate) - desired;
            if (delta == 0) exact = Math.min(exact, candidate);
            if (delta > 0 && delta < difference) { difference = delta; later = candidate; }
        }
        if (exact != Long.MAX_VALUE) return exact;
        if (later != Long.MAX_VALUE) return later;
        throw new IllegalArgumentException("날짜 오류");
    }
}
