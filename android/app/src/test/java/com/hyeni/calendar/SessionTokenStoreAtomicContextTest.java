package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.SharedPreferences;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import org.junit.Test;

public class SessionTokenStoreAtomicContextTest {
    private static String jwt(String subject, long issuedAt) {
        String payload = "{\"sub\":\"" + subject + "\",\"iat\":" + issuedAt + "}";
        return "header." + Base64.getUrlEncoder().withoutPadding()
            .encodeToString(payload.getBytes(StandardCharsets.UTF_8)) + ".signature";
    }

    @Test
    public void delayedRetiredNonceCannotRestoreIdentityAfterClear() {
        FakePreferences prefs = new FakePreferences();
        String oldAccess = jwt("old-user", 100);
        assertTrue(writeContext(prefs, oldAccess, "old-refresh", "old-nonce", "old-user", true).acceptedIncoming);

        SessionTokenStore.clear(prefs, "old-nonce");
        SessionTokenStore.ContextSnapshot delayed = writeContext(
            prefs, oldAccess, "old-refresh", "old-nonce", "old-user", true
        );

        assertFalse(delayed.acceptedIncoming);
        assertEquals("", prefs.getString("userId", ""));
        assertEquals("", prefs.getString("familyId", ""));
        assertEquals("", prefs.getString("role", ""));
        assertEquals("", prefs.getString("accessToken", ""));
        assertFalse(prefs.getBoolean("serviceEnabled", false));
    }

    @Test
    public void rejectedOlderWriterKeepsCurrentIdentityAndServiceState() {
        FakePreferences prefs = new FakePreferences();
        String currentAccess = jwt("child-1", 200);
        assertTrue(writeContext(prefs, currentAccess, "refresh-2", "nonce-2", "child-1", true).acceptedIncoming);

        SessionTokenStore.ContextSnapshot delayed = writeContext(
            prefs, jwt("child-1", 100), "refresh-1", "nonce-2", "wrong-user", false
        );

        assertFalse(delayed.acceptedIncoming);
        assertEquals("child-1", prefs.getString("userId", ""));
        assertEquals("family-child-1", prefs.getString("familyId", ""));
        assertEquals(currentAccess, prefs.getString("accessToken", ""));
        assertTrue(prefs.getBoolean("serviceEnabled", false));
    }

    @Test
    public void acceptedNewLoginCommitsMatchingContextAndTokensTogether() {
        FakePreferences prefs = new FakePreferences();
        assertTrue(writeContext(
            prefs, jwt("new-user", 300), "new-refresh", "new-nonce", "new-user", true
        ).acceptedIncoming);

        SessionTokenStore.ContextSnapshot stored = SessionTokenStore.readContext(prefs);
        assertEquals("new-user", stored.userId);
        assertEquals("family-new-user", stored.familyId);
        assertEquals("parent", stored.role);
        assertEquals(jwt("new-user", 300), stored.accessToken);
        assertEquals("new-refresh", stored.refreshToken);
        assertTrue(stored.serviceEnabled);
    }

    @Test
    public void sameAccessTokenCannotBeRelabeledAsAnotherUser() {
        FakePreferences prefs = new FakePreferences();
        String access = jwt("child-1", 400);
        assertTrue(writeContext(prefs, access, "refresh", "nonce", "child-1", true).acceptedIncoming);

        SessionTokenStore.ContextSnapshot rejected = writeContext(
            prefs, access, "refresh", "nonce", "wrong-user", true
        );

        assertFalse(rejected.acceptedIncoming);
        assertEquals("child-1", rejected.userId);
        assertEquals("family-child-1", rejected.familyId);
        assertEquals(access, rejected.accessToken);
    }

    @Test
    public void delayedRefreshCannotOverwriteAReplacedIdentity() {
        FakePreferences prefs = new FakePreferences();
        assertTrue(writeContext(
            prefs, jwt("old-user", 100), "old-refresh", "old-nonce", "old-user", true
        ).acceptedIncoming);
        long generation = SessionTokenStore.generation();
        assertTrue(writeContext(
            prefs, jwt("new-user", 200), "new-refresh", "new-nonce", "new-user", true
        ).acceptedIncoming);

        SessionTokenStore.Snapshot delayed = SessionTokenStore.reconcileIfGeneration(
            prefs,
            jwt("old-user", 300),
            "rotated-old-refresh",
            true,
            generation,
            "old-user",
            "family-old-user",
            "parent"
        );

        assertEquals(null, delayed);
        assertEquals("new-user", SessionTokenStore.readContext(prefs).userId);
        assertEquals("new-refresh", SessionTokenStore.readContext(prefs).refreshToken);
    }

    private static SessionTokenStore.ContextSnapshot writeContext(
        SharedPreferences prefs,
        String access,
        String refresh,
        String nonce,
        String userId,
        boolean serviceEnabled
    ) {
        return SessionTokenStore.reconcileContext(
            prefs,
            access,
            refresh,
            false,
            nonce,
            userId,
            "family-" + userId,
            "parent",
            "https://api.example",
            "public-key",
            serviceEnabled,
            "balanced"
        );
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
