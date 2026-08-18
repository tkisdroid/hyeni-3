package com.hyeni.calendar;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 기기 동작 화면 열기(2026-08-18 TK 지시).
 *
 * 앱이 소리·진동·무음을 대신 바꾸거나 전화·문자를 대신 보내지 않는다.
 * 그러면 아이가 무엇이 바뀌었는지 모르고, 무음 전환은 부모의 SOS·소리 울리기까지 조용하게 만든다.
 * 그래서 여기서는 **알맞은 화면만 연다**. 마지막 한 번은 언제나 사람이 누른다.
 *
 * target 은 화이트리스트이며 그 밖의 값은 열지 않는다(웹에서 임의 intent 를 못 만들게).
 * 문자·전화도 발신 자체는 하지 않고 앱만 띄운다(ACTION_DIAL / ACTION_SENDTO).
 */
@CapacitorPlugin(name = "DeviceAction")
public class DeviceActionPlugin extends Plugin {

    /** tel:/smsto: 에 안전한 문자만 남긴다. */
    private static String sanitizeNumber(String raw) {
        if (raw == null) return "";
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < raw.length(); i += 1) {
            char c = raw.charAt(i);
            if (Character.isDigit(c) || c == '+') out.append(c);
        }
        return out.toString();
    }

    private static Intent settingsIntent(String action) {
        Intent intent = new Intent(action);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    private Intent appNotificationSettingsIntent(Context context) {
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    private Intent appDetailsIntent(Context context) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + context.getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    @PluginMethod()
    public void open(PluginCall call) {
        Context context = getContext();
        String target = call.getString("target", "");
        String number = sanitizeNumber(call.getString("phone", ""));
        String body = call.getString("body", "");

        Intent intent;
        Intent fallback = appDetailsIntent(context);
        switch (target == null ? "" : target) {
            case "sound":
                intent = settingsIntent(Settings.ACTION_SOUND_SETTINGS);
                break;
            case "wifi":
                intent = settingsIntent(Settings.ACTION_WIFI_SETTINGS);
                break;
            case "battery":
                intent = settingsIntent(Settings.ACTION_BATTERY_SAVER_SETTINGS);
                break;
            case "notifications":
                intent = appNotificationSettingsIntent(context);
                break;
            case "location":
                intent = settingsIntent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
                break;
            case "dial":
                // 번호가 있으면 채워서 열되 발신은 사람이 누른다(ACTION_CALL 을 쓰지 않는다).
                intent = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + number));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                fallback = new Intent(Intent.ACTION_DIAL);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                break;
            case "sms":
                // 문자도 앱만 띄운다. 전송 버튼은 사람이 누른다.
                intent = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + number));
                if (body != null && !body.isEmpty()) intent.putExtra("sms_body", body);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                fallback = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:"));
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                break;
            default:
                call.resolve(new JSObject().put("opened", false).put("reason", "unsupported_target"));
                return;
        }

        try {
            context.startActivity(intent);
            call.resolve(new JSObject().put("opened", true).put("target", target));
            return;
        } catch (ActivityNotFoundException | SecurityException primaryFailed) {
            try {
                context.startActivity(fallback);
                call.resolve(new JSObject().put("opened", true).put("target", target).put("fallback", true));
                return;
            } catch (ActivityNotFoundException | SecurityException fallbackFailed) {
                call.resolve(new JSObject().put("opened", false).put("reason", "no_activity"));
            }
        }
    }
}
