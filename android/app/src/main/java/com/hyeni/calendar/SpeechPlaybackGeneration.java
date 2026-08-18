package com.hyeni.calendar;

final class SpeechPlaybackGeneration {
    private long current = 0L;

    long next() {
        current += 1L;
        return current;
    }

    void cancel() {
        current += 1L;
    }

    boolean isCurrent(long generation) {
        return generation == current;
    }
}
