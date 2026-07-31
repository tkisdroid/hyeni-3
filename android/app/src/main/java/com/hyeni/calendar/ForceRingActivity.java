package com.hyeni.calendar;

import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public class ForceRingActivity extends AppCompatActivity {

    private BroadcastReceiver stopReceiver;
    private final Handler countdownHandler = new Handler(Looper.getMainLooper());
    private int secondsLeft = 15;
    private TextView countdownText;
    private String currentEventId;
    private boolean autoStopHandled = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(
                  WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }

        KeyguardManager km = getSystemService(KeyguardManager.class);
        boolean isLocked = km != null && km.isKeyguardLocked();
        boolean isSecure = km != null && km.isKeyguardSecure();
        // requestDismissKeyguard is API 26+. On API 24-25, FLAG_DISMISS_KEYGUARD
        // (already set above) handles non-secure keyguard dismissal — those
        // older devices are a negligible install base and degrade gracefully.
        if (isLocked && !isSecure && km != null
                && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            km.requestDismissKeyguard(this, null);
        }

        WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.screenBrightness = 1.0f;
        getWindow().setAttributes(lp);

        getWindow().getDecorView().setSystemUiVisibility(
                  View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);

        setContentView(R.layout.activity_force_ring);

        Intent intent = getIntent();
        String eventId = intent.getStringExtra(ForceRingService.EXTRA_EVENT_ID);
        String message = intent.getStringExtra(ForceRingService.EXTRA_MESSAGE);
        String initiator = intent.getStringExtra(ForceRingService.EXTRA_INITIATOR);
        String parentRole = intent.getStringExtra(ForceRingService.EXTRA_PARENT_ROLE);
        String childName = intent.getStringExtra(ForceRingService.EXTRA_CHILD_NAME);
        currentEventId = eventId;
        if (ForceRingRequestStore.wasStoppedRecently(this, eventId)) {
            finish();
            return;
        }

        // UDC+ flow: MyFirebaseMessagingService posted a fullScreenIntent
        // notification instead of starting the FGS directly (background FGS
        // start was disallowed). Now that we are running in foreground, kick
        // ForceRingService for sound + vibration. Pre-UDC, the service is
        // already running (FCM started it) and this is a no-op since the
        // service singleton handles repeat onStartCommand idempotently.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            Intent svc = new Intent(this, ForceRingService.class);
            svc.putExtra(ForceRingService.EXTRA_EVENT_ID, eventId);
            svc.putExtra(ForceRingService.EXTRA_MESSAGE, message);
            svc.putExtra(ForceRingService.EXTRA_INITIATOR, initiator);
            svc.putExtra(ForceRingService.EXTRA_PARENT_ROLE, parentRole);
            svc.putExtra(ForceRingService.EXTRA_CHILD_NAME, childName);
            try {
                ContextCompat.startForegroundService(this, svc);
            } catch (Exception ignored) {
                // Service start failed — UI still shows the alarm; ack works.
            }
        }

        String role = (parentRole != null && !parentRole.isEmpty()) ? parentRole : null;
        String name = (childName != null && !childName.isEmpty()) ? childName : null;
        String initiatorText;
        if (role != null && name != null) {
            initiatorText = KoreanText.withSubjectParticle(role) + " 지금 "
                    + KoreanText.withObjectParticle(name) + " 찾고 있어요";
        } else if (role != null) {
            initiatorText = KoreanText.withSubjectParticle(role) + " 지금 너를 찾고 있어요";
        } else if (initiator != null && !initiator.isEmpty()) {
            initiatorText = KoreanText.withSubjectParticle(initiator) + " 지금 너를 찾고 있어요";
        } else {
            initiatorText = "부모님이 지금 너를 찾고 있어요";
        }
        ((TextView) findViewById(R.id.initiator_text)).setText(initiatorText);
        ((TextView) findViewById(R.id.time_text)).setText(
                new SimpleDateFormat("HH:mm:ss", Locale.KOREA).format(new Date()));

        LinearLayout messageCard = findViewById(R.id.message_card);
        if (message != null && !message.trim().isEmpty()) {
            if (isLocked && isSecure) {
                messageCard.setVisibility(View.GONE);
            } else {
                ((TextView) findViewById(R.id.message_text)).setText(message);
                messageCard.setVisibility(View.VISIBLE);
            }
        } else {
            messageCard.setVisibility(View.GONE);
        }

        countdownText = findViewById(R.id.countdown_text);
        startCountdown();

        final String roleLabel = (role != null) ? role : "부모님";
        Button btnAck = findViewById(R.id.btn_ack);
        btnAck.setOnClickListener(v -> {
            Toast.makeText(this, roleLabel + "에게 알림을 보냈어요!", Toast.LENGTH_SHORT).show();
            stopService(new Intent(this, ForceRingService.class));
            sendAck(eventId);
            new Handler(Looper.getMainLooper()).postDelayed(this::finish, 1500);
        });

        stopReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent i) {
                Toast.makeText(ForceRingActivity.this,
                        KoreanText.withSubjectParticle(roleLabel)
                                + " 알람을 꺼주셨어요", Toast.LENGTH_SHORT).show();
                new Handler(Looper.getMainLooper()).postDelayed(
                        ForceRingActivity.this::finish, 1500);
            }
        };
        IntentFilter filter = new IntentFilter("com.hyeni.calendar.FORCE_RING_STOP");
        // ContextCompat backports the exported-flag requirement to all API
        // levels — required by Android 14+ (UpsideDownCake) for non-system
        // broadcasts. stopReceiver is internal to this app, so NOT_EXPORTED.
        ContextCompat.registerReceiver(this, stopReceiver, filter,
                ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    private void startCountdown() {
        countdownHandler.post(new Runnable() {
            @Override
            public void run() {
                if (secondsLeft <= 0) {
                    stopForAutoTimeout();
                    return;
                }
                countdownText.setText(getString(R.string.force_ring_countdown, secondsLeft));
                secondsLeft--;
                countdownHandler.postDelayed(this, 1000);
            }
        });
    }

    private void stopForAutoTimeout() {
        if (autoStopHandled) return;
        autoStopHandled = true;
        ForceRingRequestStore.markStopped(this, currentEventId);
        stopService(new Intent(this, ForceRingService.class));
        cancelForceRingNotification();
        postStopReasonToServer(currentEventId, "auto_timeout");
        countdownHandler.removeCallbacksAndMessages(null);
        finish();
    }

    private void cancelForceRingNotification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            nm.cancel(ForceRingService.NOTIF_ID);
        }
    }

    private void sendAck(String eventId) {
        if (eventId == null) return;
        getSharedPreferences("hyeni_force_ring_acks", MODE_PRIVATE)
                .edit()
                .putLong(eventId, System.currentTimeMillis())
                .apply();
        // Server-side ack: tells the reminder cron to stop and updates the
        // parent's UI with acknowledged_at. Without this, the parent receives
        // false "5분간 응답 없습니다" reminders even after the child dismissed.
        postAckToServer(eventId);
    }

    private static final String TAG = "ForceRingActivity";
    private static final OkHttpClient HTTP_CLIENT = new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .build();

    private void postAckToServer(String eventId) {
        // Same prefs name as MyFirebaseMessagingService.PREFS_NAME ("hyeni_location_prefs") —
        // populated by the WebView bridge at login so that the FCM service and
        // native services share the Supabase credentials.
        SharedPreferences prefs = getSharedPreferences("hyeni_location_prefs", MODE_PRIVATE);
        String supabaseUrl = prefs.getString("supabaseUrl", null);
        String supabaseKey = prefs.getString("supabaseKey", null);
        String accessToken = prefs.getString("accessToken", null);
        if (supabaseUrl == null || supabaseKey == null) {
            Log.w(TAG, "ack skipped: push context missing");
            return;
        }
        new Thread(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("p_event_id", eventId);
                String bearer = (accessToken != null && !accessToken.isEmpty()) ? accessToken : supabaseKey;
                Request req = new Request.Builder()
                        .url(supabaseUrl + "/rest/v1/rpc/force_ring_acknowledge")
                        .header("apikey", supabaseKey)
                        .header("Authorization", "Bearer " + bearer)
                        .header("Content-Type", "application/json")
                        .post(RequestBody.create(body.toString(), MediaType.get("application/json")))
                        .build();
                try (Response response = HTTP_CLIENT.newCall(req).execute()) {
                    if (!response.isSuccessful()) {
                        String errBody = response.body() != null ? response.body().string() : "";
                        Log.w(TAG, "ack RPC failed: " + response.code() + " / " + errBody);
                    } else {
                        Log.i(TAG, "force_ring ack persisted to server");
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "ack RPC error", e);
            }
        }, "force-ring-ack").start();
    }

    private void postStopReasonToServer(String eventId, String reason) {
        if (eventId == null || eventId.trim().isEmpty()) return;
        SharedPreferences prefs = getSharedPreferences("hyeni_location_prefs", MODE_PRIVATE);
        String supabaseUrl = prefs.getString("supabaseUrl", null);
        String supabaseKey = prefs.getString("supabaseKey", null);
        String accessToken = prefs.getString("accessToken", null);
        if (supabaseUrl == null || supabaseKey == null) {
            Log.w(TAG, "auto-timeout update skipped: push context missing");
            return;
        }

        new Thread(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("stopped_at", isoNow());
                body.put("stop_reason", reason);
                String bearer = (accessToken != null && !accessToken.isEmpty())
                        ? accessToken : supabaseKey;
                Request req = new Request.Builder()
                        .url(supabaseUrl + "/rest/v1/force_ring_events?id=eq."
                                + eventId + "&stopped_at=is.null")
                        .header("apikey", supabaseKey)
                        .header("Authorization", "Bearer " + bearer)
                        .header("Content-Type", "application/json")
                        .header("Prefer", "return=minimal")
                        .patch(RequestBody.create(body.toString(), MediaType.get("application/json")))
                        .build();
                try (Response response = HTTP_CLIENT.newCall(req).execute()) {
                    if (!response.isSuccessful()) {
                        String errBody = response.body() != null ? response.body().string() : "";
                        Log.w(TAG, "auto-timeout update failed: "
                                + response.code() + " / " + errBody);
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "auto-timeout update error", e);
            }
        }, "force-ring-activity-auto-timeout").start();
    }

    private String isoNow() {
        SimpleDateFormat formatter =
                new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(new Date());
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        countdownHandler.removeCallbacksAndMessages(null);
        if (stopReceiver != null) {
            try { unregisterReceiver(stopReceiver); } catch (Exception ignored) {}
        }
    }
}
