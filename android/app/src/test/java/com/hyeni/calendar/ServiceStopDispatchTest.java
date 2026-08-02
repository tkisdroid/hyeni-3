package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ServiceStopDispatchTest {

    @Test
    public void deliversStopActionWhenStartServiceIsAllowed() {
        boolean[] stopped = { false };
        ServiceStopDispatch.Outcome outcome = ServiceStopDispatch.deliver(
            () -> {},
            () -> stopped[0] = true
        );
        assertEquals(ServiceStopDispatch.Outcome.DELIVERED, outcome);
        assertEquals("stopped", outcome.status());
        assertFalse("전달에 성공하면 강제 중지로 내려가지 않는다", stopped[0]);
    }

    /** 백그라운드 제한(BackgroundServiceStartNotAllowedException)은 IllegalStateException 계열이다. */
    @Test
    public void fallsBackToStopServiceWhenBackgroundStartIsBlocked() {
        boolean[] stopped = { false };
        ServiceStopDispatch.Outcome outcome = ServiceStopDispatch.deliver(
            () -> {
                throw new IllegalStateException("Not allowed to start service: app is in background");
            },
            () -> stopped[0] = true
        );
        assertEquals(ServiceStopDispatch.Outcome.FORCE_STOPPED, outcome);
        assertEquals("force_stopped", outcome.status());
        assertTrue("전달이 막히면 서비스를 직접 중지한다", stopped[0]);
    }

    @Test
    public void reportsFailureInsteadOfCrashingWhenBothPathsThrow() {
        ServiceStopDispatch.Outcome outcome = ServiceStopDispatch.deliver(
            () -> {
                throw new IllegalStateException("background start blocked");
            },
            () -> {
                throw new SecurityException("stop denied");
            }
        );
        assertEquals(ServiceStopDispatch.Outcome.FAILED, outcome);
        assertEquals("stop_failed", outcome.status());
    }
}
