package com.hyeni.calendar;

import android.annotation.SuppressLint;
import android.app.ActivityOptions;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Android 15+에서도 시스템이 긴급 전체화면 Activity를 시작할 수 있게 만든 PendingIntent. */
final class UrgentActivityPendingIntent {

    private UrgentActivityPendingIntent() {}

    static PendingIntent getActivity(
            Context context,
            int requestCode,
            Intent intent,
            int flags
    ) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return PendingIntent.getActivity(context, requestCode, intent, flags);
        }

        ActivityOptions options = ActivityOptions.makeBasic()
            .setPendingIntentCreatorBackgroundActivityStartMode(
                creatorBackgroundStartMode(Build.VERSION.SDK_INT)
            );
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            flags,
            options.toBundle()
        );
    }

    @SuppressLint("InlinedApi")
    @SuppressWarnings("deprecation")
    static int creatorBackgroundStartMode(int sdkInt) {
        if (sdkInt >= 36) {
            return ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_ALWAYS;
        }
        if (sdkInt >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED;
        }
        return ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_SYSTEM_DEFINED;
    }
}
