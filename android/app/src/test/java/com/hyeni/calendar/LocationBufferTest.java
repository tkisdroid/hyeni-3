package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;

import org.junit.Before;
import org.junit.Test;

import java.io.File;
import java.io.FileWriter;
import java.util.List;

/**
 * LocationBuffer 파일 기반 오프라인 위치 큐 단위 테스트.
 */
public class LocationBufferTest {

    private File bufferFile;

    @Before
    public void setUp() throws Exception {
        bufferFile = File.createTempFile("location_buffer_test", ".jsonl");
        bufferFile.delete(); // 빈 상태로 시작 — append 가 새로 만든다
        bufferFile.deleteOnExit();
    }

    @Test
    public void appendThenReadAll_preservesOrder() {
        LocationBuffer.append(bufferFile, 37.1, 127.1, 10f, 1000L);
        LocationBuffer.append(bufferFile, 37.2, 127.2, 12f, 2000L);
        LocationBuffer.append(bufferFile, 37.3, 127.3, 8f, 3000L);

        List<LocationBuffer.BufferedPoint> points = LocationBuffer.readAll(bufferFile);
        assertEquals(3, points.size());
        assertEquals(1000L, points.get(0).recordedAtMs);
        assertEquals(2000L, points.get(1).recordedAtMs);
        assertEquals(3000L, points.get(2).recordedAtMs);
        assertEquals(37.2, points.get(1).lat, 1e-9);
        assertEquals(127.2, points.get(1).lng, 1e-9);
    }

    @Test
    public void removeFirst_removesOnlyLeadingLines() {
        LocationBuffer.append(bufferFile, 1, 1, 0f, 1000L);
        LocationBuffer.append(bufferFile, 2, 2, 0f, 2000L);
        LocationBuffer.append(bufferFile, 3, 3, 0f, 3000L);

        LocationBuffer.removeFirst(bufferFile, 2);

        List<LocationBuffer.BufferedPoint> points = LocationBuffer.readAll(bufferFile);
        assertEquals(1, points.size());
        assertEquals(3000L, points.get(0).recordedAtMs);
    }

    @Test
    public void removeFirst_moreThanSize_clearsAll() {
        LocationBuffer.append(bufferFile, 1, 1, 0f, 1000L);
        LocationBuffer.removeFirst(bufferFile, 5);
        assertEquals(0, LocationBuffer.readAll(bufferFile).size());
    }

    @Test
    public void removeMatching_removesOnlyExactPoint() {
        LocationBuffer.append(bufferFile, 1, 1, 0f, 1000L);
        LocationBuffer.append(bufferFile, 2, 2, 0f, 2000L);
        LocationBuffer.append(bufferFile, 3, 3, 0f, 3000L);

        LocationBuffer.removeMatching(bufferFile, 2, 2, 2000L);

        List<LocationBuffer.BufferedPoint> points = LocationBuffer.readAll(bufferFile);
        assertEquals(2, points.size());
        assertEquals(1000L, points.get(0).recordedAtMs);
        assertEquals(3000L, points.get(1).recordedAtMs);
    }

    @Test
    public void removeMatching_whenAlreadyGone_keepsOtherPoints() {
        LocationBuffer.append(bufferFile, 3, 3, 0f, 3000L);

        LocationBuffer.removeMatching(bufferFile, 2, 2, 2000L);

        List<LocationBuffer.BufferedPoint> points = LocationBuffer.readAll(bufferFile);
        assertEquals(1, points.size());
        assertEquals(3000L, points.get(0).recordedAtMs);
    }

    @Test
    public void prune_dropsPointsOlderThanMaxAge() {
        long now = System.currentTimeMillis();
        LocationBuffer.append(bufferFile, 1, 1, 0f, now - (49L * 3600_000L)); // 49h 전 — 폐기
        LocationBuffer.append(bufferFile, 2, 2, 0f, now - (1L * 3600_000L));  // 1h 전 — 보존

        LocationBuffer.prune(bufferFile, 48L * 3600_000L);

        List<LocationBuffer.BufferedPoint> points = LocationBuffer.readAll(bufferFile);
        assertEquals(1, points.size());
        assertEquals(2.0, points.get(0).lat, 1e-9);
    }

    @Test
    public void trimToMaxLines_dropsOldestBeyondCap() {
        for (int i = 1; i <= 5; i++) {
            LocationBuffer.append(bufferFile, i, i, 0f, i * 1000L);
        }

        LocationBuffer.trimToMaxLines(bufferFile, 3);

        List<LocationBuffer.BufferedPoint> points = LocationBuffer.readAll(bufferFile);
        assertEquals(3, points.size()); // 가장 오래된 2점 제거, 최신 3점만 보존
        assertEquals(3000L, points.get(0).recordedAtMs);
        assertEquals(5000L, points.get(2).recordedAtMs);
    }

    @Test
    public void trimToMaxLines_underCap_keepsAll() {
        LocationBuffer.append(bufferFile, 1, 1, 0f, 1000L);
        LocationBuffer.append(bufferFile, 2, 2, 0f, 2000L);

        LocationBuffer.trimToMaxLines(bufferFile, 10);

        assertEquals(2, LocationBuffer.readAll(bufferFile).size());
    }

    @Test
    public void readAll_skipsCorruptLines() throws Exception {
        LocationBuffer.append(bufferFile, 37.5, 127.5, 5f, 1000L);
        try (FileWriter writer = new FileWriter(bufferFile, true)) {
            writer.write("this-is-not-json\n");
        }
        LocationBuffer.append(bufferFile, 37.6, 127.6, 5f, 2000L);

        List<LocationBuffer.BufferedPoint> points = LocationBuffer.readAll(bufferFile);
        assertEquals(2, points.size()); // 손상 줄은 건너뛰고 유효 2점만
        assertEquals(1000L, points.get(0).recordedAtMs);
        assertEquals(2000L, points.get(1).recordedAtMs);
    }
}
