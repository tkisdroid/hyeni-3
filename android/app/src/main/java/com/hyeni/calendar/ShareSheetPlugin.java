package com.hyeni.calendar;

import android.app.Activity;
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 카카오톡·라인·Gmail 같은 설치된 앱으로 초대 문구를 넘기는 시스템 공유 시트.
 * 사용자 탭에서만 호출한다.
 */
@CapacitorPlugin(name = "ShareSheet")
public class ShareSheetPlugin extends Plugin {

    @PluginMethod
    public void share(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("activity_unavailable");
            return;
        }
        String title = safe(call.getString("title"));
        String text = safe(call.getString("text"));
        String url = safe(call.getString("url"));
        String body = text;
        if (!url.isEmpty() && !body.contains(url)) {
            body = body.isEmpty() ? url : body + "\n" + url;
        }
        if (body.isEmpty()) {
            call.reject("empty_share");
            return;
        }

        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        if (!title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
        send.putExtra(Intent.EXTRA_TEXT, body);

        Intent chooser = Intent.createChooser(send, title.isEmpty() ? null : title);
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_DOCUMENT);
        try {
            activity.startActivity(chooser);
        } catch (Exception error) {
            call.reject("share_failed");
            return;
        }
        JSObject result = new JSObject();
        result.put("shared", true);
        call.resolve(result);
    }

    private static String safe(String value) {
        return value == null ? "" : value.trim();
    }
}
