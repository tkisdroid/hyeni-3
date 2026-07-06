package com.hyeni.calendar;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "CameraPermission",
    permissions = {
        @Permission(strings = { Manifest.permission.CAMERA }, alias = "camera")
    }
)
public class CameraPermissionPlugin extends Plugin {

    @PluginMethod
    public void checkPermission(PluginCall call) {
        resolveCameraState(call, false);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (isCameraGranted()) {
            resolveCameraState(call, false);
            return;
        }

        if (getActivity() == null) {
            resolveCameraState(call, false);
            return;
        }

        bridge.saveCall(call);
        requestPermissionForAlias("camera", call, "onCameraPermissionResult");
    }

    @PermissionCallback
    private void onCameraPermissionResult(PluginCall call) {
        if (call != null) {
            resolveCameraState(call, true);
        }
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("opened", true));
        } catch (Exception e) {
            call.reject("Cannot open settings: " + e.getMessage());
        }
    }

    private void resolveCameraState(PluginCall call, boolean requested) {
        boolean granted = isCameraGranted();
        boolean shouldShowRationale = !granted
            && getActivity() != null
            && ActivityCompat.shouldShowRequestPermissionRationale(getActivity(), Manifest.permission.CAMERA);

        JSObject result = new JSObject();
        result.put("granted", granted);
        result.put("requested", requested);
        result.put("shouldShowRationale", shouldShowRationale);
        call.resolve(result);
    }

    private boolean isCameraGranted() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED;
    }
}
