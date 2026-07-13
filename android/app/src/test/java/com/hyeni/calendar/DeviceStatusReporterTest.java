package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.app.usage.UsageEvents;
import android.telephony.TelephonyManager;

import org.junit.Test;

/**
 * DeviceStatusReporter.sumScreenOnMs 단위 테스트.
 * 화면 ON/OFF 이벤트로 구간 내 총 화면 켜짐 시간을 계산하는 순수 함수의 edge case 검증.
 */
public class DeviceStatusReporterTest {

    private static final int ON = DeviceStatusReporter.EVENT_SCREEN_INTERACTIVE;
    private static final int OFF = DeviceStatusReporter.EVENT_SCREEN_NON_INTERACTIVE;
    private static final long START = 1_000_000L;
    private static final long WINDOW = 3_600_000L; // 1시간
    private static final long END = START + WINDOW;

    @Test
    public void noEvents_screenOff_returnsZero() {
        assertEquals(0L, DeviceStatusReporter.sumScreenOnMs(new long[0], new int[0], START, END, false));
    }

    @Test
    public void noEvents_screenOnNow_returnsWholeWindow() {
        // 구간 내 토글이 전혀 없는데 지금 켜져 있음 → 종일 켜짐
        assertEquals(WINDOW, DeviceStatusReporter.sumScreenOnMs(new long[0], new int[0], START, END, true));
    }

    @Test
    public void onThenOff_countsInterval() {
        long[] ts = { START + 600_000L, START + 1_200_000L };
        int[] ty = { ON, OFF };
        assertEquals(600_000L, DeviceStatusReporter.sumScreenOnMs(ts, ty, START, END, false));
    }

    @Test
    public void onWithoutOff_countsToWindowEnd() {
        // 켜진 뒤 끄지 않음 → 구간 끝까지 카운트
        long[] ts = { START + 600_000L };
        int[] ty = { ON };
        assertEquals(WINDOW - 600_000L, DeviceStatusReporter.sumScreenOnMs(ts, ty, START, END, true));
    }

    @Test
    public void firstEventOff_countsFromWindowStart() {
        // 자정 이전부터 켜져 있다가 구간 중간에 꺼짐 → windowStart 부터 카운트
        long[] ts = { START + 300_000L };
        int[] ty = { OFF };
        assertEquals(300_000L, DeviceStatusReporter.sumScreenOnMs(ts, ty, START, END, false));
    }

    @Test
    public void multipleIntervals_sum() {
        long[] ts = { START + 100_000L, START + 200_000L, START + 500_000L, START + 800_000L };
        int[] ty = { ON, OFF, ON, OFF };
        assertEquals(100_000L + 300_000L, DeviceStatusReporter.sumScreenOnMs(ts, ty, START, END, false));
    }

    @Test
    public void eventsOutsideWindow_clampedToWindow() {
        long[] ts = { START - 999L, END + 999L };
        int[] ty = { ON, OFF };
        assertEquals(WINDOW, DeviceStatusReporter.sumScreenOnMs(ts, ty, START, END, false));
    }

    @Test
    public void unrelatedEventTypes_ignored() {
        // 화면 이벤트가 아닌 type(99)은 무시 — ON/OFF 한 쌍만 합산
        long[] ts = { START + 100_000L, START + 150_000L, START + 400_000L };
        int[] ty = { 99, ON, OFF };
        assertEquals(250_000L, DeviceStatusReporter.sumScreenOnMs(ts, ty, START, END, false));
    }

    @Test
    public void invalidWindow_returnsZero() {
        assertEquals(0L, DeviceStatusReporter.sumScreenOnMs(new long[0], new int[0], END, START, true));
    }

    @Test
    public void keyguardHidden_onlyCountsActualUnlock() {
        assertTrue(DeviceStatusReporter.isKeyguardHiddenEvent(UsageEvents.Event.KEYGUARD_HIDDEN));
        assertFalse(DeviceStatusReporter.isKeyguardHiddenEvent(ON));
        assertFalse(DeviceStatusReporter.isKeyguardHiddenEvent(OFF));
    }

    @Test
    public void normalizeConnectionType_wifi_returnsHyphenatedWifi() {
        assertEquals("wi-fi", DeviceStatusReporter.normalizeConnectionType(true, true, false, TelephonyManager.NETWORK_TYPE_UNKNOWN));
    }

    @Test
    public void normalizeConnectionType_cellularNr_returns5g() {
        assertEquals("5g", DeviceStatusReporter.normalizeConnectionType(true, false, true, TelephonyManager.NETWORK_TYPE_NR));
    }

    @Test
    public void normalizeConnectionType_cellularNonNr_returns4g() {
        assertEquals("4g", DeviceStatusReporter.normalizeConnectionType(true, false, true, TelephonyManager.NETWORK_TYPE_LTE));
    }

    @Test
    public void normalizeConnectionType_cellularGenerationUnknown_doesNotInvent4g() {
        assertEquals("cellular", DeviceStatusReporter.normalizeConnectionType(
            true,
            false,
            true,
            TelephonyManager.NETWORK_TYPE_UNKNOWN
        ));
    }

    @Test
    public void normalizeConnectionType_disconnected_returnsNone() {
        assertEquals("NONE", DeviceStatusReporter.normalizeConnectionType(false, true, true, TelephonyManager.NETWORK_TYPE_NR));
    }
}
