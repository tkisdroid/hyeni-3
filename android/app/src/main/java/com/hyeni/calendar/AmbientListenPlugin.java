package com.hyeni.calendar;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AmbientListen")
public class AmbientListenPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        // WebView/JS가 마이크 권한이나 서비스를 직접 시작하지 못하게 한다.
        // 유일한 시작 경로는 서버 승인 증표를 확인한 RemoteListenActivity다.
        // Activity는 아이 탭을 요구하지 않지만 실행 화면과 알림을 숨기지 않는다.
        // reject code의 child_consent 문자열은 구버전 JS 호환을 위해 유지한다.
        call.reject("remote_listen_requires_child_consent_notification");
    }

    @PluginMethod
    public void stop(PluginCall call) {
        String requestId = clean(call.getString("requestId", ""));
        String targetUserId = clean(call.getString("targetUserId", ""));
        SharedPreferences prefs = getContext().getSharedPreferences(
            "hyeni_location_prefs",
            Context.MODE_PRIVATE
        );
        String sessionNonce = clean(prefs.getString("sessionNonce", ""));
        if (!AmbientListenService.matchesActiveSession(
                requestId,
                targetUserId,
                sessionNonce)) {
            call.reject("remote_listen_stop_session_mismatch");
            return;
        }
        Intent intent = new Intent(getContext(), AmbientListenService.class);
        intent.setAction(AmbientListenService.ACTION_STOP);
        intent.putExtra(AmbientListenService.EXTRA_REQUEST_ID, requestId);
        intent.putExtra(AmbientListenService.EXTRA_TARGET_USER_ID, targetUserId);
        intent.putExtra(AmbientListenService.EXTRA_SESSION_NONCE, sessionNonce);
        ServiceStopDispatch.Outcome outcome = ServiceStopDispatch.deliver(
            () -> getContext().startService(intent),
            () -> getContext().stopService(intent)
        );
        call.resolve(new JSObject().put("status", outcome.status()));
    }

    private String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
