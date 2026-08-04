package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;

import android.app.ActivityOptions;

import org.junit.Test;

public class UrgentActivityPendingIntentTest {

    @Test
    public void android36UsesExplicitAlwaysAllowedCreatorMode() {
        assertEquals(
            ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_ALWAYS,
            UrgentActivityPendingIntent.creatorBackgroundStartMode(36)
        );
    }

    @SuppressWarnings("deprecation")
    @Test
    public void android34And35UseLegacyAllowedCreatorMode() {
        assertEquals(
            ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED,
            UrgentActivityPendingIntent.creatorBackgroundStartMode(34)
        );
        assertEquals(
            ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED,
            UrgentActivityPendingIntent.creatorBackgroundStartMode(35)
        );
    }

    @Test
    public void olderAndroidKeepsSystemDefaultMode() {
        assertEquals(
            ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_SYSTEM_DEFINED,
            UrgentActivityPendingIntent.creatorBackgroundStartMode(33)
        );
    }
}
