package com.hyeni.calendar;

import org.json.JSONObject;
import org.json.JSONArray;
import org.junit.Test;
import static org.junit.Assert.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Iterator;

public class NotificationCopyLocalizerTest {
    private JSONObject catalog() throws Exception {
        Path file = Path.of("src/main/assets/notification-messages.json");
        if (!Files.exists(file)) file = Path.of("app/src/main/assets/notification-messages.json");
        return new JSONObject(new String(Files.readAllBytes(file), java.nio.charset.StandardCharsets.UTF_8));
    }

    @Test public void everyLanguageAndKindUsesSharedCatalog() throws Exception {
        JSONObject catalog = catalog();
        Iterator<String> locales = catalog.getJSONObject("locales").keys();
        while (locales.hasNext()) {
            String locale = locales.next();
            Iterator<String> ids = catalog.getJSONObject("definitions").keys();
            while (ids.hasNext()) {
                String id = ids.next();
                JSONObject args = new JSONObject().put("child", "민서").put("place", "Park")
                        .put("from", "Home").put("event", "Piano").put("minutes", 15).put("hours", 24);
                JSONObject copy = new JSONObject().put("v", 1).put("id", id).put("args", args);
                String[] display = NotificationCopyLocalizer.render(catalog, locale, copy.toString(), "원제목", "원문");
                if ("ko".equals(locale)) { assertArrayEquals(new String[]{"원제목", "원문"}, display); continue; }
                assertNotEquals(locale + ":" + id, "원문", display[1]);
                assertFalse(display[0].isEmpty());
                assertFalse(display[1].matches(".*\\{(?:child|place|event|minutes|hours)\\}.*"));
                JSONArray definition = catalog.getJSONObject("definitions").getJSONArray(id);
                for (int i = 1; i < definition.length(); i++) {
                    if ("child".equals(definition.getString(i))) assertTrue(display[1].contains("민서"));
                }
            }
        }
    }

    @Test public void invalidContractFallsBackWithoutChangingRawCopy() throws Exception {
        JSONObject catalog = catalog();
        for (Object copy : new Object[]{null, "{", "x".repeat(2201), new JSONObject().put("v", "1").put("id", "sos"),
                new JSONObject().put("v", 1).put("id", "__proto__"),
                new JSONObject().put("v", 1).put("id", "stale").put("args", new JSONObject().put("minutes", -1))}) {
            assertArrayEquals(new String[]{"원제목", "원문"}, NotificationCopyLocalizer.render(catalog, "en", copy, "원제목", "원문"));
        }
        assertFalse(NotificationCopyLocalizer.supports("en|ja"));
        assertFalse(NotificationCopyLocalizer.supports(""));
    }

    @Test public void namesRemainDataAndUnknownLanguageUsesEnglish() throws Exception {
        JSONObject copy = new JSONObject().put("v", 1).put("id", "arrived").put("args",
                new JSONObject().put("child", " \u202e$& {place}\n ").put("place", "東京"));
        String[] expected = {"Location update", "$& {place} arrived at 東京."};
        assertArrayEquals(expected, NotificationCopyLocalizer.render(catalog(), "en", copy, "원제목", "원문"));
        assertArrayEquals(expected, NotificationCopyLocalizer.render(catalog(), "fr", copy, "원제목", "원문"));
    }

    @Test public void eventTimeUsesFamilyDstAndDelayedMarker() throws Exception {
        JSONObject copy = new JSONObject().put("v", 1).put("id", "leftNear")
                .put("args", new JSONObject().put("child", "M").put("place", "P"))
                .put("occurredAt", "2026-03-08T07:01:00.000Z").put("timeZone", "America/New_York").put("delayed", true);
        String body = NotificationCopyLocalizer.render(catalog(), "en", copy, "원제목", "원문")[1];
        assertTrue(body.contains("3:01"));
        assertTrue(body.contains("EDT"));
        assertTrue(body.contains("earlier event"));
    }
}
