package com.hyeni.calendar;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    private static final int NOTIFICATION_PERMISSION_CODE = 1001;
    private static final int CORE_PERMISSION_REQUEST_CODE = 1003;
    private static final String PREFS_NAME = "hyeni_location_prefs";
    private static final String CORE_PERMISSION_PROMPTED_KEY = "corePermissionPrompted";
    private static volatile boolean appForegroundForMicrophone = false;

    static boolean isAppForeground() {
        return appForegroundForMicrophone;
    }

    static boolean isAppForegroundForMicrophone() {
        return isAppForeground();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocationPlugin.class);
        registerPlugin(SpeechPlugin.class);
        registerPlugin(NotificationPlugin.class);
        registerPlugin(AmbientListenPlugin.class);
        registerPlugin(KakaoMapLauncherPlugin.class);
        registerPlugin(CameraPermissionPlugin.class);
        registerPlugin(ExternalBrowserPlugin.class);
        registerPlugin(GooglePlayBillingPlugin.class);
        registerPlugin(InAppReviewPlugin.class);
        registerPlugin(PhoneCallPlugin.class);
        registerPlugin(MediaSavePlugin.class);
        super.onCreate(savedInstanceState);

        // Phase 5 RL-03: WebView WebChromeClient no longer auto-grants the
        // microphone PermissionRequest. Google Play's stalkerware / spyware
        // policy requires per-session user consent for ambient mic capture;
        // an unconditional .grant() is policy-violating. We now gate on
        // OS-level RECORD_AUDIO: if the app already has the OS permission
        // (which is only true when the user tapped "Allow" on the Android
        // runtime prompt), the WebView request is forwarded; otherwise we
        // deny it and dispatch a `mic-permission-denied` DOM event so the JS
        // side can show consent UI. Geolocation prompts are still gated by the
        // Android ACCESS_FINE_LOCATION runtime permission, but the OS prompt is
        // opened only from an in-app permission surface after explanation.
        //
        // NOTE: a localStorage `hasGrantedAmbientListen` legacy flag would be
        // the cleanest "honor-legacy-consent" path, but localStorage lives on
        // the JS side and cannot be read synchronously inside
        // onPermissionRequest. We require an existing OS grant here: if the
        // user previously said "Allow" from the explicit in-app flow we forward
        // the request, otherwise we deny and let JS show guidance.
        // Subclass Capacitor's BridgeWebChromeClient (not raw WebChromeClient) so
        // file picker (onShowFileChooser), console, and other Bridge defaults are
        // preserved. We only override mic/geo to enforce OS-level permission gates.
        getBridge().getWebView().setWebChromeClient(new com.getcapacitor.BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    if (request.getOrigin() == null
                            || !WebViewOriginPolicy.isTrusted(request.getOrigin().toString())) {
                        request.deny();
                        return;
                    }
                    String[] resources = request.getResources();
                    java.util.List<String> grantList = new java.util.ArrayList<>();
                    boolean cameraDenied = false;
                    boolean micDenied = false;
                    for (String r : resources) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) {
                            if (hasCameraPermissionGranted()) grantList.add(r);
                            else cameraDenied = true;
                        } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                            if (hasRecordAudioPermissionGranted()) grantList.add(r);
                            else micDenied = true;
                        }
                    }
                    if (!grantList.isEmpty() && !cameraDenied && !micDenied) {
                        request.grant(grantList.toArray(new String[0]));
                        return;
                    }
                    request.deny();
                    if (cameraDenied) {
                        getBridge().getWebView().evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('camera-permission-denied'))",
                            null
                        );
                    }
                    if (micDenied) {
                        getBridge().getWebView().evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('mic-permission-denied'))",
                            null
                        );
                    }
                });
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!WebViewOriginPolicy.isTrusted(origin)) {
                    callback.invoke(origin, false, false);
                    return;
                }
                // Phase 5 Stream B: gate WebView geolocation on the OS-level
                // ACCESS_FINE_LOCATION runtime permission. The previous
                // unconditional callback.invoke(origin, true, true) auto-granted
                // (and remembered, retain=true) any origin loaded in the WebView,
                // bypassing the per-origin consent surface that PIPA + Play
                // Console expect for a parent-child app. Now: granted only when
                // the user has accepted ACCESS_FINE_LOCATION at the OS prompt;
                // retain=false so the WebView re-checks if the OS permission is
                // later revoked.
                boolean osGranted = androidx.core.content.ContextCompat.checkSelfPermission(
                        MainActivity.this,
                        android.Manifest.permission.ACCESS_FINE_LOCATION
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED;
                callback.invoke(origin, osGranted, false);
            }
        });

        handlePushLaunch(getIntent());
        handleRouteLaunch(getIntent());
        handleRemoteListen(getIntent());
        // Runtime permissions are requested only from explicit in-app surfaces
        // after role selection and prominent disclosure. This avoids first-run
        // microphone/camera/location prompts before the user understands why the
        // app needs each permission.
        primeFcmToken();
    }

    @Override
    public void onResume() {
        super.onResume();
        appForegroundForMicrophone = true;
    }

    @Override
    public void onPause() {
        appForegroundForMicrophone = false;
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handlePushLaunch(intent);
        handleRouteLaunch(intent);
        handleRemoteListen(intent);
    }

    private void requestNotificationPermission() {
        if (getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getBoolean(CORE_PERMISSION_PROMPTED_KEY, false)) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[]{ Manifest.permission.POST_NOTIFICATIONS },
                        NOTIFICATION_PERMISSION_CODE);
            }
        }
    }

    private void requestCorePermissionsIfNeeded(Intent intent) {
        if (intent != null && intent.getBooleanExtra("remoteListen", false)) {
            return;
        }

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        if (prefs.getBoolean(CORE_PERMISSION_PROMPTED_KEY, false)) {
            return;
        }

        List<String> missingPermissions = new ArrayList<>();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            missingPermissions.add(Manifest.permission.RECORD_AUDIO);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            missingPermissions.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            missingPermissions.add(Manifest.permission.CAMERA);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            missingPermissions.add(Manifest.permission.POST_NOTIFICATIONS);
        }

        if (missingPermissions.isEmpty()) {
            prefs.edit().putBoolean(CORE_PERMISSION_PROMPTED_KEY, true).apply();
            return;
        }

        prefs.edit().putBoolean(CORE_PERMISSION_PROMPTED_KEY, true).apply();
        ActivityCompat.requestPermissions(
            this,
            missingPermissions.toArray(new String[0]),
            CORE_PERMISSION_REQUEST_CODE
        );
    }

    private void handleRemoteListen(Intent intent) {
        if (intent == null || !intent.getBooleanExtra("remoteListen", false)) return;
        // 구버전 full-screen 인텐트는 마이크를 시작하거나 권한을 요청하지 않는다.
        // 현재 경로는 RemoteListenNotification → RemoteListenActivity의 명시적
        // 세션별 동의만 허용한다.
        intent.removeExtra("remoteListen");
        Log.w("MainActivity", "Legacy remote listen auto-start intent ignored");
    }

    // AI 선제 대화/부모 메모/스티커 알림 탭 → 관련 아이 화면 직행. WebView 부팅 타이밍이
    // 가변적이라 remote-listen 플래그 주입과 동일하게 지연 재주입한다.
    private void handleRouteLaunch(Intent intent) {
        if (intent == null) {
            return;
        }
        String route = intent.getStringExtra("route");
        String localRole = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString("role", "");
        String hashRoute = NotificationRoutePolicy.resolveHashRoute(route, localRole);
        if (hashRoute == null) {
            if (route != null && !route.trim().isEmpty()) {
                Log.w("MainActivity", "Rejected notification route for current role");
            }
            return;
        }
        Log.i("MainActivity", "Notification route launch accepted");
        injectHashRoute(hashRoute, 1000);
        injectHashRoute(hashRoute, 3000);
        injectHashRoute(hashRoute, 6000);
        injectHashRoute(hashRoute, 10000);
    }

    private void injectHashRoute(String hashRoute, long delayMs) {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        String escapedRoute = hashRoute.replace("\\", "\\\\").replace("'", "\\'");
        final String js = "window.location.hash='" + escapedRoute + "';";
        getBridge().getWebView().postDelayed(() -> {
            if (getBridge() == null || getBridge().getWebView() == null) {
                return;
            }
            getBridge().getWebView().evaluateJavascript(js, null);
        }, delayMs);
    }

    private void handlePushLaunch(Intent intent) {
        if (intent == null || !intent.getBooleanExtra("fromPush", false)) {
            return;
        }

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
    }

    private void primeFcmToken() {
        FirebaseMessaging.getInstance().setAutoInitEnabled(true);
        FirebaseMessaging.getInstance().getToken()
            .addOnSuccessListener(token -> {
                if (token == null || token.isEmpty()) {
                    return;
                }

                getSharedPreferences("hyeni_location_prefs", MODE_PRIVATE)
                    .edit()
                    .putString("fcmToken", token)
                    .apply();

                Log.i("MainActivity", "FCM token primed");
            })
            .addOnFailureListener(error ->
                Log.w("MainActivity", "Failed to prime FCM token", error)
            );
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == CORE_PERMISSION_REQUEST_CODE) {
            Log.i("MainActivity", "Initial core permission prompt completed");
            return;
        }

    }

    // Phase 5 RL-03: synchronous check used by the WebChromeClient permission
    // gate to decide whether the WebView getUserMedia() request should be
    // forwarded. We deliberately only look at the current OS-level
    // RECORD_AUDIO grant — we do NOT attempt to re-request it here, because
    // onPermissionRequest runs on the UI thread during a WebView callback and
    // cannot block for an async runtime prompt. The runtime prompt is handled
    // by the in-app permission wizard / RemoteListenActivity consent flow.
    private boolean hasRecordAudioPermissionGranted() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED;
    }

    // QR pairing scanner gate. WebView's getUserMedia({video}) raises a
    // RESOURCE_VIDEO_CAPTURE PermissionRequest; we forward it only when the
    // OS-level CAMERA permission was granted by the user from the QR scanner
    // permission flow. On denial the JS side receives a
    // `camera-permission-denied` DOM event so it can guide the child to the app
    // settings.
    private boolean hasCameraPermissionGranted() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED;
    }

}
