package com.hyeni.calendar;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SpeechPlaybackGenerationTest {
    @Test
    public void cancelInvalidatesAnInitializingRequest() {
        SpeechPlaybackGeneration generation = new SpeechPlaybackGeneration();
        long request = generation.next();
        assertTrue(generation.isCurrent(request));
        generation.cancel();
        assertFalse(generation.isCurrent(request));
    }

    @Test
    public void newerRequestInvalidatesThePreviousRequest() {
        SpeechPlaybackGeneration generation = new SpeechPlaybackGeneration();
        long first = generation.next();
        long second = generation.next();
        assertFalse(generation.isCurrent(first));
        assertTrue(generation.isCurrent(second));
    }
}
