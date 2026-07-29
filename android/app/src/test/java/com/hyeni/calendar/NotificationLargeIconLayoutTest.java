package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NotificationLargeIconLayoutTest {

    /** 실제 자산 비율(세로가 더 긴 혜니 캐릭터). 위아래가 잘리지 않아야 한다. */
    @Test
    public void portraitSourceIsContainedWithoutCropping() {
        NotificationLargeIconLayout.Box box = NotificationLargeIconLayout.contain(
            900,
            1130,
            192,
            NotificationLargeIconLayout.SAFE_RATIO
        );

        int safe = Math.round(192 * NotificationLargeIconLayout.SAFE_RATIO);
        // 긴 변(세로)이 safe 한 변에 맞고, 캔버스를 넘지 않는다.
        assertEquals(safe, box.height);
        assertTrue(box.width <= safe);
        assertTrue(box.top >= 0);
        assertTrue(box.left >= 0);
        assertTrue(box.top + box.height <= 192);
        assertTrue(box.left + box.width <= 192);
        // 원본 비율을 유지한다(자르지 않는다).
        assertEquals(900d / 1130d, (double) box.width / box.height, 0.01d);
    }

    @Test
    public void landscapeSourceIsContainedAndVerticallyCentered() {
        NotificationLargeIconLayout.Box box = NotificationLargeIconLayout.contain(
            1200,
            600,
            192,
            NotificationLargeIconLayout.SAFE_RATIO
        );

        int safe = Math.round(192 * NotificationLargeIconLayout.SAFE_RATIO);
        // 긴 변(가로)이 safe 한 변에 맞고 2:1 비율을 유지한다.
        assertEquals(safe, box.width);
        assertEquals(2d, (double) box.width / box.height, 0.02d);
        // 짧은 변은 캔버스 가운데(반올림 1px 이내)에 온다.
        assertTrue(
            "세로 중앙 정렬",
            Math.abs(box.top - (192 - box.height) / 2d) <= 0.5d
        );
        assertTrue(box.top + box.height <= 192);
    }

    @Test
    public void squareSourceKeepsCircularCropMargin() {
        NotificationLargeIconLayout.Box box = NotificationLargeIconLayout.contain(
            512,
            512,
            192,
            NotificationLargeIconLayout.SAFE_RATIO
        );

        assertTrue("정사각 원본도 원형 크롭 여유를 남긴다", box.width < 192);
        assertEquals(box.width, box.height);
        assertEquals(box.left, box.top);
    }

    @Test
    public void invalidInputProducesEmptyBox() {
        assertTrue(NotificationLargeIconLayout.contain(0, 100, 192, 0.82f).isEmpty());
        assertTrue(NotificationLargeIconLayout.contain(100, 0, 192, 0.82f).isEmpty());
        assertTrue(NotificationLargeIconLayout.contain(100, 100, 0, 0.82f).isEmpty());
    }

    @Test
    public void invalidSafeRatioFallsBackToFullCanvas() {
        NotificationLargeIconLayout.Box box =
            NotificationLargeIconLayout.contain(100, 100, 192, 0f);
        assertEquals(192, box.width);
        assertEquals(192, box.height);
    }

    @Test
    public void canvasSizeIsClampedToSafeRange() {
        assertEquals(NotificationLargeIconLayout.DEFAULT_CANVAS_PX,
            NotificationLargeIconLayout.clampCanvasSize(0));
        assertEquals(NotificationLargeIconLayout.DEFAULT_CANVAS_PX,
            NotificationLargeIconLayout.clampCanvasSize(-5));
        assertEquals(NotificationLargeIconLayout.MIN_CANVAS_PX,
            NotificationLargeIconLayout.clampCanvasSize(32));
        assertEquals(NotificationLargeIconLayout.MAX_CANVAS_PX,
            NotificationLargeIconLayout.clampCanvasSize(4096));
        assertEquals(192, NotificationLargeIconLayout.clampCanvasSize(192));
    }

    @Test
    public void sampleSizeShrinksLargeSourcesByPowersOfTwo() {
        assertEquals(4, NotificationLargeIconLayout.sampleSize(900, 1130, 192));
        assertEquals(1, NotificationLargeIconLayout.sampleSize(200, 220, 192));
        assertEquals(1, NotificationLargeIconLayout.sampleSize(0, 0, 192));
        assertEquals(1, NotificationLargeIconLayout.sampleSize(900, 1130, 0));
    }
}
