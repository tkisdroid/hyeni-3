package com.hyeni.calendar;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "AmbientListen",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone")
    }
)
public class AmbientListenPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            bridge.saveCall(call);
            requestPermissionForAlias("microphone", call, "onMicPermissionResult");
            return;
        }

        launch(call);
    }

    @PermissionCallback
    private void onMicPermissionResult(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED) {
            launch(call);
        } else {
            call.reject("Microphone permission denied");
        }
    }

    private void launch(PluginCall call) {
        String userId = call.getString("userId");
        String familyId = call.getString("familyId");
        String supabaseUrl = call.getString("supabaseUrl");
        String supabaseKey = call.getString("supabaseKey");
        String accessToken = call.getString("accessToken", "");
        String initiatorUserId = call.getString("initiatorUserId", "");
        String requestId = call.getString("requestId", "");
        int durationSec = call.getInt("durationSec", 30);

        if (isBlank(userId) || isBlank(familyId) || isBlank(supabaseUrl) || isBlank(supabaseKey)) {
            call.reject("userId, familyId, supabaseUrl, supabaseKey are required");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
                && !MainActivity.isAppForegroundForMicrophone()) {
            call.reject("remote_listen_requires_foreground_activity");
            return;
        }

        Intent intent = new Intent(getContext(), AmbientListenService.class);
        intent.setAction(AmbientListenService.ACTION_START);
        intent.putExtra(AmbientListenService.EXTRA_USER_ID, userId);
        intent.putExtra(AmbientListenService.EXTRA_FAMILY_ID, familyId);
        intent.putExtra(AmbientListenService.EXTRA_SUPABASE_URL, supabaseUrl);
        intent.putExtra(AmbientListenService.EXTRA_SUPABASE_KEY, supabaseKey);
        intent.putExtra(AmbientListenService.EXTRA_ACCESS_TOKEN, accessToken);
        intent.putExtra(AmbientListenService.EXTRA_INITIATOR_USER_ID, initiatorUserId);
        intent.putExtra(AmbientListenService.EXTRA_REQUEST_ID, requestId);
        intent.putExtra(AmbientListenService.EXTRA_DURATION_SEC, durationSec);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }

        call.resolve(new JSObject().put("status", "started"));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), AmbientListenService.class);
        intent.setAction(AmbientListenService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve(new JSObject().put("status", "stopped"));
    }

    private boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
