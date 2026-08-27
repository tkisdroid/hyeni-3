package com.hyeni.calendar;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class RemoteListenActiveSessionTest {

    @Test
    public void exactStopClaimsRunningCaptureWithoutLaunchingService() {
        RemoteListenActiveSession<Object> session = new RemoteListenActiveSession<>();
        Object runningCapture = new Object();

        assertTrue(session.reserve(
            runningCapture,
            "request-1",
            "child-1",
            "session-1"
        ));

        RemoteListenActiveSession.StopRequest<Object> stop = session.requestStopIfMatches(
            "request-1",
            "child-1",
            "session-1"
        );

        assertSame(runningCapture, stop.owner());
        assertTrue(session.isCurrent(stop));
    }

    @Test
    public void mismatchedStopCannotClaimRunningCapture() {
        RemoteListenActiveSession<Object> session = new RemoteListenActiveSession<>();
        assertTrue(session.reserve(new Object(), "request-1", "child-1", "session-1"));

        assertNull(session.requestStopIfMatches("request-2", "child-1", "session-1"));
        assertNull(session.requestStopIfMatches("request-1", "child-2", "session-1"));
        assertNull(session.requestStopIfMatches("request-1", "child-1", "session-2"));
        assertTrue(session.hasActive());
    }

    @Test
    public void duplicateStopDispatchesOnlyOnce() {
        RemoteListenActiveSession<Object> session = new RemoteListenActiveSession<>();
        assertTrue(session.reserve(new Object(), "request-1", "child-1", "session-1"));

        RemoteListenActiveSession.StopRequest<Object> first = session.requestStopIfMatches(
            "request-1",
            "child-1",
            "session-1"
        );
        RemoteListenActiveSession.StopRequest<Object> duplicate = session.requestStopIfMatches(
            "request-1",
            "child-1",
            "session-1"
        );

        assertTrue(first.shouldDispatch());
        assertFalse(duplicate.shouldDispatch());
    }

    @Test
    public void retiringSessionStopsOnlyItsOwnCapture() {
        RemoteListenActiveSession<Object> session = new RemoteListenActiveSession<>();
        assertTrue(session.reserve(new Object(), "request-1", "child-1", "session-1"));

        assertNull(session.requestStopForSession("session-2"));
        RemoteListenActiveSession.StopRequest<Object> stop = session.requestStopForSession("session-1");

        assertTrue(stop.shouldDispatch());
        assertTrue(session.isCurrent(stop));
    }
}
