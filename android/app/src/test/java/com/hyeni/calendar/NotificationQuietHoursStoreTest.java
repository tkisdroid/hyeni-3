package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.SharedPreferences;

import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import org.junit.Test;

public class NotificationQuietHoursStoreTest {
    @Test
    public void currentSessionUserCanAtomicallySaveAndReadSixKeys() {
        FakePreferences prefs = sessionPreferences("parent-1");

        assertEquals(
            NotificationQuietHoursStore.SaveResult.SAVED,
            NotificationQuietHoursStore.saveIfCurrentSession(
                prefs, "parent-1", true, 1320, 420, "Asia/Seoul", 2_000L
            )
        );

        NotificationQuietHoursStore.Snapshot snapshot = NotificationQuietHoursStore.read(prefs);
        assertEquals("parent-1", snapshot.userId);
        assertTrue(snapshot.enabled);
        assertEquals(1320, snapshot.startMinute);
        assertEquals(420, snapshot.endMinute);
        assertEquals("Asia/Seoul", snapshot.timeZoneId);
        assertEquals(2_000L, snapshot.updatedAtMs);
        assertTrue(prefs.contains(NotificationQuietHoursStore.KEY_USER_ID));
        assertTrue(prefs.contains(NotificationQuietHoursStore.KEY_ENABLED));
        assertTrue(prefs.contains(NotificationQuietHoursStore.KEY_START_MINUTE));
        assertTrue(prefs.contains(NotificationQuietHoursStore.KEY_END_MINUTE));
        assertTrue(prefs.contains(NotificationQuietHoursStore.KEY_TIME_ZONE));
        assertTrue(prefs.contains(NotificationQuietHoursStore.KEY_UPDATED_AT_MS));
    }

    @Test
    public void anotherUserCannotSaveOverCurrentSession() {
        FakePreferences prefs = sessionPreferences("parent-1");
        assertEquals(
            NotificationQuietHoursStore.SaveResult.SAVED,
            NotificationQuietHoursStore.saveIfCurrentSession(
                prefs, "parent-1", true, 1320, 420, "Asia/Seoul", 2_000L
            )
        );

        assertEquals(
            NotificationQuietHoursStore.SaveResult.STALE_SESSION,
            NotificationQuietHoursStore.saveIfCurrentSession(
                prefs, "parent-2", false, 600, 900, "Asia/Seoul", 3_000L
            )
        );
        NotificationQuietHoursStore.Snapshot snapshot = NotificationQuietHoursStore.read(prefs);
        assertEquals("parent-1", snapshot.userId);
        assertTrue(snapshot.enabled);
        assertEquals(2_000L, snapshot.updatedAtMs);
    }

    @Test
    public void olderUpdateForSameUserIsRejectedWithoutClearingSnapshot() {
        FakePreferences prefs = sessionPreferences("parent-1");
        assertEquals(
            NotificationQuietHoursStore.SaveResult.SAVED,
            NotificationQuietHoursStore.saveIfCurrentSession(
                prefs, "parent-1", true, 1320, 420, "Asia/Seoul", 2_000L
            )
        );

        assertEquals(
            NotificationQuietHoursStore.SaveResult.STALE_UPDATE,
            NotificationQuietHoursStore.saveIfCurrentSession(
                prefs, "parent-1", false, 600, 900, "Asia/Seoul", 1_999L
            )
        );
        NotificationQuietHoursStore.Snapshot snapshot = NotificationQuietHoursStore.read(prefs);
        assertTrue(snapshot.enabled);
        assertEquals(1320, snapshot.startMinute);
        assertEquals(420, snapshot.endMinute);
        assertEquals(2_000L, snapshot.updatedAtMs);
    }

