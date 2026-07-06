package com.hyeni.calendar;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * 자녀 SOS 자동 발신 전용 플러그인.
 *
 * placeCall: CALL_PHONE 권한 보유 시 즉시 발신(ACTION_CALL), 미보유 시 통화 직전
 * 맥락에서 권한을 요청하고 거부하면 다이얼러(ACTION_DIAL)로 폴백한다 — 긴급 신호가
 * 권한 한 단계로 완전히 막히지 않게 한다.
 *
 * CALL_PHONE 은 Google Play 민감 권한이라 출시 시 Play Console 권한 선언이 필요하다
 * (아동 안전 SOS 자동 발신이 핵심 기능이라는 정당화). 권한은 "통화가 실제로
 * 필요한 순간"에만 요청해 정책상 정당성을 확보한다.
 */
@CapacitorPlugin(
    name = "PhoneCall",
    permissions = {
        @Permission(strings = { Manifest.permission.CALL_PHONE }, alias = "phone")
    }
)
public class PhoneCallPlugin extends Plugin {

    @PluginMethod
    public void placeCall(PluginCall call) {
        String number = sanitize(call.getString("number"));
        if (number.isEmpty()) {
            call.reject("number is required");
            return;
        }
        if (isCallGranted()) {
            startCall(call, number);
            return;
        }
        if (getActivity() == null) {
            // Activity 가 없으면 권한 요청이 불가하므로 다이얼러로 폴백한다.
            startDial(call, number);
            return;
        }
        // 권한 미보유: 통화 직전 맥락에서 요청한다. 결과는 콜백에서 처리.
        bridge.saveCall(call);
        requestPermissionForAlias("phone", call, "onCallPermissionResult");
    }

    @PermissionCallback
    private void onCallPermissionResult(PluginCall call) {
        if (call == null) return;
        String number = sanitize(call.getString("number"));
        if (number.isEmpty()) {
            call.reject("number is required");
            return;
        }
        if (isCallGranted()) {
            startCall(call, number);
        } else {
            // 권한 거부 → 다이얼러로 폴백(아이가 통화 버튼 한 번만 누르면 됨).
            startDial(call, number);
        }
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", isCallGranted());
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (isCallGranted() || getActivity() == null) {
            JSObject result = new JSObject();
            result.put("granted", isCallGranted());
            call.resolve(result);
            return;
        }
        bridge.saveCall(call);
        requestPermissionForAlias("phone", call, "onRequestPermissionResult");
    }

    @PermissionCallback
    private void onRequestPermissionResult(PluginCall call) {
        if (call == null) return;
        JSObject result = new JSObject();
        result.put("granted", isCallGranted());
        call.resolve(result);
    }

    private void startCall(PluginCall call, String number) {
        try {
            Intent intent = new Intent(Intent.ACTION_CALL, Uri.parse("tel:" + number));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject result = new JSObject();
            result.put("called", true);
            result.put("dialed", false);
            call.resolve(result);
        } catch (Exception e) {
            // ACTION_CALL 실패(기기 정책 등) 시 다이얼러로 폴백.
            startDial(call, number);
        }
    }

    private void startDial(PluginCall call, String number) {
        try {
            Intent intent = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + number));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject result = new JSObject();
            result.put("called", false);
            result.put("dialed", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Cannot place or dial call: " + e.getMessage());
        }
    }

    private boolean isCallGranted() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CALL_PHONE)
            == PackageManager.PERMISSION_GRANTED;
    }

    /** tel: URI 에 안전한 문자(숫자·+)만 남긴다. */
    private String sanitize(String raw) {
        if (raw == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (Character.isDigit(c) || c == '+') {
                sb.append(c);
            }
        }
        return sb.toString();
    }
}
