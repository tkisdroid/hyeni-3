package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class NotificationChannelPolicyTest {
    @Test
    public void urgentSafetyUsesEmergencyChannel() {
        assertEquals("emergency", NotificationChannelPolicy.channelFor(
            "parent_alert", "danger_enter", true
        ));
    }

    @Test
    public void nonUrgentLocationSafetyUsesDedicatedChannel() {
        assertEquals("safety", NotificationChannelPolicy.channelFor("parent_alert", "arrived", false));
        assertEquals("safety", NotificationChannelPolicy.channelFor("child_safety", "danger_exit", false));
    }

    @Test
    public void messageAndScheduleChannelsStayDistinct() {
        assertEquals("child_message", NotificationChannelPolicy.channelFor("new_memo", "", false));
        assertEquals("child_message", NotificationChannelPolicy.channelFor("ai_proactive", "", false));
        assertEquals("child_message", NotificationChannelPolicy.channelFor("sticker", "", false));
        assertEquals("schedule", NotificationChannelPolicy.channelFor("schedule", "", false));
        assertEquals("kkuk", NotificationChannelPolicy.channelFor("kkuk", "", false));
    }
}
