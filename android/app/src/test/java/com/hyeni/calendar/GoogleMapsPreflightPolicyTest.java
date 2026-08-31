package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import com.google.android.gms.common.ConnectionResult;
import org.junit.Test;

public class GoogleMapsPreflightPolicyTest {
    @Test public void mapsGooglePlayServicesStatusesWithoutExposingKeys() {
        assertEquals("available", GoogleMapsPreflightPlugin.classifyPlayServicesStatus(ConnectionResult.SUCCESS));
        assertEquals("missing", GoogleMapsPreflightPlugin.classifyPlayServicesStatus(ConnectionResult.SERVICE_MISSING));
        assertEquals("update_required", GoogleMapsPreflightPlugin.classifyPlayServicesStatus(ConnectionResult.SERVICE_VERSION_UPDATE_REQUIRED));
        assertEquals("unsupported", GoogleMapsPreflightPlugin.classifyPlayServicesStatus(ConnectionResult.SERVICE_INVALID));
    }
}
