package com.hyeni.calendar;

import java.util.IllformedLocaleException;
import java.util.Locale;

final class SpeechLocalePolicy {
    static final String DEFAULT_LANGUAGE_TAG = "ko-KR";
    private static final Locale DEFAULT_LOCALE =
        Locale.forLanguageTag(DEFAULT_LANGUAGE_TAG);

    @FunctionalInterface
    interface LanguageSetter {
        int setLanguage(Locale locale);
    }

    private SpeechLocalePolicy() {}

    static Locale resolve(String rawTag) {
        String tag = rawTag == null ? "" : rawTag.trim();
        if (tag.isEmpty()) return DEFAULT_LOCALE;
        try {
            Locale locale = new Locale.Builder().setLanguageTag(tag).build();
            return locale.getLanguage().isEmpty() ? DEFAULT_LOCALE : locale;
        } catch (IllformedLocaleException ignored) {
            return DEFAULT_LOCALE;
        }
    }

    static boolean apply(String rawTag, LanguageSetter setter) {
        return setter.setLanguage(resolve(rawTag)) >= 0;
    }
}
