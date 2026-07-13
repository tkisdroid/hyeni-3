package com.hyeni.calendar;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

/** 아이가 원격청취 요청을 확인하고 매 세션 직접 수락하거나 거절하는 화면. */
public class RemoteListenActivity extends AppCompatActivity {

    private static final String TAG = "RemoteListenActivity";
    private static final String PREFS_NAME = "hyeni_location_prefs";
    private static final int MICROPHONE_PERMISSION_CODE = 2101;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Intent pendingIntent;
    private TextView statusView;
    private Button acceptButton;
    private Button declineButton;
    private String consentToken = "";
    private boolean decisionMade = false;
    private RemoteListenConsentClient.Operation serverConsentCall;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (!decisionMade && pendingIntent != null) {
                    declineRequest("back_pressed");
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
            }
        });
        renderConsent();
        handleRemoteListenIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        cancelServerConsentCall();
        if (!decisionMade && pendingIntent != null) {
            RemoteListenRequestStore.markDeclined(
                this,
                pendingIntent.getStringExtra("requestId"),
                "superseded"
            );
        }
        setIntent(intent);
        decisionMade = false;
        consentToken = "";
        handleRemoteListenIntent(intent);
    }

    @Override
    protected void onDestroy() {
        cancelServerConsentCall();
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private void renderConsent() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        int padding = dp(24);
        root.setPadding(padding, padding, padding, padding);
        root.setBackgroundColor(ContextCompat.getColor(this, R.color.alert_accent_emergency_soft));

        TextView title = new TextView(this);
        title.setText("주변 소리 공유 요청");
        title.setTextColor(ContextCompat.getColor(this, R.color.alert_title));
        title.setTextSize(22);
        title.setGravity(Gravity.CENTER);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);

        TextView description = new TextView(this);
        description.setText("부모님이 1분 동안 네 주변 소리를 듣고 싶어 해.\n허용해야만 마이크가 시작돼.");
        description.setTextColor(ContextCompat.getColor(this, R.color.alert_body));
        description.setTextSize(16);
        description.setGravity(Gravity.CENTER);
        description.setLineSpacing(0f, 1.25f);
        description.setPadding(0, dp(14), 0, dp(8));

        statusView = new TextView(this);
        statusView.setText("요청을 확인하고 있어.");
        statusView.setTextColor(ContextCompat.getColor(this, R.color.alert_body));
        statusView.setTextSize(14);
        statusView.setGravity(Gravity.CENTER);
        statusView.setPadding(0, dp(8), 0, dp(20));

        acceptButton = new Button(this);
        acceptButton.setText("공유할게");
        acceptButton.setAllCaps(false);
        acceptButton.setTextSize(16);
        acceptButton.setEnabled(false);
        acceptButton.setOnClickListener(view -> acceptRequest());
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            dp(54)
        );
        buttonParams.setMargins(0, dp(6), 0, dp(8));
        acceptButton.setLayoutParams(buttonParams);

        declineButton = new Button(this);
        declineButton.setText("거절할게");
        declineButton.setAllCaps(false);
        declineButton.setTextSize(16);
        declineButton.setEnabled(false);
        declineButton.setOnClickListener(view -> declineRequest("child_declined"));
        LinearLayout.LayoutParams declineParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            dp(54)
        );
        declineParams.setMargins(0, 0, 0, 0);
        declineButton.setLayoutParams(declineParams);

        root.addView(title);
        root.addView(description);
        root.addView(statusView);
        root.addView(acceptButton);
        root.addView(declineButton);
        setContentView(root);
    }

    private void handleRemoteListenIntent(Intent intent) {
        handler.removeCallbacksAndMessages(null);
        setDecisionButtonsEnabled(false);
        if (intent == null) {
            updateStatus("확인할 요청이 없어.");
            finishSoon(1500);
            return;
        }

        pendingIntent = new Intent(intent);
        cancelLauncherNotification(pendingIntent);
        String requestId = pendingIntent.getStringExtra("requestId");
        SessionTokenStore.ContextSnapshot current = currentContext();
        String sessionNonce = currentSessionNonce();
        if (!"child".equalsIgnoreCase(current.role)) {
            RemoteListenRequestStore.markDeclined(this, requestId, "not_child_role");
            updateStatus("아이 모드에서만 확인할 수 있어.");
            finishSoon(1700);
            return;
        }

        RemoteListenRequestStore.PendingStatus status = RemoteListenRequestStore.inspectPending(
            this,
            requestId,
            current.familyId,
            current.userId,
            sessionNonce,
            System.currentTimeMillis()
        );
        if (status == RemoteListenRequestStore.PendingStatus.READY) {
            updateStatus("60초 안에 직접 선택해 줘.");
            setDecisionButtonsEnabled(true);
            scheduleExpiry(requestId);
            return;
        }
        if (status == RemoteListenRequestStore.PendingStatus.EXPIRED) {
            RemoteListenRequestStore.markExpired(this, requestId);
            updateStatus("시간이 지나 요청이 끝났어.");
        } else if (status == RemoteListenRequestStore.PendingStatus.ALREADY_HANDLED) {
            updateStatus("이미 처리한 요청이야.");
        } else if (status == RemoteListenRequestStore.PendingStatus.CONTEXT_MISMATCH) {
            RemoteListenRequestStore.markDeclined(this, requestId, "session_mismatch");
            updateStatus("로그인 정보가 달라 요청을 열지 않았어.");
        } else {
            updateStatus("안전하게 확인할 수 없는 요청이야.");
        }
        finishSoon(1800);
    }

    private void acceptRequest() {
        if (decisionMade || pendingIntent == null) return;
        String requestId = pendingIntent.getStringExtra("requestId");
        if (AmbientListenService.hasActiveSession()) {
            decisionMade = true;
            setDecisionButtonsEnabled(false);
            RemoteListenRequestStore.markDeclined(this, requestId, "capture_already_active");
            updateStatus("이미 다른 주변 소리를 공유하고 있어.");
            finishSoon(1600);
            return;
        }
        decisionMade = true;
        handler.removeCallbacksAndMessages(null);
        setDecisionButtonsEnabled(false);
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            updateStatus("공유하려면 마이크 권한을 허용해 줘.");
            ActivityCompat.requestPermissions(
                this,
                new String[]{ Manifest.permission.RECORD_AUDIO },
                MICROPHONE_PERMISSION_CODE
            );
            return;
        }
        startAcceptedCapture();
    }

    private void declineRequest(String reason) {
        if (decisionMade || pendingIntent == null) return;
        decisionMade = true;
        handler.removeCallbacksAndMessages(null);
        setDecisionButtonsEnabled(false);
        String requestId = pendingIntent.getStringExtra("requestId");
        RemoteListenRequestStore.markDeclined(this, requestId, reason);
        cancelLauncherNotification(pendingIntent);
        updateStatus("주변 소리를 공유하지 않았어.");
        finishSoon(1100);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != MICROPHONE_PERMISSION_CODE) return;
        boolean granted = grantResults.length > 0
            && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            startAcceptedCapture();
            return;
        }

        String requestId = pendingIntent != null ? pendingIntent.getStringExtra("requestId") : "";
        RemoteListenRequestStore.markDeclined(this, requestId, "permission_denied");
        updateStatus("마이크 권한이 없어서 공유하지 않았어.");
        finishSoon(1700);
    }

    private void startAcceptedCapture() {
        if (pendingIntent == null) {
            updateStatus("요청을 다시 확인해 줘.");
            finishSoon(1400);
            return;
        }
        if (serverConsentCall != null) return;
        SessionTokenStore.ContextSnapshot current = currentContext();
        String sessionNonce = currentSessionNonce();
        String targetUserId = pendingIntent.getStringExtra("targetUserId");
        if (!RemoteListenRequestPolicy.matchesContext(
                pendingIntent.getStringExtra("familyId"),
                targetUserId,
                pendingIntent.getStringExtra(RemoteListenNotification.EXTRA_SESSION_NONCE),
                current.familyId,
                current.userId,
                sessionNonce)) {
            RemoteListenRequestStore.markDeclined(
                this,
                pendingIntent.getStringExtra("requestId"),
                "session_changed_before_start"
            );
            updateStatus("로그인 정보가 바뀌어 공유하지 않았어.");
            finishSoon(1600);
            return;
        }

        String requestId = pendingIntent.getStringExtra("requestId");
        if (consentToken.isEmpty()) {
            consentToken = valueOrEmpty(RemoteListenRequestStore.accept(
                this,
                requestId,
                current.familyId,
                current.userId,
                sessionNonce,
                System.currentTimeMillis()
            ));
        }
        if (consentToken.isEmpty()) {
            RemoteListenRequestStore.markExpired(this, requestId);
            updateStatus("시간이 지나 요청이 끝났어.");
            setDecisionButtonsEnabled(false);
            finishSoon(1600);
            return;
        }
        updateStatus("동의를 안전하게 확인하고 있어.");
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        serverConsentCall = RemoteListenConsentClient.confirm(
            prefs,
            requestId,
            result -> runOnUiThread(() -> handleServerConsentResult(
                requestId,
                targetUserId,
                sessionNonce,
                result
            ))
        );
    }

    private void handleServerConsentResult(
            String requestId,
            String targetUserId,
            String acceptedSessionNonce,
            RemoteListenConsentClient.Result result
    ) {
        serverConsentCall = null;
        if (isFinishing() || isDestroyed() || pendingIntent == null
                || !valueOrEmpty(pendingIntent.getStringExtra("requestId")).equals(requestId)) {
            return;
        }
        if (!result.isSuccess()) {
            RemoteListenRequestStore.markFinished(this, requestId, "server_consent_failed");
            updateStatus("동의를 확인하지 못해 공유하지 않았어. 다시 요청해 줘.");
            finishSoon(1800);
            return;
        }

        SessionTokenStore.ContextSnapshot current = currentContext();
        String currentNonce = currentSessionNonce();
        if (!RemoteListenRequestPolicy.matchesContext(
                pendingIntent.getStringExtra("familyId"),
                targetUserId,
                acceptedSessionNonce,
                current.familyId,
                current.userId,
                currentNonce)) {
            RemoteListenRequestStore.markFinished(this, requestId, "session_changed_after_consent");
            updateStatus("로그인 정보가 바뀌어 공유하지 않았어.");
            finishSoon(1600);
            return;
        }
        long nowMs = System.currentTimeMillis();
        if (!RemoteListenRequestStore.confirmServerConsent(
                this,
                requestId,
                consentToken,
                result.getCaptureExpiresAtMs(),
                nowMs)) {
            RemoteListenRequestStore.markFinished(this, requestId, "server_consent_expired");
            updateStatus("동의 시간이 지나 공유하지 않았어.");
            finishSoon(1600);
            return;
        }

        Intent serviceIntent = new Intent(this, AmbientListenService.class);
        serviceIntent.setAction(AmbientListenService.ACTION_START);
        serviceIntent.putExtra(AmbientListenService.EXTRA_USER_ID, current.userId);
        serviceIntent.putExtra(AmbientListenService.EXTRA_TARGET_USER_ID, targetUserId);
        serviceIntent.putExtra(AmbientListenService.EXTRA_FAMILY_ID, current.familyId);
        serviceIntent.putExtra(AmbientListenService.EXTRA_SUPABASE_URL, current.supabaseUrl);
        serviceIntent.putExtra(AmbientListenService.EXTRA_SUPABASE_KEY, current.supabaseKey);
        serviceIntent.putExtra(AmbientListenService.EXTRA_ACCESS_TOKEN, current.accessToken);
        serviceIntent.putExtra(
            AmbientListenService.EXTRA_DURATION_SEC,
            readDurationSec(pendingIntent)
        );
        serviceIntent.putExtra(
            AmbientListenService.EXTRA_INITIATOR_USER_ID,
            pendingIntent.getStringExtra("senderUserId")
        );
        serviceIntent.putExtra(
            AmbientListenService.EXTRA_REQUEST_ID,
            pendingIntent.getStringExtra("requestId")
        );
        serviceIntent.putExtra(AmbientListenService.EXTRA_CONSENT_TOKEN, consentToken);
        serviceIntent.putExtra(AmbientListenService.EXTRA_SESSION_NONCE, currentNonce);
        serviceIntent.putExtra(
            AmbientListenService.EXTRA_CAPTURE_EXPIRES_AT_MS,
            result.getCaptureExpiresAtMs()
        );

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
            updateStatus("주변 소리를 1분 동안 공유하기 시작했어.");
            cancelLauncherNotification(pendingIntent);
            finishSoon(1500);
        } catch (RuntimeException error) {
            Log.w(TAG, "Accepted remote listen service start failed", error);
            RemoteListenRequestStore.markDeclined(
                this,
                pendingIntent.getStringExtra("requestId"),
                "service_start_failed"
            );
            updateStatus("지금은 공유를 시작할 수 없어.");
            finishSoon(1700);
        }
    }

    private void cancelServerConsentCall() {
        RemoteListenConsentClient.Operation call = serverConsentCall;
        serverConsentCall = null;
        if (call != null) call.cancel();
    }

    private void scheduleExpiry(String requestId) {
        long expiresAtMs = RemoteListenRequestStore.effectiveExpiresAt(this, requestId);
        long delayMs = expiresAtMs - System.currentTimeMillis();
        if (delayMs <= 0L) {
            RemoteListenRequestStore.markExpired(this, requestId);
            updateStatus("시간이 지나 요청이 끝났어.");
            setDecisionButtonsEnabled(false);
            finishSoon(1200);
            return;
        }
        handler.postDelayed(() -> {
            if (decisionMade) return;
            decisionMade = true;
            RemoteListenRequestStore.markExpired(this, requestId);
            setDecisionButtonsEnabled(false);
            updateStatus("시간이 지나 요청이 끝났어.");
            finishSoon(1200);
        }, delayMs);
    }

    private SessionTokenStore.ContextSnapshot currentContext() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return SessionTokenStore.readContext(prefs);
    }

    private String currentSessionNonce() {
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString("sessionNonce", "");
    }

    private int readDurationSec(Intent intent) {
        int durationSec = RemoteListenRequestPolicy.DEFAULT_DURATION_SEC;
        if (intent != null) {
            durationSec = intent.getIntExtra(
                "durationSec",
                RemoteListenRequestPolicy.DEFAULT_DURATION_SEC
            );
        }
        return RemoteListenRequestPolicy.normalizeDurationSec(durationSec);
    }

    private void cancelLauncherNotification(Intent sourceIntent) {
        if (sourceIntent == null) return;
        RemoteListenNotification.cancel(
            this,
            sourceIntent.getIntExtra(RemoteListenNotification.EXTRA_LAUNCHER_NOTIFICATION_ID, 0)
        );
    }

    private void setDecisionButtonsEnabled(boolean enabled) {
        if (acceptButton != null) {
            acceptButton.setEnabled(enabled);
            acceptButton.setVisibility(View.VISIBLE);
        }
        if (declineButton != null) {
            declineButton.setEnabled(enabled);
            declineButton.setVisibility(View.VISIBLE);
        }
    }

    private void updateStatus(String message) {
        if (statusView != null) statusView.setText(message);
    }

    private void finishSoon(long delayMs) {
        handler.postDelayed(this::finish, delayMs);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private String valueOrEmpty(String value) {
        return value == null ? "" : value;
    }
}
