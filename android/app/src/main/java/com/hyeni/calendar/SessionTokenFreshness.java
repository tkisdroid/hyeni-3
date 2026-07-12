package com.hyeni.calendar;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** WebView가 네이티브 저장소의 더 최신 JWT를 덮지 않도록 발급시각을 비교한다. */
final class SessionTokenFreshness {
    private SessionTokenFreshness() {}

    static boolean shouldReplaceStored(String storedAccess, String incomingAccess) {
        return shouldReplaceStored(storedAccess, incomingAccess, false);
    }

    static boolean shouldReplaceStored(
        String storedAccess,
        String incomingAccess,
        boolean allowEqualIssuedAt
    ) {
        if (isBlank(incomingAccess)) return false;
        if (isBlank(storedAccess) || storedAccess.equals(incomingAccess)) return true;

        Claims stored = readClaims(storedAccess);
        Claims incoming = readClaims(incomingAccess);
        // 레거시·비 JWT 토큰은 기존 동작을 유지한다. Worker JWT끼리만 downgrade를 막는다.
        if (stored == null || incoming == null) return true;
        // 명시적 재로그인·재페어링으로 사용자가 바뀐 세션은 받아야 한다.
        if (!stored.subject.equals(incoming.subject)) return true;
        if (incoming.issuedAt > stored.issuedAt) return true;
        // iat는 초 단위다. 동일 초 예외는 서버 refresh 응답임을 호출부가 증명한 경우만 허용한다.
        return allowEqualIssuedAt && incoming.issuedAt == stored.issuedAt;
    }

    private static Claims readClaims(String token) {
        try {
            String[] parts = token.split("\\.");
            if (parts.length < 2) return null;
            String json = new String(decodeBase64Url(parts[1]), StandardCharsets.UTF_8);
            JSONObject payload = new JSONObject(json);
            String subject = payload.optString("sub", "").trim();
            long issuedAt = payload.optLong("iat", 0L);
            if (subject.isEmpty() || issuedAt <= 0L) return null;
            return new Claims(subject, issuedAt);
        } catch (Exception ignored) {
            return null;
        }
    }

    // android.util.Base64에 의존하지 않는 순수 decoder라 로컬 JVM 단위테스트에서도 동일하게 동작한다.
    private static byte[] decodeBase64Url(String encoded) {
        ByteArrayOutputStream out = new ByteArrayOutputStream((encoded.length() * 3) / 4);
        int buffer = 0;
        int bits = 0;
        for (int i = 0; i < encoded.length(); i++) {
            char ch = encoded.charAt(i);
            if (ch == '=') break;
            int value = base64UrlValue(ch);
            if (value < 0) throw new IllegalArgumentException("invalid base64url");
            buffer = (buffer << 6) | value;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                out.write((buffer >> bits) & 0xff);
            }
        }
        return out.toByteArray();
    }

    private static int base64UrlValue(char ch) {
        if (ch >= 'A' && ch <= 'Z') return ch - 'A';
        if (ch >= 'a' && ch <= 'z') return ch - 'a' + 26;
        if (ch >= '0' && ch <= '9') return ch - '0' + 52;
        if (ch == '-' || ch == '+') return 62;
        if (ch == '_' || ch == '/') return 63;
        return -1;
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    private static final class Claims {
        final String subject;
        final long issuedAt;

        Claims(String subject, long issuedAt) {
            this.subject = subject;
            this.issuedAt = issuedAt;
        }
    }
}
