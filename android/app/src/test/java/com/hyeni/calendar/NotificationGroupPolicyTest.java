package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

import org.junit.Test;

public class NotificationGroupPolicyTest {
    @Test
    public void childFacingFunctionsUseIndependentGroups() {
        String family = NotificationGroupPolicy.groupFor("family_message");
        String ai = NotificationGroupPolicy.groupFor("ai_friend");
        String sticker = NotificationGroupPolicy.groupFor("sticker");

        assertEquals(NotificationGroupPolicy.GROUP_FAMILY_MESSAGE, family);
        assertEquals(NotificationGroupPolicy.GROUP_AI_FRIEND, ai);
        assertEquals(NotificationGroupPolicy.GROUP_STICKER, sticker);
        assertNotEquals(family, ai);
        assertNotEquals(family, sticker);
        assertNotEquals(ai, sticker);
        assertNotEquals(family, NotificationGroupPolicy.GROUP_LOCATION_STATUS);
    }
}
