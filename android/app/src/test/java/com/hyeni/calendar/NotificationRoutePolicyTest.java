package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class NotificationRoutePolicyTest {

    @Test
    public void parentCanOpenOnlyParentNotificationRoutes() {
        assertEquals("#/parent/calendar", NotificationRoutePolicy.resolveHashRoute("/parent/calendar", "parent"));
        assertEquals("#/notifications", NotificationRoutePolicy.resolveHashRoute("#/notifications", "PARENT"));
        assertNull(NotificationRoutePolicy.resolveHashRoute("/child/home", "parent"));
    }

    @Test
    public void childCanOpenOnlyChildNotificationRoutes() {
        assertEquals("#/child/memo", NotificationRoutePolicy.resolveHashRoute("/child/memo", "child"));
        assertEquals("#/child/sticker", NotificationRoutePolicy.resolveHashRoute("child-sticker", "child"));
        assertEquals("#/child/ai-friend", NotificationRoutePolicy.resolveHashRoute("ai-chat", "child"));
        assertNull(NotificationRoutePolicy.resolveHashRoute("/notifications", "child"));
        assertNull(NotificationRoutePolicy.resolveHashRoute("ai-chat", "parent"));
    }

    @Test
    public void externalOrUnknownRoleRouteIsRejected() {
        assertNull(NotificationRoutePolicy.resolveHashRoute("https://evil.example", "parent"));
        assertNull(NotificationRoutePolicy.resolveHashRoute("/parent/calendar", ""));
        assertNull(NotificationRoutePolicy.resolveHashRoute("../notifications", "parent"));
    }

    @Test
    public void parentCanOpenOnlyExactSafeQueryRoutes() {
        assertEquals(
            "#/parent/memo?child=child-123_A",
            NotificationRoutePolicy.resolveHashRoute("/parent/memo?child=child-123_A", "parent")
        );
        assertEquals(
            "#/sos-receive?alert=alert-1&child=child-1",
            NotificationRoutePolicy.resolveHashRoute(
                "#/sos-receive?alert=alert-1&child=child-1",
                "PARENT"
            )
        );
        assertEquals(
            "#/notifications?alert=alert_2",
            NotificationRoutePolicy.resolveHashRoute("/notifications?alert=alert_2", "parent")
        );
    }

    @Test
    public void extraDuplicateEncodedOrIncompleteQueryIsRejected() {
        assertNull(NotificationRoutePolicy.resolveHashRoute(
            "/parent/memo?child=child-1&next=evil",
            "parent"
        ));
        assertNull(NotificationRoutePolicy.resolveHashRoute(
            "/parent/memo?child=child-1&child=child-2",
            "parent"
        ));
        assertNull(NotificationRoutePolicy.resolveHashRoute(
            "/parent/memo?child=a%2Fb",
            "parent"
        ));
        assertNull(NotificationRoutePolicy.resolveHashRoute(
            "/notifications?alert=alert-1&child=child-1",
            "parent"
        ));
        assertNull(NotificationRoutePolicy.resolveHashRoute(
            "/sos-receive?alert=alert-1",
            "parent"
        ));
        assertNull(NotificationRoutePolicy.resolveHashRoute(
            "/sos-receive?child=child-1&alert=alert-1",
            "parent"
        ));
    }

    @Test
    public void queryRoutesNeverCrossRoleBoundary() {
        assertNull(NotificationRoutePolicy.resolveHashRoute(
            "/parent/memo?child=child-1",
            "child"
        ));
        assertNull(NotificationRoutePolicy.resolveHashRoute(
            "/notifications?alert=alert-1",
            "child"
        ));
        assertNull(NotificationRoutePolicy.resolveHashRoute(
            "/child/memo?child=child-1",
            "child"
        ));
    }
}
