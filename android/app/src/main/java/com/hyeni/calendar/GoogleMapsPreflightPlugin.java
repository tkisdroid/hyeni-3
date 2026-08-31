package com.hyeni.calendar;

import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;

@CapacitorPlugin(name = "GoogleMapsPreflight")
public class GoogleMapsPreflightPlugin extends Plugin {
    @PluginMethod
    public void preflight(PluginCall call) {
        JSObject result = new JSObject();
        result.put("configured", isConfigured());
        result.put("playServicesStatus", playServicesStatus());
        call.resolve(result);
    }

    private boolean isConfigured() {
        try {
            ApplicationInfo info = getContext().getPackageManager().getApplicationInfo(
                getContext().getPackageName(), PackageManager.GET_META_DATA
            );
            Bundle metadata = info.metaData;
            String value = metadata == null ? "" : metadata.getString("com.google.android.geo.API_KEY", "").trim();
            return !value.isEmpty() && !value.equals("${MAPS_API_KEY}");
        } catch (PackageManager.NameNotFoundException ignored) {
            return false;
        }
    }

    static String classifyPlayServicesStatus(int status) {
        if (status == ConnectionResult.SUCCESS) return "available";
        if (status == ConnectionResult.SERVICE_MISSING) return "missing";
        if (status == ConnectionResult.SERVICE_VERSION_UPDATE_REQUIRED) return "update_required";
        return "unsupported";
    }

    private String playServicesStatus() {
        int status = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext());
        return classifyPlayServicesStatus(status);
    }
}