    @Test
    public void invalidPolicyIsRejectedWithoutClearingLastGoodSnapshot() {
        FakePreferences prefs = sessionPreferences("parent-1");
        assertEquals(
            NotificationQuietHoursStore.SaveResult.SAVED,
            NotificationQuietHoursStore.saveIfCurrentSession(
                prefs, "parent-1", true, 1320, 420, "Asia/Seoul", 2_000L
            )
        );

        assertEquals(
            NotificationQuietHoursStore.SaveResult.INVALID_POLICY,
            NotificationQuietHoursStore.saveIfCurrentSession(
                prefs, "parent-1", false, 600, 600, "Asia/Seoul", 3_000L
            )
        );
        assertEquals(
            NotificationQuietHoursStore.SaveResult.INVALID_POLICY,
            NotificationQuietHoursStore.saveIfCurrentSession(
                prefs, "parent-1", false, -1, 420, "Asia/Seoul", 3_000L
            )
        );
        assertEquals(
            NotificationQuietHoursStore.SaveResult.INVALID_POLICY,
            NotificationQuietHoursStore.saveIfCurrentSession(
                prefs, "parent-1", false, 600, 900, "Invalid/Zone", 3_000L
            )
        );

        NotificationQuietHoursStore.Snapshot snapshot = NotificationQuietHoursStore.read(prefs);
        assertTrue(snapshot.enabled);
        assertEquals(1320, snapshot.startMinute);
        assertEquals(420, snapshot.endMinute);
        assertEquals(2_000L, snapshot.updatedAtMs);
    }

    @Test
    public void missingSnapshotDefaultsToDisabledSeoulPolicy() {
        NotificationQuietHoursStore.Snapshot snapshot = NotificationQuietHoursStore.read(
            sessionPreferences("parent-1")
        );

        assertEquals("", snapshot.userId);
        assertFalse(snapshot.enabled);
        assertEquals(1320, snapshot.startMinute);
        assertEquals(420, snapshot.endMinute);
        assertEquals("Asia/Seoul", snapshot.timeZoneId);
        assertEquals(0L, snapshot.updatedAtMs);
    }

    private static FakePreferences sessionPreferences(String userId) {
        FakePreferences prefs = new FakePreferences();
        prefs.edit().putString("userId", userId).apply();
        return prefs;
    }

    private static final class FakePreferences implements SharedPreferences {
        private final Map<String, Object> values = new HashMap<>();

        @Override public Map<String, ?> getAll() { return Collections.unmodifiableMap(values); }
        @Override public String getString(String key, String defValue) {
            Object value = values.get(key);
            return value instanceof String ? (String) value : defValue;
        }
        @SuppressWarnings("unchecked")
        @Override public Set<String> getStringSet(String key, Set<String> defValues) {
            Object value = values.get(key);
            return value instanceof Set ? new HashSet<>((Set<String>) value) : defValues;
        }
        @Override public int getInt(String key, int defValue) { return value(key, Integer.class, defValue); }
        @Override public long getLong(String key, long defValue) { return value(key, Long.class, defValue); }
        @Override public float getFloat(String key, float defValue) { return value(key, Float.class, defValue); }
        @Override public boolean getBoolean(String key, boolean defValue) { return value(key, Boolean.class, defValue); }
        @Override public boolean contains(String key) { return values.containsKey(key); }
        @Override public Editor edit() { return new FakeEditor(); }
        @Override public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {}
        @Override public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener) {}

        private <T> T value(String key, Class<T> type, T fallback) {
            Object value = values.get(key);
            return type.isInstance(value) ? type.cast(value) : fallback;
        }

        private final class FakeEditor implements Editor {
            private final Map<String, Object> writes = new HashMap<>();
            private final Set<String> removals = new HashSet<>();
            private boolean clear;

            @Override public Editor putString(String key, String value) { writes.put(key, value); return this; }
            @Override public Editor putStringSet(String key, Set<String> values) {
                writes.put(key, values == null ? null : new HashSet<>(values)); return this;
            }
            @Override public Editor putInt(String key, int value) { writes.put(key, value); return this; }
            @Override public Editor putLong(String key, long value) { writes.put(key, value); return this; }
            @Override public Editor putFloat(String key, float value) { writes.put(key, value); return this; }
            @Override public Editor putBoolean(String key, boolean value) { writes.put(key, value); return this; }
            @Override public Editor remove(String key) { removals.add(key); return this; }
            @Override public Editor clear() { clear = true; return this; }
            @Override public boolean commit() { apply(); return true; }
            @Override public void apply() {
                if (clear) values.clear();
                for (String key : removals) values.remove(key);
                for (Map.Entry<String, Object> entry : writes.entrySet()) {
                    if (entry.getValue() == null) values.remove(entry.getKey());
                    else values.put(entry.getKey(), entry.getValue());
                }
            }
        }
    }
}
