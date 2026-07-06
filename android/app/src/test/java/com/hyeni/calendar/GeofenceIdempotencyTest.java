package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * GeofenceIdempotency cross-language parity 테스트.
 *
 * 기대 UUID 는 JS 정본 src/lib/registeredPlaceGeofence.js 의 placePresenceIdempotencyKey
 * 를 node 로 실행해 산출한 고정 벡터다(2026-06-02). 이 값이 어긋나면 cyrb128 비트
 * 포팅이 틀린 것 → 네이티브/클라/서버 3중 발사가 dedup 안 됨. 정본 JS 가 바뀌면 이
 * 벡터도 함께 갱신해야 한다(tests/serverRegisteredPlaceGeofence.test.js 가 JS측 가드).
 */
public class GeofenceIdempotencyTest {

    @Test
    public void matchesJsReferenceVectors() {
        // [kind, childUserId, placeKey, bucket] => JS placePresenceIdempotencyKey 출력
        assertEquals(
                "099a368c-e93b-4942-980f-12c13f31517b",
                GeofenceIdempotency.placePresenceIdempotencyKey(
                        "arrived", "90f356ac-4f9d-4736-9771-c2a9ccb7de36",
                        "registered:saved_place:e716b5d9-3789-4e78-9081-d15316f2800e", 2967287L));
        assertEquals(
                "a977217d-f0bd-4581-b062-46e57270eba3",
                GeofenceIdempotency.placePresenceIdempotencyKey(
                        "left", "90f356ac-4f9d-4736-9771-c2a9ccb7de36",
                        "registered:academy:abc-123", 2967290L));
        assertEquals(
                "7eedc34d-1266-4ece-9954-658210e085e3",
                GeofenceIdempotency.placePresenceIdempotencyKey(
                        "arrived", "d02eca01-342b-44c4-9056-650f1c73ddeb",
                        "registered:saved_place:xyz", 0L));
    }

    @Test
    public void isUuidV4Format() {
        String k = GeofenceIdempotency.placePresenceIdempotencyKey("arrived", "child", "place", 100L);
        assertTrue("UUID v4 format", k.matches(
                "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"));
    }

    @Test
    public void differsByBucketAndKind() {
        String a100 = GeofenceIdempotency.placePresenceIdempotencyKey("arrived", "c", "p", 100L);
        String a101 = GeofenceIdempotency.placePresenceIdempotencyKey("arrived", "c", "p", 101L);
        String l100 = GeofenceIdempotency.placePresenceIdempotencyKey("left", "c", "p", 100L);
        assertNotEquals(a100, a101);
        assertNotEquals(a100, l100);
        // deterministic
        assertEquals(a100, GeofenceIdempotency.placePresenceIdempotencyKey("arrived", "c", "p", 100L));
    }

    @Test
    public void episodeBucketFloors() {
        assertEquals(0L, GeofenceIdempotency.placeEpisodeBucket(0L));
        assertEquals(0L, GeofenceIdempotency.placeEpisodeBucket(599999L));
        assertEquals(1L, GeofenceIdempotency.placeEpisodeBucket(600000L));
        assertEquals(2967287L, GeofenceIdempotency.placeEpisodeBucket(2967287L * 600000L + 123L));
    }
}
