package com.hyeni.calendar;

import static org.junit.Assert.*;
import org.junit.Test;

public class FamilyTimePolicyTest {
    @Test public void 서머타임_없는시각은_뒤로_중복시각은_첫발생으로_정한다() {
        assertEquals(1772965800000L, FamilyTimePolicy.wallTimeMs("2026-2-8", 150, "America/Los_Angeles"));
        assertEquals(1793521800000L, FamilyTimePolicy.wallTimeMs("2026-10-1", 90, "America/Los_Angeles"));
    }
    @Test public void 서머타임과_45분_시차도_가족시간을_사용한다() {
        long first = FamilyTimePolicy.wallTimeMs("2026-2-8", 0, "America/Los_Angeles");
        long second = FamilyTimePolicy.wallTimeMs("2026-2-9", 0, "America/Los_Angeles");
        assertEquals(23 * 3600000L, second - first);
        assertEquals(FamilyTimePolicy.wallTimeMs("2026-8-14", 135, "UTC"),
                FamilyTimePolicy.wallTimeMs("2026-8-14", 480, "Asia/Kathmandu"));
    }
    @Test public void 해외_조용한시간과_긴급우회를_동시에_지킨다() {
        long at = FamilyTimePolicy.wallTimeMs("2026-8-14", 1380, "America/Los_Angeles");
        NotificationQuietHoursStore.Snapshot snapshot = new NotificationQuietHoursStore.Snapshot(
            "parent", true, 1320, 420, "America/Los_Angeles", 1L);
        assertEquals(NotificationQuietHoursPolicy.Decision.SUPPRESS, NotificationQuietHoursPolicy.decide(
            snapshot, NotificationQuietHoursPolicy.NotificationIdentity.of("new_memo", ""), at));
        assertEquals(NotificationQuietHoursPolicy.Decision.ALLOW, NotificationQuietHoursPolicy.decide(
            snapshot, NotificationQuietHoursPolicy.NotificationIdentity.of("sos", "sos"), at));
        assertFalse(NotificationQuietHoursStore.isValidTimeZone("Invalid/Zone"));
    }
}
