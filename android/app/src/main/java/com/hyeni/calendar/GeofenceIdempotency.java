package com.hyeni.calendar;

/**
 * 등록장소 geofence 알림 멱등키 — 클라(src/lib/registeredPlaceGeofence.js)·서버
 * (supabase/functions/_shared/registeredPlaceGeofence.js)와 100% 동일한 cyrb128 →
 * UUID v4-형식 결정적 키 (Phase C 하이브리드 geofence dedup).
 *
 * 같은 (kind, childUserId, placeKey, episodeBucket) → 같은 UUID 라, 네이티브 즉시
 * 발사와 서버 cron 발사가 같은 도착/이탈 episode 에 대해 같은 키를 만들어
 * push_idempotency(uuid 컬럼)에서 1건만 통과한다. cross-language parity 는
 * GeofenceIdempotencyTest 의 JS 정본 출력 벡터로 검증한다.
 *
 * 비트 정합 주의: JS Math.imul → Java int 곱셈(자동 32bit wrap), JS `>>>0` →
 * `& 0xFFFFFFFFL`, JS charCodeAt → Java charAt (둘 다 UTF-16 code unit),
 * >Integer.MAX_VALUE 상수는 (int) 캐스트로 동일 비트패턴.
 */
final class GeofenceIdempotency {

    private GeofenceIdempotency() {}

    // cyrb128: 문자열 → 128bit (uint32 4개를 long 으로). registeredPlaceGeofence.js 동일.
    private static long[] cyrb128(String str) {
        int h1 = 1779033703, h2 = (int) 3144134277L, h3 = 1013904242, h4 = (int) 2773480762L;
        final int C1 = 597399067, C2 = (int) 2869860233L, C3 = 951274213, C4 = (int) 2716044179L;
        for (int i = 0; i < str.length(); i++) {
            int k = str.charAt(i);
            h1 = h2 ^ ((h1 ^ k) * C1);
            h2 = h3 ^ ((h2 ^ k) * C2);
            h3 = h4 ^ ((h3 ^ k) * C3);
            h4 = h1 ^ ((h4 ^ k) * C4);
        }
        h1 = (h3 ^ (h1 >>> 18)) * C1;
        h2 = (h4 ^ (h2 >>> 22)) * C2;
        h3 = (h1 ^ (h3 >>> 17)) * C3;
        h4 = (h2 ^ (h4 >>> 19)) * C4;
        return new long[]{ h1 & 0xFFFFFFFFL, h2 & 0xFFFFFFFFL, h3 & 0xFFFFFFFFL, h4 & 0xFFFFFFFFL };
    }

    /**
     * 결정적 UUID v4-형식 멱등키. 입력 문자열 "kind:childUserId:placeKey:episodeBucket".
     * episodeBucket 은 이미 10분으로 나눈 정수 버킷(placeEpisodeBucket 결과)을 넣는다.
     */
    static String placePresenceIdempotencyKey(String kind, String childUserId, String placeKey, long episodeBucket) {
        long[] h = cyrb128(kind + ":" + childUserId + ":" + placeKey + ":" + episodeBucket);
        StringBuilder hexB = new StringBuilder();
        for (long n : h) hexB.append(String.format("%08x", n));
        String hex = hexB.toString();
        String timeHiVer = "4" + hex.substring(13, 16);
        int variant = (Character.digit(hex.charAt(16), 16) & 0x3) | 0x8;
        String clockSeq = Integer.toHexString(variant) + hex.substring(17, 20);
        return hex.substring(0, 8) + "-" + hex.substring(8, 12) + "-" + timeHiVer
                + "-" + clockSeq + "-" + hex.substring(20, 32);
    }

    // episodeMs(에피소드 시각 epoch ms) → 10분 버킷 정수. JS Math.floor(ms/600000) 동일
    // (long 나눗셈 = ms>=0 에서 floor).
    static long placeEpisodeBucket(long episodeMs) {
        return episodeMs / 600000L;
    }
}
