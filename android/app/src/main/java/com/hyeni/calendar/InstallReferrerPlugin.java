package com.hyeni.calendar;

import android.content.Context;
import android.content.SharedPreferences;

import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.android.installreferrer.api.ReferrerDetails;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Play 스토어 설치 추천 문자열을 1회만 읽는다.
 * 웹 초대 링크를 거치지 않고 스토어에서 설치한 경우의 귀속 보조 경로다.
 */
@CapacitorPlugin(name = "InstallReferrer")
public class InstallReferrerPlugin extends Plugin {

    private static final String PREFS = "hyeni_install_referrer";
    private static final String CONSUMED_KEY = "consumed";

    @PluginMethod
    public void readOnce(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            resolveEmpty(call);
            return;
        }
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (prefs.getBoolean(CONSUMED_KEY, false)) {
            resolveEmpty(call);
            return;
        }

        InstallReferrerClient client = InstallReferrerClient.newBuilder(context).build();
        client.startConnection(new InstallReferrerStateListener() {
            @Override
            public void onInstallReferrerSetupFinished(int responseCode) {
                String referrer = "";
                if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
                    try {
                        ReferrerDetails details = client.getInstallReferrer();
                        if (details != null && details.getInstallReferrer() != null) {
                            referrer = details.getInstallReferrer();
                        }
                    } catch (Exception ignored) {
                        referrer = "";
                    }
                }
                prefs.edit().putBoolean(CONSUMED_KEY, true).apply();
                try {
                    client.endConnection();
                } catch (Exception ignored) {
                    // 연결 종료 실패는 이미 읽은 값 반환을 막지 않는다.
                }
                JSObject result = new JSObject();
                result.put("referrer", referrer);
                call.resolve(result);
            }

            @Override
            public void onInstallReferrerServiceDisconnected() {
                resolveEmpty(call);
            }
        });
    }

    private static void resolveEmpty(PluginCall call) {
        JSObject result = new JSObject();
        result.put("referrer", "");
        call.resolve(result);
    }
}
