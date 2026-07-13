package com.hyeni.calendar;

import java.util.Locale;

/** 서버 pending 중 화면에 표시할 알림과 LocationService가 처리할 명령을 분리한다. */
final class PendingNotificationTypePolicy {
    private PendingNotificationTypePolicy() {}

    static boolean isDisplayNotification(String type) {
        String normalized = type == null ? "" : type.trim().toLowerCase(Locale.ROOT);
        return !"request_location".equals(normalized)
            && !"request_device_status".equals(normalized)
            && !"remote_listen".equals(normalized)
            && !"remote_listen_stop".equals(normalized);
    }
}
