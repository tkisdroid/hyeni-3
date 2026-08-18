package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;

public class SpeechLocalePolicyTest {
    private static final String[] SUPPORTED_TAGS = {
        "ko-KR", "en-US", "ja-JP", "zh-CN", "zh-TW",
        "vi-VN", "th-TH", "id-ID", "ms-MY", "fil-PH"
    };

    @Test
    public void supportedTagsReachTheLanguageSetterExactly() {
        for (String tag : SUPPORTED_TAGS) {
            AtomicReference<String> applied = new AtomicReference<>();
            assertTrue(SpeechLocalePolicy.apply(tag, locale -> {
                applied.set(locale.toLanguageTag());
                return 0;
            }));
            assertEquals(tag, applied.get());
        }
    }

    @Test
    public void blankAndIllFormedTagsFallBackToKorean() {
        for (String tag : new String[] { null, "", "   ", "not_a_tag", "en--US" }) {
            AtomicReference<String> applied = new AtomicReference<>();
            assertTrue(SpeechLocalePolicy.apply(tag, locale -> {
                applied.set(locale.toLanguageTag());
                return 0;
            }));
            assertEquals("ko-KR", applied.get());
        }
    }

    @Test
    public void onlyNonNegativeTtsStatusesAreUsable() {
        assertFalse(SpeechLocalePolicy.apply("ko-KR", locale -> -1));
        assertFalse(SpeechLocalePolicy.apply("ko-KR", locale -> -2));
        assertTrue(SpeechLocalePolicy.apply("ko-KR", locale -> 0));
        assertTrue(SpeechLocalePolicy.apply("ko-KR", locale -> 1));
        assertTrue(SpeechLocalePolicy.apply("ko-KR", locale -> 2));
    }
}
