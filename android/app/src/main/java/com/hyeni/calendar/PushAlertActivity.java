package com.hyeni.calendar;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.util.Locale;

public class PushAlertActivity extends AppCompatActivity {

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable autoClose = this::finish;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        wakeOverLockScreen();
        setContentView(R.layout.activity_push_alert);

        String title = getIntent().getStringExtra("title");
        String body = getIntent().getStringExtra("body");
        String channel = getIntent().getStringExtra("channel");

        TextView titleView = findViewById(R.id.alertTitle);
        TextView bodyView = findViewById(R.id.alertBody);

        titleView.setText(title != null && !title.isEmpty() ? title : getString(R.string.push_alert_default_title));
        bodyView.setText(body != null ? body : "");

        applyChannelTone(channel);

        findViewById(R.id.openAppButton).setOnClickListener(v -> openMainApp());
        findViewById(R.id.closeButton).setOnClickListener(v -> finish());
        findViewById(R.id.alertRoot).setOnClickListener(v -> openMainApp());

        handler.postDelayed(autoClose, 15000);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(autoClose);
        super.onDestroy();
    }

    /**
     * channel extra 에 따라 아이콘 헤더(이모지 + 원형 배지 배경)를 분기한다.
     * 시각 계층만 바꾸며 로직/핸들러는 건드리지 않는다.
     * channel 이 null 이거나 알 수 없는 값이면 일반 톤으로 폴백한다.
     */
    private void applyChannelTone(String channel) {
        TextView icon = findViewById(R.id.alertIcon);
        View badge = findViewById(R.id.alertIconBadge);
        if (icon == null || badge == null) return;

        String ch = (channel != null) ? channel.trim().toLowerCase(Locale.ROOT) : "";
        switch (ch) {
            case "emergency":
                icon.setText("🚨");
                badge.setBackgroundResource(R.drawable.alert_icon_badge_emergency);
                break;
            case "kkuk":
                icon.setText("💗");
                badge.setBackgroundResource(R.drawable.alert_icon_badge_kkuk);
                break;
            default:
                icon.setText("🔔");
                badge.setBackgroundResource(R.drawable.alert_icon_badge_normal);
                break;
        }
    }

    private void wakeOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            );
        }

        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && km != null) {
            km.requestDismissKeyguard(this, null);
        }
    }

    private void openMainApp() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra("fromPush", true);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
        finish();
    }
}