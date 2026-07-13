package com.hyeni.calendar;

import java.net.URI;

/** WebView 권한과 네이티브 브리지는 패키지 내부 origin에만 허용한다. */
final class WebViewOriginPolicy {
    private WebViewOriginPolicy() {}

    static boolean isTrusted(String rawOrigin) {
        if (rawOrigin == null || rawOrigin.isBlank()) return false;
        try {
            URI origin = URI.create(rawOrigin);
            String path = origin.getPath();
            return "https".equalsIgnoreCase(origin.getScheme())
                    && "localhost".equalsIgnoreCase(origin.getHost())
                    && (origin.getPort() == -1 || origin.getPort() == 443)
                    && origin.getUserInfo() == null
                    && origin.getQuery() == null
                    && origin.getFragment() == null
                    && (path == null || path.isEmpty() || "/".equals(path));
        } catch (IllegalArgumentException error) {
            return false;
        }
    }
}
