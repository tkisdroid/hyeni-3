package com.hyeni.calendar;

/** 서로 다른 기능의 알림이 한 묶음으로 접혀 메시지가 가려지지 않게 그룹을 분리한다. */
final class NotificationGroupPolicy {
    static final String GROUP_FAMILY_MESSAGE = "hyeni.group.family_message";
    static final String GROUP_AI_FRIEND = "hyeni.group.ai_friend";
    static final String GROUP_STICKER = "hyeni.group.sticker";
    static final String GROUP_SCHEDULE = "hyeni.group.schedule";
    static final String GROUP_SAFETY = "hyeni.group.safety";
    static final String GROUP_EMERGENCY = "hyeni.group.emergency";
    static final String GROUP_KKUK = "hyeni.group.kkuk";
    static final String GROUP_INFORMATION = "hyeni.group.information";
    static final String GROUP_LOCATION_STATUS = "hyeni.group.location_status";

    private NotificationGroupPolicy() {}

    static String groupFor(String logicalChannel) {
        if (logicalChannel == null) return GROUP_SCHEDULE;
        switch (logicalChannel) {
            case "family_message": return GROUP_FAMILY_MESSAGE;
            case "ai_friend": return GROUP_AI_FRIEND;
            case "sticker": return GROUP_STICKER;
            case "safety": return GROUP_SAFETY;
            case "emergency": return GROUP_EMERGENCY;
            case "kkuk": return GROUP_KKUK;
            case "silent": return GROUP_INFORMATION;
            default: return GROUP_SCHEDULE;
        }
    }
}
