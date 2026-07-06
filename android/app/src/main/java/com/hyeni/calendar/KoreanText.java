package com.hyeni.calendar;

final class KoreanText {
    private KoreanText() {}

    static String withSubjectParticle(String text) {
        return withParticle(text, "이", "가");
    }

    static String withObjectParticle(String text) {
        return withParticle(text, "을", "를");
    }

    private static String withParticle(String text, String withJong, String withoutJong) {
        if (isBlank(text)) return "";
        String trimmed = text.trim();
        return trimmed + (hasJongseong(trimmed) ? withJong : withoutJong);
    }

    private static boolean hasJongseong(String text) {
        if (isBlank(text)) return false;
        int last = text.charAt(text.length() - 1);
        if (last < 0xAC00 || last > 0xD7A3) return false;
        return ((last - 0xAC00) % 28) != 0;
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
