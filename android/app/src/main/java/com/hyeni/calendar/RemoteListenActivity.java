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
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

/**
 * 위급 주변소리: 부모가 아이의 위급 상황을 확인하려고 요청하면 아이 탭 없이 곧바로 연결하는 화면.
 *
 * 아이 동의 탭은 받지 않는다(보호자 판단으로 여는 위급 경로). 대신 숨기지 않는다.
 * 이 화면의 안내문과 캡처 중 포그라운드 알림으로 아이에게 계속 알리고, 서버 승인 증표·1분 상한·
 * 세션 일치 검사·감사 기록은 그대로 유지한다.
 */
public class RemoteListenActivity extends AppCompatActivity {

    private static final String TAG = "RemoteListenActivity";
    private static final String PREFS_NAME = "hyeni_location_prefs";
    private static final int MICROPHONE_PERMISSION_CODE = 2101;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Intent pendingIntent;
    private TextView statusView;
    private String consentToken = "";
    private boolean decisionMade = false;
    private RemoteListenConsentClient.Operation serverConsentCall;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 위급 청취: 전체화면 인텐트가 잠금/꺼짐 화면에서도 자동으로 뜨도록 화면을 깨우고 잠금 위에 표시한다.
        wakeOverLockScreen();
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
        title.setText("주변 소리 연결");
        title.setTextColor(ContextCompat.getColor(this, R.color.alert_title));
        title.setTextSize(22);
        title.setGravity(Gravity.CENTER);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);

        // 위급 청취(아이 동의 불요): 허용/거절 버튼 없이 안내만 표시한다.
        // 아이는 아무 행동도 하지 않아도 소리가 연결되며, "지금 듣고 있어요"만 알린다.
        TextView description = new TextView(this);
        description.setText("부모님이 위급 상황을 확인하려고\n잠시 주변 소리를 들어요.");
        description.setTextColor(ContextCompat.getColor(this, R.color.alert_body));
        description.setTextSize(16);
        description.setGravity(Gravity.CENTER);
        description.setLineSpacing(0f, 1.25f);
        description.setPadding(0, dp(14), 0, dp(8));

        statusView = new TextView(this);
        statusView.setText("연결하고 있어요.");
        statusView.setTextColor(ContextCompat.getColor(this, R.color.alert_body));
        statusView.setTextSize(14);
        statusView.setGravity(Gravity.CENTER);
        statusView.setPadding(0, dp(8), 0, dp(8));

        root.addView(title);
        root.addView(description);
        root.addView(statusView);
        setContentView(root);
    }

    private void handleRemoteListenIntent(Intent intent) {
        handler.removeCallbacksAndMessages(null);
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
            // 위급 청취: 아이 탭/선택 없이 곧바로 캡처를 시작한다(안내만 표시).
            updateStatus("부모님께 주변 소리를 연결하고 있어요.");
            acceptRequest();
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
            RemoteListenRequestStore.markDeclined(this, requestId, "capture_already_active");
            updateStatus("이미 다른 주변 소리를 공유하고 있어.");
            finishSoon(1600);
            return;
        }
        decisionMade = true;
        handler.removeCallbacksAndMessages(null);
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
            finishSoon(1600);
            return;
        }
        updateStatus("안전하게 연결하고 있어.");
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
            updateStatus("연결을 확인하지 못해 공유하지 않았어.");
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
            updateStatus("요청 시간이 지나 공유하지 않았어.");
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

    /**
     * 전체화면 인텐트가 잠금·꺼짐 화면에서도 뜨도록 화면을 깨우고 잠금 위에 표시한다.
     *
     * 기기 잠금 해제는 요청하지 않는다. 이 화면은 아이가 누를 것이 없는 안내 화면이라 잠금을 열 이유가
     * 없고, 열면 기기 잠금이 약해진다.
     */
    private void wakeOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            );
        }
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
