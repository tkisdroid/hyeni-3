package com.hyeni.calendar;

import android.Manifest;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Display;
import android.util.Log;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class RemoteListenActivity extends AppCompatActivity {

    private static final String TAG = "RemoteListenActivity";
    private static final String PREFS_NAME = "hyeni_location_prefs";
    private static final String EXTRA_LAUNCHER_NOTIFICATION_ID = "launcherNotificationId";
    private static final int MICROPHONE_PERMISSION_CODE = 2101;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Intent pendingIntent;
    private TextView statusView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        wakeOverLockScreen();
        renderStatus();
        handleRemoteListenIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleRemoteListenIntent(intent);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
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
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && km != null) {
            km.requestDismissKeyguard(this, null);
        }
    }

    private void renderStatus() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        int padding = dp(24);
        root.setPadding(padding, padding, padding, padding);
        root.setBackgroundColor(0xEEFFF4F8);

        TextView title = new TextView(this);
        title.setText("주변 소리 연결");
        title.setTextColor(0xFF3B2230);
        title.setTextSize(20);
        title.setGravity(Gravity.CENTER);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);

        statusView = new TextView(this);
        statusView.setText("아이 안전 확인을 연결하고 있어요.");
        statusView.setTextColor(0xFF6B5F73);
        statusView.setTextSize(14);
        statusView.setGravity(Gravity.CENTER);
        statusView.setPadding(0, dp(10), 0, 0);

        root.addView(title);
        root.addView(statusView);
        setContentView(root);
    }

    private void handleRemoteListenIntent(Intent intent) {
        if (intent == null) {
            finishSoon(1200);
            return;
        }

        pendingIntent = new Intent(intent);
        String requestId = pendingIntent.getStringExtra("requestId");
        RemoteListenRequestStore.markLauncherShown(this, requestId);
        cancelLauncherNotification(pendingIntent);
        handler.postDelayed(() -> cancelLauncherNotification(pendingIntent), 800);
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            updateStatus("마이크 권한을 허용하면 바로 연결됩니다.");
            ActivityCompat.requestPermissions(
                this,
                new String[]{ Manifest.permission.RECORD_AUDIO },
                MICROPHONE_PERMISSION_CODE
            );
            return;
        }

        startAmbientListenFromForeground(pendingIntent);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != MICROPHONE_PERMISSION_CODE) return;

        boolean granted = grantResults.length > 0
            && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            startAmbientListenFromForeground(pendingIntent);
            return;
        }

        updateStatus("마이크 권한이 없어 연결하지 못했어요.");
        openMainAppSoon(900);
    }

    private void startAmbientListenFromForeground(Intent sourceIntent) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String role = prefs.getString("role", "");
        if (!isBlank(role) && !"child".equalsIgnoreCase(role)) {
            Log.i(TAG, "Remote listen skipped: this device is not child mode");
            updateStatus("아이 모드 기기에서만 연결할 수 있어요.");
            finishSoon(1400);
            return;
        }

        String userId = prefs.getString("userId", "");
        String requestedFamilyId = sourceIntent != null ? sourceIntent.getStringExtra("familyId") : null;
        String prefsFamilyId = prefs.getString("familyId", "");
        String familyId = firstNonBlank(requestedFamilyId, prefsFamilyId);
        String supabaseUrl = prefs.getString("supabaseUrl", "");
        String supabaseKey = prefs.getString("supabaseKey", "");
        String accessToken = prefs.getString("accessToken", "");
        if (!isBlank(requestedFamilyId) && !isBlank(prefsFamilyId) && !requestedFamilyId.equals(prefsFamilyId)) {
            Log.i(TAG, "Remote listen foreground start skipped: family mismatch");
            updateStatus("다른 가족 요청이에요.");
            finishSoon(900);
            return;
        }

        String targetUserId = sourceIntent != null ? sourceIntent.getStringExtra("targetUserId") : null;
        if (!isBlank(targetUserId) && !targetUserId.equals(userId)) {
            Log.i(TAG, "Remote listen foreground start skipped: target user mismatch");
            updateStatus("다른 아이 기기에 보낸 요청이에요.");
            finishSoon(900);
            return;
        }

        if (isBlank(userId) || isBlank(familyId) || isBlank(supabaseUrl) || isBlank(supabaseKey)) {
            Log.w(TAG, "Remote listen foreground start skipped: push context missing");
            updateStatus("앱 연결 정보를 확인해야 해요.");
            openMainAppSoon(900);
            return;
        }

        Intent serviceIntent = new Intent(this, AmbientListenService.class);
        serviceIntent.setAction(AmbientListenService.ACTION_START);
        serviceIntent.putExtra(AmbientListenService.EXTRA_USER_ID, userId);
        serviceIntent.putExtra(AmbientListenService.EXTRA_FAMILY_ID, familyId);
        serviceIntent.putExtra(AmbientListenService.EXTRA_SUPABASE_URL, supabaseUrl);
        serviceIntent.putExtra(AmbientListenService.EXTRA_SUPABASE_KEY, supabaseKey);
        serviceIntent.putExtra(AmbientListenService.EXTRA_ACCESS_TOKEN, accessToken);
        serviceIntent.putExtra(AmbientListenService.EXTRA_DURATION_SEC, readDurationSec(sourceIntent));

        String senderUserId = sourceIntent != null ? sourceIntent.getStringExtra("senderUserId") : null;
        if (!isBlank(senderUserId)) {
            serviceIntent.putExtra(AmbientListenService.EXTRA_INITIATOR_USER_ID, senderUserId);
        }
        String requestId = sourceIntent != null ? sourceIntent.getStringExtra("requestId") : null;
        if (!isBlank(requestId)) {
            serviceIntent.putExtra(AmbientListenService.EXTRA_REQUEST_ID, requestId);
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
            Log.i(TAG, "Remote listen foreground bridge started AmbientListenService");
            updateStatus("주변 소리 연결을 시작했어요.");
            cancelLauncherNotification(sourceIntent);
            finishSoon(1800);
        } catch (Exception error) {
            Log.w(TAG, "Remote listen foreground bridge failed", error);
            updateStatus("앱을 열어 연결을 이어갈게요.");
            openMainAppSoon(900);
        }
    }

    private void openMainAppSoon(long delayMs) {
        handler.postDelayed(() -> {
            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            intent.putExtra("fromPush", true);
            intent.putExtra("remoteListen", true);
            copyIfPresent(pendingIntent, intent, "familyId");
            copyIfPresent(pendingIntent, intent, "senderUserId");
            copyIfPresent(pendingIntent, intent, "durationSec");
            copyIfPresent(pendingIntent, intent, "requestId");
            copyIfPresent(pendingIntent, intent, "targetUserId");
            startActivity(intent);
            finish();
        }, delayMs);
    }

    private void finishSoon(long delayMs) {
        handler.postDelayed(this::finish, delayMs);
    }

    private void updateStatus(String message) {
        if (statusView != null) statusView.setText(message);
    }

    private void cancelLauncherNotification(Intent sourceIntent) {
        if (sourceIntent == null) return;
        int notificationId = sourceIntent.getIntExtra(EXTRA_LAUNCHER_NOTIFICATION_ID, 0);
        if (notificationId <= 0) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.cancel(notificationId);
        }
    }

    private void copyIfPresent(Intent from, Intent to, String key) {
        if (from == null || to == null || !from.hasExtra(key)) return;
        Object value = from.getExtras() != null ? from.getExtras().get(key) : null;
        if (value instanceof Integer) {
            to.putExtra(key, (Integer) value);
        } else if (value != null) {
            to.putExtra(key, String.valueOf(value));
        }
    }

    private int readDurationSec(Intent intent) {
        if (intent == null) return 30;
        int durationSec = 30;
        Object rawDuration = intent.getExtras() != null ? intent.getExtras().get("durationSec") : null;
        if (rawDuration instanceof Number) {
            durationSec = ((Number) rawDuration).intValue();
        } else if (rawDuration != null) {
            try {
                durationSec = Integer.parseInt(String.valueOf(rawDuration));
            } catch (Exception ignored) {
                durationSec = 30;
            }
        }
        if (durationSec < 5) return 30;
        return Math.min(durationSec, 120);
    }

    private String firstNonBlank(String first, String second) {
        return !isBlank(first) ? first.trim() : (!isBlank(second) ? second.trim() : "");
    }

    private boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    /**
     * 폴더블 대응: 내부(default) 디스플레이가 꺼져 있으면(접힌 상태) 켜져 있는
     * 커버/외부 디스플레이 id 를 돌려준다. 그래야 RemoteListenActivity 가 커버
     * 화면에 실제로 떠서 마이크 FGS 의 foreground 컨텍스트를 만들 수 있다.
     * 그 외에는 DEFAULT_DISPLAY 를 반환(펼친 상태 = 기존 동작 유지).
     */
    public static int activeLaunchDisplayId(Context ctx) {
        try {
            DisplayManager dm = (DisplayManager) ctx.getSystemService(Context.DISPLAY_SERVICE);
            if (dm == null) return Display.DEFAULT_DISPLAY;
            Display def = dm.getDisplay(Display.DEFAULT_DISPLAY);
            if (def != null && def.getState() == Display.STATE_ON) {
                return Display.DEFAULT_DISPLAY;
            }
            // 내부 화면이 꺼져 있으면(접힘) 켜져 있는 다른 디스플레이(커버)를 찾는다.
            for (Display d : dm.getDisplays()) {
                if (d.getDisplayId() != Display.DEFAULT_DISPLAY && d.getState() == Display.STATE_ON) {
                    return d.getDisplayId();
                }
            }
            return Display.DEFAULT_DISPLAY;
        } catch (Exception error) {
            return Display.DEFAULT_DISPLAY;
        }
    }
}
