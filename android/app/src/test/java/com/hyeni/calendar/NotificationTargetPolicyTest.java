package com.hyeni.calendar;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.HashMap;
import java.util.Map;

import org.junit.Test;

public class NotificationTargetPolicyTest {

    @Test
    public void everyPayloadIsRejectedWithoutCompleteLocalSession() {
        assertEquals(
            NotificationTargetPolicy.Decision.LOCAL_SESSION_MISSING,
            NotificationTargetPolicy.evaluate(new HashMap<>(), "", "family-1", "child")
        );
        assertEquals(
            NotificationTargetPolicy.Decision.LOCAL_SESSION_MISSING,
            NotificationTargetPolicy.evaluate(new HashMap<>(), "child-1", "", "child")
        );
        assertEquals(
            NotificationTargetPolicy.Decision.LOCAL_SESSION_MISSING,
            NotificationTargetPolicy.evaluate(new HashMap<>(), "child-1", "family-1", "")
        );
    }

    @Test
    public void targetlessPayloadIsRejectedEvenWithActiveLocalSession() {
        assertEquals(NotificationTargetPolicy.Decision.TARGET_MISSING, NotificationTargetPolicy.evaluate(
            new HashMap<>(), "child-1", "family-1", "child"
        ));
    }

    @Test
    public void userAndFamilyTargetsAreBothRequired() {
        Map<String, String> userOnly = new HashMap<>();
        userOnly.put("targetUserId", "child-1");
        assertEquals(NotificationTargetPolicy.Decision.TARGET_MISSING, NotificationTargetPolicy.evaluate(
            userOnly, "child-1", "family-1", "child"
        ));

        Map<String, String> familyOnly = new HashMap<>();
        familyOnly.put("familyId", "family-1");
        assertEquals(NotificationTargetPolicy.Decision.TARGET_MISSING, NotificationTargetPolicy.evaluate(
            familyOnly, "child-1", "family-1", "child"
        ));
    }

    @Test
    public void exactUserAndFamilyTargetsAllowDeliveryWithoutOptionalRole() {
        Map<String, String> payload = new HashMap<>();
        payload.put("targetUserId", "child-1");
        payload.put("familyId", "family-1");

        assertTrue(NotificationTargetPolicy.evaluate(
            payload, "child-1", "family-1", "child"
        ).allowsDelivery());
    }

    @Test
    public void camelCaseTargetsMustAllMatchCurrentSession() {
        Map<String, String> payload = new HashMap<>();
        payload.put("targetUserId", "child-1");
        payload.put("familyId", "family-1");
        payload.put("targetRole", "child");

        assertTrue(NotificationTargetPolicy.evaluate(
            payload, "child-1", "family-1", "CHILD"
        ).allowsDelivery());
        assertFalse(NotificationTargetPolicy.evaluate(
            payload, "child-2", "family-1", "child"
        ).allowsDelivery());
    }

    @Test
    public void snakeCaseAndExplicitFamilyAliasesAreEnforced() {
        Map<String, String> payload = new HashMap<>();
        payload.put("target_user_id", "parent-1");
        payload.put("target_family_id", "family-1");
        payload.put("target_role", "parent");

        assertTrue(NotificationTargetPolicy.evaluate(
            payload, "parent-1", "family-1", "parent"
        ).allowsDelivery());
        assertFalse(NotificationTargetPolicy.evaluate(
            payload, "parent-1", "family-2", "parent"
        ).allowsDelivery());
    }

    @Test
    public void targetedPayloadIsRejectedWhenMatchingLocalValueIsMissing() {
        Map<String, String> userTarget = new HashMap<>();
        userTarget.put("targetUserId", "child-1");
        assertFalse(NotificationTargetPolicy.evaluate(
            userTarget, "", "family-1", "child"
        ).allowsDelivery());

        Map<String, String> familyTarget = new HashMap<>();
        familyTarget.put("family_id", "family-1");
        assertFalse(NotificationTargetPolicy.evaluate(
            familyTarget, "child-1", "", "child"
        ).allowsDelivery());

        Map<String, String> roleTarget = new HashMap<>();
        roleTarget.put("targetRole", "child");
        assertFalse(NotificationTargetPolicy.evaluate(
            roleTarget, "child-1", "family-1", ""
        ).allowsDelivery());
    }

    @Test
    public void conflictingAliasesAreRejectedInsteadOfTrustingFirstValue() {
        Map<String, String> payload = new HashMap<>();
        payload.put("targetUserId", "child-1");
        payload.put("target_user_id", "child-2");
        payload.put("familyId", "family-1");

        assertFalse(NotificationTargetPolicy.evaluate(
            payload, "child-1", "family-1", "child"
        ).allowsDelivery());
    }
}
