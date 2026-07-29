package com.hyeni.calendar;

/**
 * 알림 큰 아이콘을 정사각형으로 맞추는 순수 기하 계산.
 *
 * Android 는 큰 아이콘을 정사각 슬롯에 넣고 원형(또는 둥근 사각)으로 잘라 그린다. 혜니 캐릭터 원본은
 * 세로가 더 긴 비율이고 인물이 위아래 끝까지 닿아 있어서, 시스템이 채우기(center-crop)로 맞추면
 * 머리 위와 옷 아래가 잘렸다(2026-07-29 TK 제보 — "알림 아이콘 위아래가 잘린다").
 *
 * 그래서 잘라내지 않고(contain) 원형 크롭 여유를 남긴 크기로 줄여 정사각 캔버스 가운데에 그린다.
 * Android 프레임워크에 의존하지 않으므로 JVM 단위 테스트로 검증한다.
 */
final class NotificationLargeIconLayout {

    /** 정사각 한 변에서 그림이 차지할 최대 비율. 나머지는 원형 크롭 여유. */
    static final float SAFE_RATIO = 0.82f;
    /** 시스템 치수를 읽지 못할 때 쓰는 기본 한 변(px). 64dp @xxhdpi 근사. */
    static final int DEFAULT_CANVAS_PX = 192;
    static final int MIN_CANVAS_PX = 96;
    static final int MAX_CANVAS_PX = 384;

    private NotificationLargeIconLayout() {}

    /** contain 배치 결과(정수 px). 원본을 자르지 않는다. */
    static final class Box {
        final int left;
        final int top;
        final int width;
        final int height;

        Box(int left, int top, int width, int height) {
            this.left = left;
            this.top = top;
            this.width = width;
            this.height = height;
        }

        boolean isEmpty() {
            return width <= 0 || height <= 0;
        }
    }

    /**
     * 원본을 자르지 않고 정사각 캔버스의 safe 영역에 꽉 맞춘 위치를 계산한다.
     * 긴 변이 safe 한 변에 맞고 짧은 변은 가운데 정렬한다. 잘못된 입력은 빈 Box.
     */
    static Box contain(int sourceWidth, int sourceHeight, int canvasSize, float safeRatio) {
        if (sourceWidth <= 0 || sourceHeight <= 0 || canvasSize <= 0) {
            return new Box(0, 0, 0, 0);
        }
        float ratio = (safeRatio <= 0f || safeRatio > 1f || Float.isNaN(safeRatio))
            ? 1f
            : safeRatio;
        int safe = Math.max(1, Math.round(canvasSize * ratio));
        float scale = Math.min((float) safe / sourceWidth, (float) safe / sourceHeight);
        int width = Math.max(1, Math.round(sourceWidth * scale));
        int height = Math.max(1, Math.round(sourceHeight * scale));
        return new Box(
            Math.round((canvasSize - width) / 2f),
            Math.round((canvasSize - height) / 2f),
            width,
            height
        );
    }

    /** 시스템이 알려준 큰 아이콘 한 변을 안전한 범위로 좁힌다. */
    static int clampCanvasSize(int px) {
        if (px <= 0) return DEFAULT_CANVAS_PX;
        if (px < MIN_CANVAS_PX) return MIN_CANVAS_PX;
        if (px > MAX_CANVAS_PX) return MAX_CANVAS_PX;
        return px;
    }

    /**
     * 큰 원본을 통째로 디코딩하지 않도록 2의 거듭제곱 축소 비율을 고른다.
     * 짧은 변이 목표 px 이상으로 남는 가장 큰 축소값을 쓴다(품질 손실 없이 메모리만 줄인다).
     */
    static int sampleSize(int sourceWidth, int sourceHeight, int targetPx) {
        if (sourceWidth <= 0 || sourceHeight <= 0 || targetPx <= 0) return 1;
        int shortest = Math.min(sourceWidth, sourceHeight);
        int sample = 1;
        while (shortest / (sample * 2) >= targetPx) {
            sample *= 2;
        }
        return sample;
    }
}
