package com.hyeni.calendar;

import android.Manifest;
import android.app.ActivityOptions;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorManager;
import android.hardware.TriggerEvent;
import android.hardware.TriggerEventListener;
import android.location.Location;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.BatteryManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.ActivityRecognition;
import com.google.android.gms.location.ActivityTransition;
import com.google.android.gms.location.ActivityTransitionEvent;
import com.google.android.gms.location.ActivityTransitionRequest;
import com.google.android.gms.location.ActivityTransitionResult;
import com.google.android.gms.location.DetectedActivity;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class LocationService extends Service {

    private static final String TAG = "LocationService";
    private static final String CHANNEL_ID = "hyeni_location_v4";
    private static final String ALERT_CHANNEL_ID = NotificationHelper.CHANNEL_EMERGENCY;
    // v5_silent_cover: 무음 + 폴더블 cover display 호환. 채널 ID 단일 소스 =
    // NotificationHelper.CHANNEL_REMOTE_LISTEN. sound=null + vibration=false 로 무음,
    // bypassDnd=true 로 cover display 에 알림 노출 → fullScreenIntent 가 RemoteListenActivity launch 가능.
    private static final String REMOTE_LISTEN_CHANNEL_ID = NotificationHelper.CHANNEL_REMOTE_LISTEN;
    public static final String ACTION_REFRESH_NOW = "REFRESH_NOW";
    // Doze-bypass 위치 heartbeat (staleness reliability Phase 2). 정지+Doze 에서
    // FusedLocation 콜백이 멈춰도 AlarmManager(setExactAndAllowWhileIdle)가 주기적으로
    // 깨워 단발 fix 를 강제 → '학교 종일 정지' 4시간+ 공백을 주기 상한으로 근절한다.
    public static final String ACTION_HEARTBEAT_FIX = "HEARTBEAT_FIX";
    private static final int NOTIFICATION_ID = 9001;
    private static final int ALERT_NOTIFICATION_BASE = 10000;
    // Pending 알림 폴링은 FCM 누락 대비 fallback 이다. 15초 폴링은 하루 수천 번
    // 라디오를 깨워 배터리 소모가 컸으므로, 즉시성은 FCM 에 맡기고 fallback 만 유지한다.
    private static final long NOTIF_POLL_INTERVAL_MS = 60_000;
    private static final long EVENT_CHECK_INTERVAL_MS = 60_000; // 서버 cron 보조용 로컬 평가
    // 일정 목록은 자주 안 바뀌므로 get_today_events 네트워크 fetch 와 60초 시각 평가를 분리한다.
    // events 는 이 주기로만 네트워크로 갱신해 캐시하고, 60초 tick 은 캐시로 로컬 평가만 수행 →
    // 라디오 깨움을 ~2880회/일에서 ~720회/일로 낮춘다. (tickPlaceGeofence 의 refresh/eval 분리 패턴.)
    private static final long EVENT_REFRESH_INTERVAL_MS = 2 * 60_000L;
    private static final String PREFS_NAME = "hyeni_location_prefs";
    private static final String PREF_LOCATION_INTERVAL_MODE = "locationIntervalMode";
    private static final String POLLED_DEDUPE_PREFS = "hyeni_polled_notification_ack";
    private static final long POLLED_DEDUPE_WINDOW_MS = 12 * 60 * 60 * 1000L;
    // NTV-H4: persisted mirror of shownEventNotifs (arrival / miss alert dedup).
    private static final String SHOWN_NOTIFS_PREFS = "hyeni_shown_event_notifs";
    private static final long SHOWN_NOTIFS_TTL_MS = 24 * 60 * 60 * 1000L;

    // Location tracking constants
    private static final long LOCATION_INTERVAL_MOVING_MS = 15_000;
    // 정지 중에는 위치 신선도보다 배터리 보호가 우선이다. 출발 감지는
    // significant-motion/activity transition 이 즉시 moving 모드로 올린다.
    private static final long LOCATION_INTERVAL_STATIONARY_MS = 120_000;
    private static final long LOCATION_MIN_INTERVAL_STATIONARY_MS = 60_000;
    private static final float STATIONARY_THRESHOLD_M = 30f;  // 30m 이내 이동 = 정지로 간주
    // Phase C: 1분 → 3분. 짧은 정지(예: 횡단보도 대기)가 BALANCED_POWER 모드 진입 안 시키도록.
    private static final long STATIONARY_WINDOW_MS = 180_000;
    private static final float MIN_UPLOAD_DISTANCE_M = 2f;
    private static final float MIN_UPDATE_DISTANCE_M = 0f;
    // Phase C: 100m -> 50m. -> 150m (NTV-H8: 실내에서도 끊김없는 추적을 위해 완화)
    private static final float MAX_ACCURACY_M = 150f;

    private static final long MAX_UPLOAD_AGE_MS = 60_000L;
    private static final long LOCATION_FIX_WATCHDOG_INTERVAL_MS = 120_000L;
    private static final long LOCATION_FIX_STALE_MS = 180_000L;
    // 위치는 안전 핵심 기능이다. 이동 중에는 촘촘히 남기되, 정지 중 history heartbeat 는
    // 배터리 보호를 위해 2분 단위로 제한한다.
    private static final float MIN_HISTORY_DISTANCE_M = 2f;
    private static final long MAX_HISTORY_AGE_MS = 120_000L;
    // 도로매칭(Kakao) 실패 시: 직전→실측 간 거리가 이 값 이하인 조밀 캡처는 직선이
    // 충분히 정확하므로 실측(is_estimated=false)으로 기록한다. 초과(듬성한 갭)일 때만
    // 직선 보간 '채움점'을 추정으로 표기. trailMath LOCATION_TRAIL_DASHED_GAP_M=150 정렬.
    private static final float ESTIMATED_FILL_MIN_GAP_M = 150f;
    // 오프라인 버퍼 보관 한도 — 48시간 초과 점은 플러시 전 prune.
    private static final long LOCATION_BUFFER_MAX_AGE_MS = 48L * 60L * 60L * 1000L;
    // 오프라인 버퍼 줄 수 상한 — age prune 의 보조 안전장치. 플러시가 계속 실패해도
    // 버퍼가 발산하지 않게 가장 오래된 초과분을 버린다. 활발한 48시간 이동 기록
    // (15초 샘플 기준 48시간 약 1.2만 점)의 여유 — 정상 데이터는 잘리지 않고
    // 비정상 장기 누적만 차단한다.
    private static final int LOCATION_BUFFER_MAX_LINES = 100000;
    // 한 번의 upload 요청에 보낼 최대 행 수. 서버 RPC 1요청에 수천 행을 보내면
    // 타임아웃(누적 눈덩이)되므로 이 상한으로 분할 전송한다. 성공한 chunk 만 버퍼에서 제거.
    private static final int LOCATION_FLUSH_BATCH_LIMIT = 400;
    private static final int LOW_BATTERY_THRESHOLD_PERCENT = 5;
    private static final long LOW_BATTERY_CHECK_INTERVAL_MS = 60_000L;
    private static final long LOW_BATTERY_SAVE_INTERVAL_MS = 5 * 60_000L;
    private volatile String locationIntervalMode = "balanced";
    private volatile long activeMovingIntervalMs = LOCATION_INTERVAL_MOVING_MS;
    private volatile long activeStationaryIntervalMs = LOCATION_INTERVAL_STATIONARY_MS;
    private volatile long activeStationaryMinIntervalMs = LOCATION_MIN_INTERVAL_STATIONARY_MS;
    private volatile long activeMaxUploadAgeMs = MAX_UPLOAD_AGE_MS;
    private volatile long activeLocationFixStaleMs = LOCATION_FIX_STALE_MS;
    private volatile long activeMaxHistoryAgeMs = MAX_HISTORY_AGE_MS;

    // 스코프드 WakeLock: 영구 6h wakelock 을 제거(idle 시 Doze 절전 허용 = 배터리 절감)하고,
    // 네트워크 업로드/알림 작업과 fix 획득 동안에만 CPU 를 깨워둔다. timeout 은 정상 경로에서
    // 도달해선 안 되는 leak 비상 상한이다(정상은 finally 즉시 release / fix 는 콜백 도착으로 종료).
    // 네트워크 worst case: sendParentAlert insert+push 순차 retry(각 3회·OkHttp 15s) ≈ 273s(보수
    // 추정; 실측 worst ~183s) < 360s 상한. 정상 경로는 finally 즉시 release 라 상한에 도달하지 않는다.
    private static final long NETWORK_WAKELOCK_TIMEOUT_MS = 6 * 60 * 1000L; // 360s leak 비상 상한
    private static final long FIX_WAKELOCK_TIMEOUT_MS = 25 * 1000L; // high 12s + balanced 폴백 여유

    private FusedLocationProviderClient fusedClient;
    private LocationCallback locationCallback;
    private OkHttpClient httpClient;
    private PowerManager.WakeLock fixWakeLock; // fix 비동기 콜백 도착까지 CPU 유지(referenceCounted=false)
    private Handler handler;
    private Runnable notifPollRunnable;
    private Runnable eventCheckRunnable;
    private Runnable tokenRefreshRunnable;
    private Runnable lowBatteryRunnable;
    private Runnable locationFixWatchdogRunnable;
    private static final long TOKEN_REFRESH_INTERVAL_MS = 50 * 60 * 1000L; // refresh token every 50min (before 60min expiry)
    private final AtomicInteger alertCounter = new AtomicInteger(0);

    // Track which event notifications we already showed (to avoid duplicates)
    private final Set<String> shownEventNotifs = ConcurrentHashMap.newKeySet();

    // get_today_events 네트워크 결과 캐시(EVENT_REFRESH_INTERVAL_MS throttle). 60초 시각 평가는
    // 이 캐시로 수행하고, 캐시가 신선하면 RPC 호출(라디오 깨움)을 건너뛴다. 자정(dateKey 변경) 시 강제 갱신.
    private volatile String cachedEventsJson = null;
    private volatile String cachedEventsDateKey = "";
    private long eventRefreshAtMs = 0L;

    // ── Auto-silent mode at event locations ──────────────────────────────────────
    private static final float GEOFENCE_RADIUS_M = 80f;
    private static final int SILENT_WINDOW_BEFORE_MIN = 10;  // activate 10min before event
    private static final int SILENT_WINDOW_AFTER_MIN = 180;  // max 3 hours after event start
    private AudioManager audioManager;
    private int savedRingerMode = -1;  // -1 = not saved
    private String silentForEventId = null;
    private double silentEventLat = Double.NaN;
    private double silentEventLng = Double.NaN;

    // Kalman filter state for latitude and longitude
    private boolean kalmanInitialized = false;
    private double kalmanLat;
    private double kalmanLng;
    private double kalmanLatVariance;
    private double kalmanLngVariance;
    private static final double KALMAN_PROCESS_NOISE = 1e-8;

    // Adaptive location interval state
    private boolean isStationary = false;
    private Location stationaryReferenceLocation = null;
    private long stationaryReferenceTime = 0;

    // Significant-motion sensor: detects movement start while stationary,
    // even in Doze — route tracking ramps up the instant the child moves.
    private SensorManager sensorManager;
    private Sensor significantMotionSensor;
    private TriggerEventListener significantMotionListener;
    private boolean significantMotionArmed = false;

    // Last uploaded position for minimum distance filter
    private double lastUploadedLat = Double.NaN;
    private double lastUploadedLng = Double.NaN;
    private long lastUploadedAtMs = 0L;
    private double lastHistoryLat = Double.NaN;
    private double lastHistoryLng = Double.NaN;
    private long lastHistoryAtMs = 0L;
    private long lastLocationAcceptedAtMs = 0L;
    private long lastLowBatterySaveAtMs = 0L;
    // 배터리 ≤5% 진입 시 부모 알림을 에피소드당 1회만 보낸다(충전으로 회복되면 해제).
    private boolean lowBatteryAlertSent = false;

    // 오프라인 이동경로 버퍼 파일 (네트워크 유실 시 점 적재, 복구 시 플러시)
    private File locationBufferFile;
    private ConnectivityManager.NetworkCallback networkCallback;
    private final AtomicBoolean flushInFlight = new AtomicBoolean(false);

    private String supabaseUrl;
    private String supabaseKey;
    private String userId;
    private String familyId;
    private String accessToken;
    // D1 access token(1h)이 백그라운드에서 만료되면 WebView 가 정지되어 갱신하지 못한다.
    // 저장된 refresh token(30일)으로 Worker /auth/refresh 를 직접 호출해 자체 갱신한다.
    private String refreshToken;

    private static class RoutePoint {
        final double lat;
        final double lng;

        RoutePoint(double lat, double lng) {
            this.lat = lat;
            this.lng = lng;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        fusedClient = LocationServices.getFusedLocationProviderClient(this);
        httpClient = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .protocols(Collections.singletonList(Protocol.HTTP_1_1))
            .build();
        handler = new Handler(Looper.getMainLooper());
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        initSignificantMotionSensor();
        locationBufferFile = new File(getFilesDir(), "location_buffer.jsonl");
        registerNetworkCallback();
        createNotificationChannels();
        recoverSilentModeIfNeeded();
        loadShownEventNotifs();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        boolean refreshNow = intent != null && ACTION_REFRESH_NOW.equals(intent.getAction());
        boolean heartbeat = intent != null && ACTION_HEARTBEAT_FIX.equals(intent.getAction());

        if (intent != null) {
            if (intent.hasExtra("userId")) {
                userId = intent.getStringExtra("userId");
                familyId = intent.getStringExtra("familyId");
                supabaseUrl = intent.getStringExtra("supabaseUrl");
                supabaseKey = intent.getStringExtra("supabaseKey");
                accessToken = intent.getStringExtra("accessToken");
                String intentRefresh = intent.getStringExtra("refreshToken");
                if (intentRefresh != null && !intentRefresh.isEmpty()) refreshToken = intentRefresh;
                String role = intent.getStringExtra("role");
                String intervalMode = intent.getStringExtra("intervalMode");

                // Walking-route lookups go through the kakao-proxy Edge
                // Function, so kakaoRestKey is no longer ingested. Strip any
                // legacy value left from previous installs.
                SharedPreferences.Editor editor = prefs.edit()
                    .putString("userId", userId)
                    .putString("familyId", familyId)
                    .putString("supabaseUrl", supabaseUrl)
                    .putString("supabaseKey", supabaseKey)
                    .putString("accessToken", accessToken)
                    .putBoolean("serviceEnabled", true)
                    .remove("kakaoRestKey");
                if (refreshToken != null && !refreshToken.isEmpty()) editor.putString("refreshToken", refreshToken);
                if (role != null) editor.putString("role", role);
                if (intervalMode != null) editor.putString(PREF_LOCATION_INTERVAL_MODE, normalizeLocationIntervalMode(intervalMode));
                editor.apply();
            }

            if ("STOP".equals(intent.getAction())) {
                prefs.edit().putBoolean("serviceEnabled", false).apply();
                ServiceKeepAlive.cancel(this);
                cancelAlarmRestart();
                cancelHeartbeat();
                stopAll();
                stopForeground(true);
                stopSelf();
                return START_NOT_STICKY;
            }
        }

        if (userId == null) {
            userId = prefs.getString("userId", null);
            familyId = prefs.getString("familyId", null);
            supabaseUrl = prefs.getString("supabaseUrl", null);
            supabaseKey = prefs.getString("supabaseKey", null);
            accessToken = prefs.getString("accessToken", null);
            refreshToken = prefs.getString("refreshToken", null);
            // Drop legacy kakaoRestKey from older installs (best-effort
            // cleanup; new installs never write it).
            if (prefs.contains("kakaoRestKey")) {
                prefs.edit().remove("kakaoRestKey").apply();
            }
        }

        applyLocationIntervalMode(prefs.getString(PREF_LOCATION_INTERVAL_MODE, "balanced"), true);

        if (userId == null || familyId == null || supabaseUrl == null) {
            Log.w(TAG, "Missing config, stopping service");
            stopSelf();
            return START_NOT_STICKY;
        }

        String cachedFcmToken = prefs.getString("fcmToken", "");
        NativePushTokenSync.sync(this, cachedFcmToken);

        // 위치 권한 체크 — 없으면 서비스 시작하지 않음 (SDK 34+ FGS 크래시 방지)
        if (androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "Location permission not granted, cannot start foreground service");
            stopSelf();
            return START_NOT_STICKY;
        }

        try {
            // Android 14+ (UDC, sdk 34) requires the foreground service type
            // to be passed at startForeground. The manifest already declares
            // foregroundServiceType="location"; the runtime mismatch otherwise
            // crashes with MissingForegroundServiceTypeException.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(
                    NOTIFICATION_ID,
                    buildForegroundNotification(),
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                );
            } else {
                startForeground(NOTIFICATION_ID, buildForegroundNotification());
            }
        } catch (SecurityException e) {
            Log.e(TAG, "Cannot start foreground service: " + e.getMessage());
            stopSelf();
            return START_NOT_STICKY;
        }
        requestBatteryOptimizationExemption();
        ServiceKeepAlive.schedule(this);
        startLocationTracking();
        startLocationFixWatchdog();
        setupActivityTransitionTracking();
        startLowBatteryLocationSafeguard();
        startNotificationPolling();
        startEventTimeChecking();
        startPlaceGeofenceChecking();
        startTokenRefresh();
        // heartbeat 로 깨어났을 땐 startLocationTracking 이 early-return(콜백 생존)할 수
        // 있으므로 명시적으로 단발 fix 를 강제한다 — Doze 에서 깬 김에 한 점 확보.
        if (refreshNow || heartbeat) {
            Log.i(TAG, (heartbeat ? "HEARTBEAT_FIX" : "REFRESH_NOW") + " received, requesting immediate high-accuracy fix");
            requestImmediateLocationFix();
        }

        // 서비스 시작·부모 위치 새로고침(ACTION_REFRESH_NOW)마다 버퍼 플러시 시도.
        flushLocationBuffer();

        // Doze-bypass heartbeat 재예약 — 모든 onStartCommand 경로에서 항상 호출해
        // self-rescheduling chain 이 끊기지 않게 한다(누락 시 정지+Doze 에서 영구
        // 침묵 = 안전 핵심 미발). FLAG_UPDATE_CURRENT 라 중복 예약돼도 1건만 유효.
        scheduleNextHeartbeat();

        return START_STICKY;
    }

    // ── 스코프드 WakeLock (영구 6h wakelock 대체) ────────────────────────────────
    // 네트워크 업로드/알림 스레드가 도는 동안에만 CPU 를 깨우고 finally 에서 즉시 release →
    // idle(정지 측위 120s 갭)에는 CPU 가 Doze 절전에 들 수 있어 배터리를 아낀다. Doze 구간의
    // 측위/안전 복원력은 wakelock 이 아니라 AlarmManager heartbeat(5분)+WorkManager keepalive 가
    // 떠받친다(PARTIAL_WAKE_LOCK 은 CPU 만 켤 뿐 Doze 의 alarm/네트워크 제약은 못 피하므로 idle
    // wakelock 은 순수 낭비였다).
    // 불변식: work 가 또 다른 runOnNetworkThread 를 spawn 해도(예: event_check→sendParentAlert)
    // 그 자식은 자기 scoped wakelock 으로 독립 보호된다 → 부모 finally 가 먼저 release 해도 안전.
    private void runOnNetworkThread(String tag, Runnable work) {
        new Thread(() -> {
            PowerManager.WakeLock wl = acquireScopedWakeLock(tag, NETWORK_WAKELOCK_TIMEOUT_MS);
            try {
                work.run();
            } finally {
                releaseScopedWakeLock(wl);
            }
        }).start();
    }

    private PowerManager.WakeLock acquireScopedWakeLock(String tag, long timeoutMs) {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return null;
            PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "hyeni:" + tag);
            wl.acquire(timeoutMs);
            return wl;
        } catch (Exception e) {
            Log.w(TAG, "scoped wakelock acquire failed: " + tag, e);
            return null;
        }
    }

    private void releaseScopedWakeLock(PowerManager.WakeLock wl) {
        if (wl != null && wl.isHeld()) {
            try { wl.release(); } catch (Exception ignored) {}
        }
    }

    // fix 요청(getCurrentLocation/getLastLocation)의 비동기 콜백이 도착할 때까지 CPU 를 유지한다.
    // heartbeat(AlarmManager)가 Doze 에서 깨운 직후 fix 획득 전 CPU 가 다시 잠드는 것을 막는다.
    // 성공 콜백→handleLocation→uploadLocation(scoped wakelock)으로 보호가 이어지므로 명시 release
    // 없이 FIX_WAKELOCK_TIMEOUT_MS 상한에 맡겨도 leak 이 없다(referenceCounted=false → 재호출=타이머 갱신).
    private void acquireFixWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            if (fixWakeLock == null) {
                fixWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "hyeni:fix");
                fixWakeLock.setReferenceCounted(false);
            }
            fixWakeLock.acquire(FIX_WAKELOCK_TIMEOUT_MS);
        } catch (Exception e) {
            Log.w(TAG, "fix wakelock acquire failed", e);
        }
    }

    // ── Battery Optimization Exemption ──────────────────────────────────────────
    @android.annotation.SuppressLint("BatteryLife")
    private void requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                try {
                    Intent intent = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(android.net.Uri.parse("package:" + getPackageName()));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                    Log.i(TAG, "Requesting battery optimization exemption");
                } catch (Exception e) {
                    Log.w(TAG, "Cannot request battery exemption: " + e.getMessage());
                }
            } else {
                Log.i(TAG, "Already exempted from battery optimizations");
            }
        }
    }

    private void startLowBatteryLocationSafeguard() {
        if (lowBatteryRunnable != null) return;

        lowBatteryRunnable = new Runnable() {
            @Override
            public void run() {
                checkLowBatteryAndSaveLocation();
                handler.postDelayed(this, LOW_BATTERY_CHECK_INTERVAL_MS);
            }
        };
        handler.post(lowBatteryRunnable);
        Log.i(TAG, "Low battery location safeguard started");
    }

    private void checkLowBatteryAndSaveLocation() {
        int batteryPercent = getBatteryPercent();
        if (batteryPercent < 0) return;
        if (batteryPercent > LOW_BATTERY_THRESHOLD_PERCENT) {
            // 충분히 회복되면(>10%) 다음 방전 에피소드를 위해 1회성 알림 플래그 해제.
            if (batteryPercent > LOW_BATTERY_THRESHOLD_PERCENT + 5) lowBatteryAlertSent = false;
            return;
        }

        // 5% 이하 진입 — 에피소드당 1회 부모 알림(방전 직전이라 아직 푸시 전송 가능).
        if (!lowBatteryAlertSent) {
            lowBatteryAlertSent = true;
            sendParentDeviceAlert(
                "low_battery",
                "아이 기기 배터리가 곧 방전돼요",
                "배터리가 " + batteryPercent + "% 남았어요. 곧 꺼질 수 있으니 확인해 주세요.",
                "warning",
                "low-battery:" + userId + ":" + (System.currentTimeMillis() / 3_600_000L)
            );
        }

        long now = System.currentTimeMillis();
        if (now - lastLowBatterySaveAtMs < LOW_BATTERY_SAVE_INTERVAL_MS) return;
        lastLowBatterySaveAtMs = now;

        Log.w(TAG, "Battery is " + batteryPercent + "%, forcing last location save");
        requestImmediateLocationFix();
    }

    // 아이 기기 상태(저배터리·종료 등)를 부모에게 알린다.
    // 알림센터(parent_alerts) + FCM 푸시(push-notify) 둘 다 best-effort. 백그라운드 스레드.
    private void sendParentDeviceAlert(String alertType, String title, String message,
                                       String severity, String idempotencyKey) {
        if (isBlank(familyId) || isBlank(supabaseUrl) || isBlank(supabaseKey)) {
            lowBatteryAlertSent = false;
            Log.w(TAG, "parent device alert skipped: missing Supabase config");
            return;
        }
        final String baseUrl = supabaseUrl.replaceAll("/+$", "");
        // push_idempotency.key 는 uuid 컬럼이라 비-UUID 키는 400 으로 거부된다.
        // 시간 버킷 문자열을 결정적 UUID(v3)로 변환해 서버측 중복 방지를 유지한다.
        final String idemUuid = java.util.UUID.nameUUIDFromBytes(
            idempotencyKey.getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
        runOnNetworkThread("device_alert", () -> {
            try {
                JSONObject alertBody = new JSONObject()
                    .put("p_family_id", familyId)
                    .put("p_alert_type", alertType)
                    .put("p_title", title)
                    .put("p_message", message)
                    .put("p_severity", severity)
                    .put("p_event_id", idempotencyKey);
                boolean insertOk = postWithAuthRetry(
                    baseUrl + "/rest/v1/rpc/insert_parent_alert_v2",
                    alertBody.toString()
                );

                JSONObject pushBody = new JSONObject()
                    .put("action", "parent_alert")
                    .put("familyId", familyId)
                    .put("senderUserId", userId)
                    .put("severity", severity)
                    .put("alertType", alertType)
                    .put("title", title)
                    .put("message", message)
                    .put("idempotency_key", idemUuid);
                boolean pushOk = postWithAuthRetry(
                    baseUrl + "/functions/v1/push-notify",
                    pushBody.toString(),
                    idemUuid
                );

                if (insertOk || pushOk) {
                    Log.i(TAG, "parent device alert sent: " + alertType
                        + " (insert=" + insertOk + " push=" + pushOk + ")");
                } else {
                    Log.w(TAG, "parent device alert failed entirely: " + alertType);
                }
                if (!insertOk) {
                    lowBatteryAlertSent = false;
                }
            } catch (Exception e) {
                lowBatteryAlertSent = false;
                Log.w(TAG, "parent device alert failed (" + alertType + ")", e);
            }
        });
    }

    // ── Phase C: 네이티브 즉시 등록장소 geofence ────────────────────────────────
    // 자녀 기기가 절전형 주기로 등록장소 출입을
    // 즉시 평가 → place_arrived/place_left 부모 알림. 서버 cron(*/2분)과 같은 10분
    // 버킷 멱등키(GeofenceIdempotency)로 dedup. 결정 로직은 GeofenceStateMachine
    // (클라/서버 parity, JVM 단위테스트). 앱 백그라운드/킬 시 WebView geofence 가
    // 멈춰도 foreground service 의 이 평가는 계속 동작한다.
    private static final long PLACE_EVAL_INTERVAL_MS = 60_000L;
    private static final long PLACE_REFRESH_INTERVAL_MS = 5 * 60_000L;
    // 이전 방문 상태로 다음날 출발 알림을 만들지 않게 6시간 뒤 persisted 상태를 만료한다.
    private static final long PLACE_STATE_TTL_MS = 6L * 60 * 60_000L;
    private static final String PLACE_STATE_PREFIX = "place_geo_";
    private final java.util.List<org.json.JSONObject> cachedPlaces = new java.util.ArrayList<>(); // {placeKey,name,lat,lng}
    private volatile boolean placeAlertsEnabled = false; // premium && registered_place_alerts_enabled
    private volatile String cachedChildName = ""; // family_members.name (부모 알림 카피용, M2)
    private static final long PLACE_FIX_FRESH_MS = 15 * 60_000L; // 서버 GEOFENCE_FIX_FRESH_MS parity (M1)
    private long placeRefreshAtMs = 0L;
    private Runnable placeGeofenceRunnable;

    private void startPlaceGeofenceChecking() {
        if (handler == null) return; // handler 는 onCreate 에서 init (startEventTimeChecking 도 의존)
        placeGeofenceRunnable = new Runnable() {
            @Override public void run() {
                try { tickPlaceGeofence(); } catch (Exception e) { Log.w(TAG, "place geofence tick failed", e); }
                if (placeGeofenceRunnable != null) handler.postDelayed(this, PLACE_EVAL_INTERVAL_MS);
            }
        };
        handler.postDelayed(placeGeofenceRunnable, 5_000L);
    }

    private void tickPlaceGeofence() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        if (!"child".equalsIgnoreCase(prefs.getString("role", ""))) return; // 자녀 기기 전용
        long now = System.currentTimeMillis();
        if (now - placeRefreshAtMs > PLACE_REFRESH_INTERVAL_MS || (placeRefreshAtMs == 0L)) {
            placeRefreshAtMs = now;
            runOnNetworkThread("place_refresh", this::refreshPlacesAndGates);
        }
        if (!placeAlertsEnabled || Double.isNaN(lastUploadedLat) || Double.isNaN(lastUploadedLng)) return;
        // M1: stale fix 면 평가 skip — wall-clock 만 흐르고 좌표가 frozen 이면 가짜
        // dwell/departure 전이가 날 수 있다(서버 GEOFENCE_FIX_FRESH_MS 와 동일 보호).
        if (lastUploadedAtMs > 0L && now - lastUploadedAtMs > PLACE_FIX_FRESH_MS) return;
        java.util.List<org.json.JSONObject> places;
        synchronized (cachedPlaces) { places = new java.util.ArrayList<>(cachedPlaces); }
        for (org.json.JSONObject p : places) {
            try { evaluateOnePlace(p, lastUploadedLat, lastUploadedLng, now); }
            catch (Exception e) { Log.w(TAG, "place eval failed", e); }
        }
    }

    // saved_places + academies fetch + 게이트(premium·설정) 갱신. 백그라운드 Thread.
    private void refreshPlacesAndGates() {
        if (isBlank(familyId) || isBlank(supabaseUrl)) return;
        final String base = supabaseUrl.replaceAll("/+$", "");
        try {
            // 게이트: 프리미엄(trial/active/grace) && families.registered_place_alerts_enabled != false
            boolean premium = false;
            org.json.JSONArray subs = httpGetArray(base + "/rest/v1/family_subscription?family_id=eq." + familyId + "&select=status");
            for (int i = 0; subs != null && i < subs.length(); i++) {
                String st = subs.getJSONObject(i).optString("status", "");
                if ("trial".equals(st) || "active".equals(st) || "grace".equals(st)) { premium = true; break; }
            }
            boolean settingOn = true;
            org.json.JSONArray fam = httpGetArray(base + "/rest/v1/families?id=eq." + familyId + "&select=registered_place_alerts_enabled");
            if (fam != null && fam.length() > 0 && fam.getJSONObject(0).has("registered_place_alerts_enabled")) {
                settingOn = fam.getJSONObject(0).optBoolean("registered_place_alerts_enabled", true);
            }
            placeAlertsEnabled = premium && settingOn;
            if (!placeAlertsEnabled) { synchronized (cachedPlaces) { cachedPlaces.clear(); } return; }

            // M2: 부모 알림 카피용 자녀 표시명 (없으면 childDisplayName 이 "아이" 폴백)
            org.json.JSONArray me = httpGetArray(base + "/rest/v1/family_members?family_id=eq." + familyId + "&user_id=eq." + userId + "&select=name");
            if (me != null && me.length() > 0) cachedChildName = me.getJSONObject(0).optString("name", "");

            java.util.List<org.json.JSONObject> next = new java.util.ArrayList<>();
            collectPlaces(next, base + "/rest/v1/saved_places?family_id=eq." + familyId + "&select=id,name,location", "saved_place");
            collectPlaces(next, base + "/rest/v1/academies?family_id=eq." + familyId + "&select=id,name,location", "academy");
            synchronized (cachedPlaces) { cachedPlaces.clear(); cachedPlaces.addAll(next); }
        } catch (Exception e) {
            Log.w(TAG, "refreshPlacesAndGates failed", e);
        }
    }

    private void collectPlaces(java.util.List<org.json.JSONObject> out, String url, String source) {
        try {
            org.json.JSONArray arr = httpGetArray(url);
            for (int i = 0; arr != null && i < arr.length(); i++) {
                org.json.JSONObject r = arr.getJSONObject(i);
                org.json.JSONObject loc = r.optJSONObject("location");
                if (loc == null) continue;
                double lat = loc.optDouble("lat", Double.NaN), lng = loc.optDouble("lng", Double.NaN);
                if (Double.isNaN(lat) || Double.isNaN(lng)) continue;
                out.add(new org.json.JSONObject()
                    .put("placeKey", "registered:" + source + ":" + r.optString("id"))
                    .put("name", r.optString("name", "등록된 장소"))
                    .put("lat", lat).put("lng", lng));
            }
        } catch (Exception e) { Log.w(TAG, "collectPlaces failed: " + source, e); }
    }

    private org.json.JSONArray httpGetArray(String url) {
        String bearer = (accessToken != null && !accessToken.isEmpty()) ? accessToken : supabaseKey;
        try {
            Request req = new Request.Builder().url(url)
                .header("apikey", supabaseKey).header("Authorization", "Bearer " + bearer).get().build();
            Response resp = httpClient.newCall(req).execute();
            // 장소/구독 GET(geofence 위험지역·도착 판정 기반)도 D1 1h 만료 시 갱신 후 재시도.
            if (resp.code() == 401 || resp.code() == 403) {
                resp.close();
                String renewed = networkRefreshAccessToken();
                if (renewed == null || renewed.isEmpty()) return null;
                resp = httpClient.newCall(new Request.Builder().url(url)
                    .header("apikey", supabaseKey).header("Authorization", "Bearer " + renewed).get().build()).execute();
            }
            if (!resp.isSuccessful()) { resp.close(); return null; }
            String b = resp.body() != null ? resp.body().string() : "[]";
            resp.close();
            return new org.json.JSONArray(b);
        } catch (Exception e) { Log.w(TAG, "httpGetArray failed: " + url, e); return null; }
    }

    private void evaluateOnePlace(org.json.JSONObject p, double lat, double lng, long now) throws Exception {
        String placeKey = p.getString("placeKey");
        double plat = p.getDouble("lat"), plng = p.getDouble("lng");
        boolean hadGeoState = hasFreshGeoState(placeKey);
        GeofenceStateMachine.GeofenceState prev = loadGeoState(placeKey);
        GeofenceStateMachine.GeofenceState evalState = hadGeoState
            ? prev
            : GeofenceStateMachine.bootstrapInitialInside(
                prev, lat, lng, null, now, plat, plng, 30.0, GeofenceStateMachine.GeofenceConfig.DEFAULT);
        if (!sameState(prev, evalState)) saveGeoState(placeKey, evalState);
        GeofenceStateMachine.TransitionResult res = GeofenceStateMachine.evaluateTransition(
            evalState, lat, lng, null, now, plat, plng, 30.0, GeofenceStateMachine.GeofenceConfig.DEFAULT);
        if (res.action == GeofenceStateMachine.Action.ENTER || res.action == GeofenceStateMachine.Action.LEAVE) {
            final boolean arrived = res.action == GeofenceStateMachine.Action.ENTER;
            long episodeMs = arrived
                ? (res.nextState.firstInsideAtMs != null ? res.nextState.firstInsideAtMs : now)
                : (res.nextState.lastDepartedAtMs != null ? res.nextState.lastDepartedAtMs : now);
            long bucket = GeofenceIdempotency.placeEpisodeBucket(episodeMs);
            final String key = GeofenceIdempotency.placePresenceIdempotencyKey(arrived ? "arrived" : "left", userId, placeKey, bucket);
            String place = p.optString("name", "등록된 장소");
            final String alertType = arrived ? "place_arrived" : "place_left";
            final String title = arrived ? ("✅ " + place + " 도착") : ("🚶 " + place + " 출발");
            final String msg = arrived
                ? (childDisplayName() + "가 " + place + "에 도착했어요.")
                : (childDisplayName() + "가 " + place + "에서 출발했어요.");
            final String fPlaceKey = placeKey;
            final String fPlaceName = place;
            final GeofenceStateMachine.GeofenceState fNext = res.nextState;
            // H1: 전송 성공 시에만 phase 진행(서버 deliverAlert retry 설계 parity). 실패 시
            // state 미진행 → 다음 tick 재시도(멱등키로 dedup, 부모 알림 유실 방지).
            runOnNetworkThread("place_alert", () -> {
                if (sendPlaceAlert(alertType, title, msg, key)) {
                    saveGeoState(fPlaceKey, fNext);
                    // 집 도착이면 AI 친구가 먼저 말을 건다(숙제·하루 이야기).
                    if (arrived && fPlaceName.contains("집")) triggerHomeArrivalAiGreeting(fPlaceName);
                }
            });
            return;
        }
        // 비-발사 전이(pending/armed 타이머)는 네트워크 없이 즉시 영속.
        if (!sameState(evalState, res.nextState)
            || (!hadGeoState && res.action == GeofenceStateMachine.Action.OUTSIDE_NO_CHANGE)) {
            saveGeoState(placeKey, res.nextState);
        }
    }

    private String childDisplayName() {
        return isBlank(cachedChildName) ? "아이" : cachedChildName;
    }

    // 집 도착 시 AI 친구 선제 인사를 요청한다. 발송 여부(부모 설정·허용 시간창·
    // 크레딧·쿨다운)는 서버 ai-proactive-generate 가 판단하고, 만들어진 인사는
    // pending_notifications 폴링 경로로 이 기기에 알림으로 돌아온다(탭 → AI 채팅 직행).
    // 실패는 무시 — 도착 알림과는 독립이다. 백그라운드 Thread 에서 호출된다.
    private void triggerHomeArrivalAiGreeting(String placeName) {
        if (isBlank(familyId) || isBlank(userId) || isBlank(supabaseUrl) || isBlank(supabaseKey)) return;
        try {
            JSONObject body = new JSONObject()
                .put("familyId", familyId)
                .put("childUserId", userId)
                .put("trigger", "place_arrival")
                .put("placeName", placeName)
                .put("minIntervalMinutes", 120);
            boolean ok = postWithAuthRetry(
                supabaseUrl.replaceAll("/+$", "") + "/functions/v1/ai-proactive-generate",
                body.toString());
            Log.i(TAG, "home arrival AI greeting requested (ok=" + ok + ")");
        } catch (Exception e) {
            Log.w(TAG, "home arrival AI greeting failed", e);
        }
    }

    private boolean sameState(GeofenceStateMachine.GeofenceState a, GeofenceStateMachine.GeofenceState b) {
        return a.phase.equals(b.phase)
            && java.util.Objects.equals(a.firstInsideAtMs, b.firstInsideAtMs)
            && java.util.Objects.equals(a.departureArmedAtMs, b.departureArmedAtMs)
            && java.util.Objects.equals(a.lastDepartedAtMs, b.lastDepartedAtMs);
    }

    private GeofenceStateMachine.GeofenceState loadGeoState(String placeKey) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String raw = prefs.getString(PLACE_STATE_PREFIX + placeKey, null);
        if (raw == null) return GeofenceStateMachine.GeofenceState.INITIAL;
        try {
            org.json.JSONObject o = new org.json.JSONObject(raw);
            long updatedAt = o.optLong("u", 0L);
            if (System.currentTimeMillis() - updatedAt > PLACE_STATE_TTL_MS) return GeofenceStateMachine.GeofenceState.INITIAL;
            return new GeofenceStateMachine.GeofenceState(
                o.optString("p", "out"),
                o.has("fi") && !o.isNull("fi") ? o.getLong("fi") : null,
                o.has("da") && !o.isNull("da") ? o.getLong("da") : null,
                o.has("ld") && !o.isNull("ld") ? o.getLong("ld") : null);
        } catch (Exception e) { return GeofenceStateMachine.GeofenceState.INITIAL; }
    }

    private boolean hasFreshGeoState(String placeKey) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String raw = prefs.getString(PLACE_STATE_PREFIX + placeKey, null);
        if (raw == null) return false;
        try {
            org.json.JSONObject o = new org.json.JSONObject(raw);
            long updatedAt = o.optLong("u", 0L);
            return updatedAt > 0L && System.currentTimeMillis() - updatedAt <= PLACE_STATE_TTL_MS;
        } catch (Exception e) {
            return false;
        }
    }

    private void saveGeoState(String placeKey, GeofenceStateMachine.GeofenceState s) {
        try {
            org.json.JSONObject o = new org.json.JSONObject().put("p", s.phase).put("u", System.currentTimeMillis());
            if (s.firstInsideAtMs != null) o.put("fi", (long) s.firstInsideAtMs);
            if (s.departureArmedAtMs != null) o.put("da", (long) s.departureArmedAtMs);
            if (s.lastDepartedAtMs != null) o.put("ld", (long) s.lastDepartedAtMs);
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putString(PLACE_STATE_PREFIX + placeKey, o.toString()).apply();
        } catch (Exception e) { Log.w(TAG, "saveGeoState failed", e); }
    }

    // place_arrived/place_left 부모 알림 발송 (멱등키 = GeofenceIdempotency v4 UUID,
    // p_event_id·idempotency_key 둘 다 동일 → 서버 cron 발사와 dedup). 자녀 sender 제외.
    // 동기 호출(background Thread 에서 호출됨) — insert·push 둘 다 성공해야 true 반환해
    // 호출부가 state 를 진행(H1). 한쪽이라도 실패면 false → state 미진행 → 다음 tick 재시도.
    // 재시도 안전: parent_alerts 는 event_id 부분 UNIQUE+ON CONFLICT, push 는 push_idempotency
    // 로 각각 dedup → 재시도해도 중복 안 쌓임. 부분 실패 시 인앱/푸시 비대칭(한쪽 누락) 방지.
    private boolean sendPlaceAlert(String alertType, String title, String message, String idemUuid) {
        if (isBlank(familyId) || isBlank(supabaseUrl) || isBlank(supabaseKey)) return false;
        final String base = supabaseUrl.replaceAll("/+$", "");
        try {
            JSONObject alertBody = new JSONObject()
                .put("p_family_id", familyId).put("p_alert_type", alertType)
                .put("p_title", title).put("p_message", message)
                .put("p_severity", "info").put("p_event_id", idemUuid).put("p_child_user_id", userId);
            boolean insertOk = postWithAuthRetry(base + "/rest/v1/rpc/insert_parent_alert_v2", alertBody.toString());
            JSONObject pushBody = new JSONObject()
                .put("action", "parent_alert").put("familyId", familyId).put("senderUserId", userId)
                .put("severity", "info").put("alertType", alertType).put("title", title)
                .put("message", message).put("idempotency_key", idemUuid);
            boolean pushOk = postWithAuthRetry(base + "/functions/v1/push-notify", pushBody.toString(), idemUuid);
            Log.i(TAG, "place alert " + alertType + " (insert=" + insertOk + " push=" + pushOk + ")");
            return insertOk && pushOk;
        } catch (Exception e) {
            Log.w(TAG, "sendPlaceAlert failed", e);
            return false;
        }
    }

    private int getBatteryPercent() {
        Intent battery = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (battery == null) return -1;

        int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        if (level < 0 || scale <= 0) return -1;
        return Math.round((level * 100f) / scale);
    }

    // ── Crash Recovery: restore ringer if app crashed while in silent mode ─────
    private void recoverSilentModeIfNeeded() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        int persistedRinger = prefs.getInt("savedRingerMode", -1);
        String persistedEventId = prefs.getString("silentForEventId", null);
        if (persistedRinger >= 0 && persistedEventId != null && audioManager != null) {
            try {
                audioManager.setRingerMode(persistedRinger);
                Log.i(TAG, "Crash recovery: ringer restored to mode=" + persistedRinger);
            } catch (SecurityException e) {
                Log.w(TAG, "Crash recovery: cannot restore ringer: " + e.getMessage());
            }
            prefs.edit().remove("savedRingerMode").remove("silentForEventId").apply();
        }
    }

    // ── Token Refresh (re-read from SharedPreferences periodically) ─────────────
    private void startTokenRefresh() {
        if (tokenRefreshRunnable != null) return;

        tokenRefreshRunnable = new Runnable() {
            @Override
            public void run() {
                refreshAccessToken();
                handler.postDelayed(this, TOKEN_REFRESH_INTERVAL_MS);
            }
        };
        handler.postDelayed(tokenRefreshRunnable, TOKEN_REFRESH_INTERVAL_MS);
        Log.i(TAG, "Token refresh scheduled every 45min");
    }

    private void refreshAccessToken() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String newToken = prefs.getString("accessToken", null);
        if (newToken != null && !newToken.equals(accessToken)) {
            accessToken = newToken;
            Log.i(TAG, "Access token refreshed from SharedPreferences");
        }
        // 포그라운드에서 WebView 가 updateToken 으로 새 refresh token 을 써둘 수 있으므로 동기화.
        String prefRefresh = prefs.getString("refreshToken", null);
        if (prefRefresh != null && !prefRefresh.isEmpty() && !prefRefresh.equals(refreshToken)) {
            refreshToken = prefRefresh;
        }
    }

    private final Object refreshLock = new Object();
    private volatile long lastNetworkRefreshAtMs = 0L;

    private void stopForInvalidSession(String reason) {
        Log.w(TAG, "Stopping location service due to invalid session: " + reason);
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .edit()
            .putBoolean("serviceEnabled", false)
            .remove("accessToken")
            .remove("refreshToken")
            .apply();
        Runnable stop = () -> {
            stopAll();
            stopForeground(true);
            stopSelf();
        };
        if (handler != null) handler.post(stop);
        else stop.run();
    }

    // D1 access token(1h)이 백그라운드에서 만료되면 WebView 가 정지되어 아무도 갱신하지 못해
    // 위치 업로드가 401 로 멈춘다(자녀 위치 동결의 근본 원인). 저장된 refresh token(30일)으로
    // Worker 의 POST /auth/refresh 를 직접 호출해 새 access/refresh 를 받아 영속화한다.
    // refresh token 은 회전형(rotate)이므로 새 refresh 도 즉시 저장한다.
    // 성공 시 새 access token, 실패/불가 시 null. 동시 401 이 몰려도 한 번만 갱신하도록 동기화.
    @Nullable
    private String networkRefreshAccessToken() {
        synchronized (refreshLock) {
            final String failedToken = accessToken;
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            // 0) 포그라운드에선 WebView 가 갱신 후 updateToken 으로 prefs 에 새 토큰을 써둘 수 있다.
            //    회전 경쟁을 피하려고, 네트워크 갱신 전에 prefs 의 더 새 토큰을 먼저 채택한다.
            String prefAccess = prefs.getString("accessToken", null);
            String prefRefresh = prefs.getString("refreshToken", null);
            if (prefAccess != null && !prefAccess.isEmpty() && !prefAccess.equals(failedToken)) {
                accessToken = prefAccess;
                if (prefRefresh != null && !prefRefresh.isEmpty()) refreshToken = prefRefresh;
                return prefAccess;
            }
            // 직전 5초 내 이미 네트워크 갱신했다면(다른 요청이 막 갱신) 현재 토큰을 재사용.
            long sinceLast = System.currentTimeMillis() - lastNetworkRefreshAtMs;
            if (sinceLast < 5000L && accessToken != null && !accessToken.isEmpty()
                && !accessToken.equals(failedToken)) {
                return accessToken;
            }
            if (isBlank(refreshToken)) {
                stopForInvalidSession("missing_refresh_token");
                return null;
            }
            if (isBlank(supabaseUrl)) return null;
            try {
                String url = supabaseUrl.replaceAll("/+$", "") + "/auth/refresh";
                JSONObject reqBody = new JSONObject();
                reqBody.put("refresh_token", refreshToken);
                Response res = httpClient.newCall(new Request.Builder()
                    .url(url)
                    .header("Content-Type", "application/json")
                    .post(RequestBody.create(reqBody.toString(), MediaType.get("application/json")))
                    .build()).execute();
                int code = res.code();
                String respStr = res.body() != null ? res.body().string() : "";
                res.close();
                if (code < 200 || code >= 300) {
                    Log.w(TAG, "Token network-refresh failed: HTTP " + code);
                    // 회전 경쟁(WebView 가 동시에 refresh token 을 회전)으로 실패했을 수 있다.
                    // WebView 가 갱신 직후 updateToken 으로 prefs 에 새 토큰을 써뒀는지 재확인.
                    String afterAccess = prefs.getString("accessToken", null);
                    String afterRefresh = prefs.getString("refreshToken", null);
                    if (afterAccess != null && !afterAccess.isEmpty() && !afterAccess.equals(failedToken)) {
                        accessToken = afterAccess;
                        if (afterRefresh != null && !afterRefresh.isEmpty()) refreshToken = afterRefresh;
                        Log.i(TAG, "Adopted WebView-refreshed token from prefs after refresh race");
                        return afterAccess;
                    }
                    if (code == 401 || code == 403) {
                        stopForInvalidSession("refresh_http_" + code);
                    }
                    return null;
                }
                JSONObject session = new JSONObject(respStr).optJSONObject("session");
                if (session == null) return null;
                String newAccess = session.optString("access_token", "");
                String newRefresh = session.optString("refresh_token", "");
                if (newAccess.isEmpty()) return null;
                accessToken = newAccess;
                if (!newRefresh.isEmpty()) refreshToken = newRefresh;
                lastNetworkRefreshAtMs = System.currentTimeMillis();
                SharedPreferences.Editor ed = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
                    .putString("accessToken", newAccess);
                if (!newRefresh.isEmpty()) ed.putString("refreshToken", newRefresh);
                ed.apply();
                Log.i(TAG, "Access token network-refreshed via /auth/refresh");
                return newAccess;
            } catch (Exception e) {
                Log.w(TAG, "Token network-refresh error: " + e.getMessage());
                return null;
            }
        }
    }

    // ── Kalman Filter ───────────────────────────────────────────────────────────
    private double[] applyKalmanFilter(double lat, double lng, float accuracy) {
        // Convert accuracy (meters) to approximate degree variance
        double accuracyDeg = accuracy / 111_000.0;
        double measurementVariance = accuracyDeg * accuracyDeg;

        if (!kalmanInitialized) {
            kalmanLat = lat;
            kalmanLng = lng;
            kalmanLatVariance = measurementVariance;
            kalmanLngVariance = measurementVariance;
            kalmanInitialized = true;
            return new double[]{lat, lng};
        }

        // Prediction step: add process noise
        kalmanLatVariance += KALMAN_PROCESS_NOISE;
        kalmanLngVariance += KALMAN_PROCESS_NOISE;

        // Update step: compute Kalman gain
        double kLat = kalmanLatVariance / (kalmanLatVariance + measurementVariance);
        double kLng = kalmanLngVariance / (kalmanLngVariance + measurementVariance);

        // Update estimate
        kalmanLat = kalmanLat + kLat * (lat - kalmanLat);
        kalmanLng = kalmanLng + kLng * (lng - kalmanLng);

        // Update variance
        kalmanLatVariance = (1 - kLat) * kalmanLatVariance;
        kalmanLngVariance = (1 - kLng) * kalmanLngVariance;

        return new double[]{kalmanLat, kalmanLng};
    }

    // ── Adaptive Location Mode ──────────────────────────────────────────────────
    private void updateStationaryState(Location location) {
        long now = System.currentTimeMillis();

        if (stationaryReferenceLocation == null) {
            stationaryReferenceLocation = location;
            stationaryReferenceTime = now;
            return;
        }

        float distFromRef = location.distanceTo(stationaryReferenceLocation);

        if (distFromRef > STATIONARY_THRESHOLD_M) {
            // Moved significantly: reset reference and mark as moving
            stationaryReferenceLocation = location;
            stationaryReferenceTime = now;
            if (isStationary) {
                isStationary = false;
                Log.i(TAG, "Motion detected (moved " + String.format("%.1f", distFromRef)
                    + "m), switching to HIGH_ACCURACY mode");
                restartLocationWithMode(false);
            }
            return;
        }

        // Within threshold: check if we've been stationary long enough
        long elapsed = now - stationaryReferenceTime;
        if (elapsed >= STATIONARY_WINDOW_MS && !isStationary) {
            isStationary = true;
            Log.i(TAG, "Stationary detected (moved " + String.format("%.1f", distFromRef)
                + "m in " + (elapsed / 1000) + "s), keeping HIGH_ACCURACY tracking");
            restartLocationWithMode(true);
        }
    }

    private String normalizeLocationIntervalMode(@Nullable String mode) {
        if ("live".equals(mode) || "saver".equals(mode) || "balanced".equals(mode)) {
            return mode;
        }
        return "balanced";
    }

    private void applyLocationIntervalMode(@Nullable String rawMode, boolean restartIfRunning) {
        String mode = normalizeLocationIntervalMode(rawMode);
        long moving;
        long stationary;
        long stationaryMin;
        long maxUploadAge;
        long fixStale;
        long maxHistoryAge;
        switch (mode) {
            case "live":
                moving = 8_000L;
                stationary = 45_000L;
                stationaryMin = 20_000L;
                maxUploadAge = 30_000L;
                fixStale = 120_000L;
                maxHistoryAge = 45_000L;
                break;
            case "saver":
                moving = 60_000L;
                stationary = 180_000L;
                stationaryMin = 60_000L;
                maxUploadAge = 180_000L;
                fixStale = 300_000L;
                maxHistoryAge = 180_000L;
                break;
            case "balanced":
            default:
                moving = LOCATION_INTERVAL_MOVING_MS;
                stationary = LOCATION_INTERVAL_STATIONARY_MS;
                stationaryMin = LOCATION_MIN_INTERVAL_STATIONARY_MS;
                maxUploadAge = MAX_UPLOAD_AGE_MS;
                fixStale = LOCATION_FIX_STALE_MS;
                maxHistoryAge = MAX_HISTORY_AGE_MS;
                break;
        }

        boolean changed = !mode.equals(locationIntervalMode)
            || moving != activeMovingIntervalMs
            || stationary != activeStationaryIntervalMs
            || stationaryMin != activeStationaryMinIntervalMs;
        locationIntervalMode = mode;
        activeMovingIntervalMs = moving;
        activeStationaryIntervalMs = stationary;
        activeStationaryMinIntervalMs = stationaryMin;
        activeMaxUploadAgeMs = maxUploadAge;
        activeLocationFixStaleMs = fixStale;
        activeMaxHistoryAgeMs = maxHistoryAge;

        if (changed) {
            Log.i(TAG, "Location interval mode applied: " + mode
                + " (moving=" + (moving / 1000) + "s, stationary=" + (stationary / 1000) + "s)");
            if (restartIfRunning && locationCallback != null) {
                restartLocationWithMode(isStationary);
            }
        }
    }

    private void restartLocationWithMode(boolean lowPower) {
        if (locationCallback == null) return;

        fusedClient.removeLocationUpdates(locationCallback);

        // 측위 정확도(HIGH_ACCURACY)는 정지·이동 모두 유지해 실내/음영에서도 추적이
        // 끊기지 않게 한다. 다만 '움직임이 없을 때'는 촘촘한 측위를 멈추고 간격을 늘려
        // 데이터·배터리를 아낀다. 미세 이동/위치 변화가 있으면 FusedLocation 이
        // minInterval 까지 더 자주 보고하고, 출발(큰 움직임)은 armSignificantMotion()
        // 의 하드웨어 모션 트리거가 즉시 moving 으로
        // 되돌린다. 센서가 없는 기기는 다음 위치 샘플(STATIONARY_THRESHOLD_M 초과)로 폴백.
        int priority = Priority.PRIORITY_HIGH_ACCURACY;
        long interval = lowPower ? activeStationaryIntervalMs : activeMovingIntervalMs;
        long minInterval = lowPower
            ? activeStationaryMinIntervalMs
            : Math.max(1_000L, activeMovingIntervalMs / 2);

        LocationRequest request = new LocationRequest.Builder(priority, interval)
            .setMinUpdateIntervalMillis(minInterval)
            .setMinUpdateDistanceMeters(MIN_UPDATE_DISTANCE_M)
            .setWaitForAccurateLocation(false)
            .build();

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
            Log.i(TAG, "Location mode switched: mode=" + (lowPower ? "stationary-watch" : "moving")
                + ", priority=" + priority
                + ", interval=" + (interval / 1000) + "s"
                + ", minInterval=" + (minInterval / 1000) + "s");
            // 위치 업데이트 등록이 성공했을 때만 센서 상태를 바꾼다.
            // 정지 판정이면 출발 감지 센서를 보조로 무장, 이동 모드면 해제한다.
            if (lowPower) {
                armSignificantMotion();
            } else {
                cancelSignificantMotion();
            }
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission not granted on mode switch", e);
        }
    }

    // ── Significant-Motion Movement Detection ───────────────────────────────────
    // 정지+잠금 상태에서는 위치 콜백이 Doze 로 배칭되어, 위치 샘플만으로는
    // 아이의 출발을 한참 뒤에야 감지한다. TYPE_SIGNIFICANT_MOTION 은 Doze
    // 중에도 동작하는 저전력 하드웨어 트리거 센서 — 아이가 움직이는 순간
    // 깨워서 즉시 HIGH_ACCURACY 추적으로 전환, 경로의 직선 구간을 없앤다.
    private void initSignificantMotionSensor() {
        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager == null) {
            Log.w(TAG, "SensorManager unavailable — significant-motion detection disabled");
            return;
        }
        significantMotionSensor = sensorManager.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION);
        if (significantMotionSensor == null) {
            Log.w(TAG, "No significant-motion sensor — location-sample detection only");
            return;
        }
        significantMotionListener = new TriggerEventListener() {
            @Override
            public void onTrigger(TriggerEvent event) {
                // 트리거 센서는 1회성 — 발화 후 스스로 비활성화된다.
                significantMotionArmed = false;
                Log.i(TAG, "Significant motion detected — ramping up location tracking");
                onMovementStartDetected();
            }
        };
    }

    // 정지 모드 진입 시 호출 — 출발을 감지하도록 센서를 무장한다.
    private void armSignificantMotion() {
        if (sensorManager == null || significantMotionSensor == null
                || significantMotionListener == null || significantMotionArmed) {
            return;
        }
        significantMotionArmed =
            sensorManager.requestTriggerSensor(significantMotionListener, significantMotionSensor);
        Log.i(TAG, significantMotionArmed
            ? "Significant-motion sensor armed"
            : "Significant-motion sensor arm failed");
    }

    // 이동 모드 진입 / 서비스 종료 시 호출 — 센서 무장을 해제한다.
    private void cancelSignificantMotion() {
        if (sensorManager == null || significantMotionSensor == null
                || significantMotionListener == null || !significantMotionArmed) {
            return;
        }
        boolean cancelled =
            sensorManager.cancelTriggerSensor(significantMotionListener, significantMotionSensor);
        if (!cancelled) {
            Log.w(TAG, "cancelTriggerSensor returned false — sensor may still be active");
        }
        significantMotionArmed = false;
    }

    // 모션 감지 콜백 — 정지 모드였다면 즉시 HIGH_ACCURACY 로 올리고
    // 즉시 한 점을 확보해, 출발 순간부터 경로가 촘촘히 기록되게 한다.
    private void onMovementStartDetected() {
        if (isStationary) {
            isStationary = false;
            stationaryReferenceLocation = null;
            stationaryReferenceTime = 0;
            // restartLocationWithMode(false) 가 cancelSignificantMotion() 도 호출하나,
            // onTrigger 에서 이미 disarm 됐으므로 여기서는 no-op 이다.
            restartLocationWithMode(false);
        }
        // 모션이 감지된 이상 — 정지 판정 여부와 무관하게 — 한 점을 즉시 확보해
        // 경로 공백을 막는다. 라우트 완전성이 GPS wake-up 1회보다 우선.
        requestImmediateLocationFix();
    }

    // ── Activity Recognition (차량 이동 감지) ────────────────────────────────────
    // TYPE_SIGNIFICANT_MOTION 은 보행 감지용이라 거치된 폰의 정속 차량 출발을
    // 자주 놓친다(정지모드 → Doze 배칭 → 드라이브 내내 트레일 공백). Activity
    // Recognition 전환(IN_VEHICLE/WALKING 등 ENTER)을 추가로 구독해, 차량·도보
    // 이동이 감지되면 significant-motion 과 무관하게 HIGH_ACCURACY 추적을 깨운다.
    private static final String ACTION_ACTIVITY_TRANSITION = "com.hyeni.calendar.ACTIVITY_TRANSITION";
    private PendingIntent activityTransitionPendingIntent;
    private BroadcastReceiver activityTransitionReceiver;
    private boolean activityTransitionRegistered = false;

    private void setupActivityTransitionTracking() {
        if (activityTransitionRegistered) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                && ContextCompat.checkSelfPermission(this, Manifest.permission.ACTIVITY_RECOGNITION)
                    != PackageManager.PERMISSION_GRANTED) {
            Log.i(TAG, "ACTIVITY_RECOGNITION not granted — vehicle wake disabled (significant-motion only)");
            return;
        }
        try {
            List<ActivityTransition> transitions = new ArrayList<>();
            int[] movingActivities = {
                DetectedActivity.IN_VEHICLE,
                DetectedActivity.ON_BICYCLE,
                DetectedActivity.WALKING,
                DetectedActivity.RUNNING,
                DetectedActivity.ON_FOOT,
            };
            for (int activity : movingActivities) {
                transitions.add(new ActivityTransition.Builder()
                    .setActivityType(activity)
                    .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
                    .build());
            }
            ActivityTransitionRequest request = new ActivityTransitionRequest(transitions);

            Intent intent = new Intent(ACTION_ACTIVITY_TRANSITION).setPackage(getPackageName());
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
            activityTransitionPendingIntent = PendingIntent.getBroadcast(this, 4101, intent, piFlags);

            activityTransitionReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent received) {
                    if (received == null || !ActivityTransitionResult.hasResult(received)) return;
                    ActivityTransitionResult result = ActivityTransitionResult.extractResult(received);
                    if (result == null) return;
                    for (ActivityTransitionEvent event : result.getTransitionEvents()) {
                        if (event.getTransitionType() == ActivityTransition.ACTIVITY_TRANSITION_ENTER) {
                            Log.i(TAG, "Activity transition ENTER type=" + event.getActivityType()
                                + " — waking HIGH_ACCURACY tracking");
                            onMovementStartDetected();
                            break;
                        }
                    }
                }
            };
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(activityTransitionReceiver,
                    new IntentFilter(ACTION_ACTIVITY_TRANSITION), Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(activityTransitionReceiver, new IntentFilter(ACTION_ACTIVITY_TRANSITION));
            }

            ActivityRecognition.getClient(this)
                .requestActivityTransitionUpdates(request, activityTransitionPendingIntent)
                .addOnSuccessListener(ignored -> Log.i(TAG, "Activity transition updates registered"))
                .addOnFailureListener(error -> Log.w(TAG, "Activity transition register failed", error));
            activityTransitionRegistered = true;
        } catch (Exception error) {
            Log.w(TAG, "setupActivityTransitionTracking failed", error);
        }
    }

    private void teardownActivityTransitionTracking() {
        if (!activityTransitionRegistered) return;
        try {
            if (activityTransitionPendingIntent != null) {
                ActivityRecognition.getClient(this)
                    .removeActivityTransitionUpdates(activityTransitionPendingIntent);
            }
        } catch (Exception ignored) {
            // ignore unregister errors
        }
        try {
            if (activityTransitionReceiver != null) unregisterReceiver(activityTransitionReceiver);
        } catch (Exception ignored) {
            // receiver may not be registered
        }
        activityTransitionReceiver = null;
        activityTransitionRegistered = false;
    }

    // ── Distance Calculation ────────────────────────────────────────────────────
    private float distanceBetween(double lat1, double lng1, double lat2, double lng2) {
        float[] results = new float[1];
        Location.distanceBetween(lat1, lng1, lat2, lng2, results);
        return results[0];
    }

    // ── Location Tracking ───────────────────────────────────────────────────────
    private void startLocationTracking() {
        if (locationCallback != null) return;

        LocationRequest request = new LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY, activeMovingIntervalMs)
            .setMinUpdateIntervalMillis(Math.max(1_000L, activeMovingIntervalMs / 2))
            .setMinUpdateDistanceMeters(MIN_UPDATE_DISTANCE_M)
            .setWaitForAccurateLocation(false)
            .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                if (result == null || result.getLastLocation() == null) return;
                handleLocation(result.getLastLocation(), false);
            }
        };

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
            requestImmediateLocationFix();
            // Phase 3 (arm 갭 수정): 추적 시작 직후에도 무장한다. 기존엔 정지 판정
            // (30m 내 180초 연속 fix 누적) 후 restartLocationWithMode(true) 에서만
            // 무장돼, fix 가 끊긴 채/정지 판정 전 Doze 에 진입하면 센서가 영영 무장되지
            // 않아 출발 감지가 activity-recognition 하나만 남았다. armSignificantMotion 은
            // idempotent(significantMotionArmed 면 no-op)라 중복 호출 안전.
            armSignificantMotion();
            Log.i(TAG, "Location tracking started (HIGH_ACCURACY, "
                + (activeMovingIntervalMs / 1000) + "s interval, mode=" + locationIntervalMode + ", "
                + (int) MIN_UPDATE_DISTANCE_M + "m min distance)");
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission not granted", e);
        }
    }

    private void startLocationFixWatchdog() {
        if (locationFixWatchdogRunnable != null) return;

        locationFixWatchdogRunnable = new Runnable() {
            @Override
            public void run() {
                long now = System.currentTimeMillis();
                long ageMs = lastLocationAcceptedAtMs > 0L
                    ? now - lastLocationAcceptedAtMs
                    : Long.MAX_VALUE;
                if (ageMs >= activeLocationFixStaleMs) {
                    Log.w(TAG, "Location fix watchdog requesting immediate fix; lastAcceptedAge="
                        + (ageMs == Long.MAX_VALUE ? "never" : (ageMs / 1000) + "s"));
                    requestImmediateLocationFix();
                }
                handler.postDelayed(this, LOCATION_FIX_WATCHDOG_INTERVAL_MS);
            }
        };
        handler.postDelayed(locationFixWatchdogRunnable, LOCATION_FIX_WATCHDOG_INTERVAL_MS);
        Log.i(TAG, "Location fix watchdog started");
    }

    private void requestImmediateLocationFix() {
        try {
            acquireFixWakeLock();
            final CancellationTokenSource cts = new CancellationTokenSource();
            // NTV-H8: GPS(High Accuracy)가 12초 내에 안 잡히면 Balanced(WiFi/Cell)로 선회하여
            // 실내에서도 응답을 보장함. 부모의 즉시 새로고침 응답성을 유지하기 위함.
            final Runnable timeoutTask = () -> {
                if (!cts.getToken().isCancellationRequested()) {
                    Log.w(TAG, "High-accuracy fix timed out (12s), falling back to balanced power");
                    cts.cancel();
                    requestBalancedLocationFix();
                }
            };
            handler.postDelayed(timeoutTask, 12000);

            fusedClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.getToken())
                .addOnSuccessListener(location -> {
                    handler.removeCallbacks(timeoutTask);
                    if (location != null) {
                        handleLocation(location, true);
                    } else if (!cts.getToken().isCancellationRequested()) {
                        requestBalancedLocationFix();
                    }
                })
                .addOnFailureListener(error -> {
                    handler.removeCallbacks(timeoutTask);
                    if (!cts.getToken().isCancellationRequested()) {
                        Log.w(TAG, "Immediate high-accuracy request failed", error);
                        requestBalancedLocationFix();
                    }
                });
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission not granted for immediate fix", e);
        }
    }

    private void requestBalancedLocationFix() {
        try {
            acquireFixWakeLock();
            CancellationTokenSource cts = new CancellationTokenSource();
            fusedClient.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, cts.getToken())
                .addOnSuccessListener(location -> {
                    if (location != null) {
                        handleLocation(location, true);
                    } else {
                        requestLastKnownLocationUpload("balanced_location_null");
                    }
                })
                .addOnFailureListener(error -> {
                    Log.w(TAG, "Balanced location request failed", error);
                    requestLastKnownLocationUpload("balanced_location_failed");
                });
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission not granted for balanced fix", e);
        }
    }

    // ── Offline Location Buffer Flush ───────────────────────────────────────────
    // 버퍼된 오프라인 이동경로 점을 서버로 흘려보낸다. 네트워크 복구 / 부모
    // 위치 새로고침 / 서비스 시작 시 호출된다. 2xx 성공분만 버퍼에서 제거한다.
    private void flushLocationBuffer() {
        if (locationBufferFile == null) return;
        if (!flushInFlight.compareAndSet(false, true)) return; // 이미 진행 중
        runOnNetworkThread("buffer_flush", () -> {
            try {
                LocationBuffer.prune(locationBufferFile, LOCATION_BUFFER_MAX_AGE_MS);
                LocationBuffer.trimToMaxLines(locationBufferFile, LOCATION_BUFFER_MAX_LINES);
                List<LocationBuffer.BufferedPoint> points = LocationBuffer.readAll(locationBufferFile);
                if (points.isEmpty()) return;
                if (isBlank(userId) || isBlank(familyId) || isBlank(supabaseUrl)) return;

                refreshAccessToken();
                String bearer = (accessToken != null && !accessToken.isEmpty())
                    ? accessToken : supabaseKey;

                // 과대 배치 1요청은 서버 RPC 타임아웃 → 상한으로 분할 전송.
                // 성공한 chunk 만큼만 버퍼 앞에서 제거하고, 실패 시 다음 flush 에서 이어서 재시도.
                int total = points.size();
                int flushed = 0;
                while (flushed < total) {
                    int end = Math.min(flushed + LOCATION_FLUSH_BATCH_LIMIT, total);
                    JSONArray rows = new JSONArray();
                    for (int i = flushed; i < end; i++) {
                        LocationBuffer.BufferedPoint point = points.get(i);
                        JSONObject row = new JSONObject();
                        row.put("user_id", userId);
                        row.put("family_id", familyId);
                        row.put("lat", point.lat);
                        row.put("lng", point.lng);
                        row.put("recorded_at", formatIsoUtc(point.recordedAtMs));
                        rows.put(row);
                    }
                    if (!uploadLocationHistoryRows(rows, bearer)) {
                        // 만료(401)로 실패했을 수 있으니 1회 네트워크 갱신 후 재시도.
                        String renewed = networkRefreshAccessToken();
                        if (renewed == null || renewed.isEmpty()
                            || !uploadLocationHistoryRows(rows, renewed)) break;
                        bearer = renewed;
                    }
                    flushed = end;
                }

                if (flushed > 0) {
                    LocationBuffer.removeFirst(locationBufferFile, flushed);
                }
                if (flushed >= total) {
                    Log.i(TAG, "Flushed " + flushed + " buffered location points");
                } else {
                    Log.w(TAG, "Location buffer flush partial — sent " + flushed + "/" + total
                        + ", keeping " + (total - flushed) + " points for retry");
                }
            } catch (Exception error) {
                Log.w(TAG, "Location buffer flush error", error);
            } finally {
                flushInFlight.set(false);
            }
        });
    }

    private void registerNetworkCallback() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                Log.i(TAG, "Network available — flushing buffered location points");
                flushLocationBuffer();
            }
        };
        try {
            cm.registerDefaultNetworkCallback(networkCallback);
        } catch (Exception error) {
            Log.w(TAG, "registerDefaultNetworkCallback failed", error);
            networkCallback = null;
        }
    }

    private void unregisterNetworkCallback() {
        if (networkCallback == null) return;
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            try {
                cm.unregisterNetworkCallback(networkCallback);
            } catch (Exception error) {
                Log.w(TAG, "unregisterNetworkCallback failed", error);
            }
        }
        networkCallback = null;
    }

    private void requestLastKnownLocationUpload(String reason) {
        try {
            acquireFixWakeLock();
            fusedClient.getLastLocation()
                .addOnSuccessListener(location -> {
                    if (location == null) {
                        Log.w(TAG, "Last known location unavailable after " + reason);
                        return;
                    }
                    Log.i(TAG, "Uploading last known location after " + reason);
                    handleLocation(location, true);
                })
                .addOnFailureListener(error -> Log.w(TAG, "Last known location request failed", error));
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission not granted for last known location", e);
        }
    }

    private void handleLocation(Location location, boolean forceUpload) {
        if (location == null) return;

        float accuracy = location.getAccuracy();
        // NTV-H8: manual refresh (forceUpload=true) 는 아이가 실내에 있어 GPS 가 부정확해도
        // "가장 최근의 최선(best-effort)" 위치를 부모에게 보여줘야 함.
        // 기존 50m 는 실외 전용 수준이라, 200m 로 완화하되 forceUpload 시에는 필터를 아예 건너뛴다.
        if (accuracy > MAX_ACCURACY_M && !forceUpload) {
            Log.w(TAG, "Location rejected: accuracy " + String.format("%.0f", accuracy)
                + "m exceeds " + (int) MAX_ACCURACY_M + "m threshold");
            return;
        }
        if (accuracy > 200f && forceUpload) {
            Log.w(TAG, "Location accuracy is poor (" + String.format("%.0f", accuracy)
                + "m) but forcing upload per parent request");
        }

        double rawLat = location.getLatitude();
        double rawLng = location.getLongitude();

        double[] filtered = applyKalmanFilter(rawLat, rawLng, accuracy);
        double lat = filtered[0];
        double lng = filtered[1];

        updateStationaryState(location);

        long now = System.currentTimeMillis();
        lastLocationAcceptedAtMs = now;
        if (!forceUpload && !Double.isNaN(lastUploadedLat)) {
            float distFromLast = distanceBetween(lat, lng, lastUploadedLat, lastUploadedLng);
            long ageMs = now - lastUploadedAtMs;
            if (distFromLast < MIN_UPLOAD_DISTANCE_M && ageMs < activeMaxUploadAgeMs) {
                Log.d(TAG, "Skipping upload: moved "
                    + String.format("%.1f", distFromLast) + "m, age="
                    + (ageMs / 1000) + "s");
                return;
            }
        }

        Log.d(TAG, "Location update: accuracy=" + String.format("%.0f", accuracy)
            + "m, stationary=" + isStationary + ", force=" + forceUpload);
        uploadLocation(lat, lng, accuracy, now);
    }

    private void uploadLocation(double lat, double lng, float accuracy, long capturedAtMs) {
        runOnNetworkThread("upload", () -> {
            try {
                JSONObject body = new JSONObject();
                body.put("p_user_id", userId);
                body.put("p_family_id", familyId);
                body.put("p_lat", lat);
                body.put("p_lng", lng);

                String url = supabaseUrl + "/rest/v1/rpc/upsert_child_location";
                String bodyStr = body.toString();
                MediaType jsonType = MediaType.get("application/json");
                String bearer = (accessToken != null && !accessToken.isEmpty()) ? accessToken : supabaseKey;
                boolean uploaded = false;
                String successfulBearer = null;

                // 1차 시도: 현재 토큰
                Response response = httpClient.newCall(new Request.Builder()
                    .url(url).header("apikey", supabaseKey).header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + bearer)
                    .post(RequestBody.create(bodyStr, jsonType)).build()).execute();
                int code = response.code();
                uploaded = code >= 200 && code < 300;
                if (uploaded) successfulBearer = bearer;
                response.close();

                if (code == 401 || code == 403) {
                    // 2차 시도: SharedPreferences에서 최신 토큰 재로드
                    refreshAccessToken();
                    String freshToken = (accessToken != null && !accessToken.isEmpty()) ? accessToken : supabaseKey;
                    Log.w(TAG, "Location upload auth failed (" + code + "), retrying with refreshed token");
                    Response retry1 = httpClient.newCall(new Request.Builder()
                        .url(url).header("apikey", supabaseKey).header("Content-Type", "application/json")
                        .header("Authorization", "Bearer " + freshToken)
                        .post(RequestBody.create(bodyStr, jsonType)).build()).execute();
                    int code2 = retry1.code();
                    uploaded = code2 >= 200 && code2 < 300;
                    if (uploaded) successfulBearer = freshToken;
                    retry1.close();

                    if (code2 == 401 || code2 == 403) {
                        // 3차 시도: refresh token 으로 access token 을 네트워크 갱신 후 재시도.
                        // (D1 컷오버 후 백그라운드 1h 만료의 핵심 복구 경로. anon key 폴백은
                        //  Worker rest-shim 이 ES256 access 만 받으므로 무효 → 제거.)
                        String renewed = networkRefreshAccessToken();
                        if (renewed != null && !renewed.isEmpty()) {
                            Log.w(TAG, "Retry failed (" + code2 + "), retrying with network-refreshed token");
                            Response retry2 = httpClient.newCall(new Request.Builder()
                                .url(url).header("apikey", supabaseKey).header("Content-Type", "application/json")
                                .header("Authorization", "Bearer " + renewed)
                                .post(RequestBody.create(bodyStr, jsonType)).build()).execute();
                            uploaded = retry2.isSuccessful();
                            if (uploaded) {
                                successfulBearer = renewed;
                                Log.i(TAG, "Location uploaded after token refresh");
                            } else {
                                Log.e(TAG, "Location upload ALL retries failed: " + retry2.code());
                            }
                            retry2.close();
                        } else {
                            Log.e(TAG, "Location upload failed: token refresh unavailable (" + code2 + ")");
                        }
                    } else if (uploaded) {
                        Log.i(TAG, "Location uploaded with refreshed token");
                    }
                } else if (uploaded) {
                    // 성공
                } else {
                    Log.w(TAG, "Location upload failed: " + code);
                }
                if (uploaded) {
                    lastUploadedLat = lat;
                    lastUploadedLng = lng;
                    lastUploadedAtMs = capturedAtMs;
                    // Phase 0-A: ShutdownReceiver 가 ACTION_SHUTDOWN 시 마지막 좌표를 읽어
                    // is_final_before_shutdown=true 로 부모에게 푸시하기 위해 영속화.
                    try {
                        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
                            .putString("last_uploaded_lat", String.valueOf(lat))
                            .putString("last_uploaded_lng", String.valueOf(lng))
                            .putLong("last_uploaded_at_ms", capturedAtMs)
                            .apply();
                    } catch (Exception persistErr) {
                        Log.w(TAG, "last-location prefs persist failed", persistErr);
                    }
                    broadcastLocation(lat, lng, accuracy, capturedAtMs);
                }

                // 이동경로 점 — 서버 성공 전 로컬 큐에 먼저 적재한다.
                // 온라인 업로드 성공 후에만 방금 적재한 동일 점을 제거하므로, 앱 종료/
                // 네트워크 전환/프로세스 킬 타이밍에도 원본 GPS 점이 기기에 남는다.
                if (shouldRecordLocationHistory(lat, lng, capturedAtMs)) {
                    int pendingBefore = LocationBuffer.size(locationBufferFile);
                    boolean queued = LocationBuffer.append(locationBufferFile, lat, lng, accuracy, capturedAtMs);
                    boolean historyRecorded = uploaded
                        && !isBlank(successfulBearer)
                        && uploadLocationHistory(lat, lng, capturedAtMs, successfulBearer);
                    if (!historyRecorded) {
                        Log.d(TAG, "Location history kept in durable local queue for later flush");
                        flushLocationBuffer();
                    } else if (queued && pendingBefore == 0) {
                        LocationBuffer.removeMatching(locationBufferFile, lat, lng, capturedAtMs);
                    } else if (queued) {
                        flushLocationBuffer();
                    }
                    // 온라인/오프라인 어느 경로든 기준점을 갱신 — 오프라인 중에도
                    // 2m/전원정책 간격 밀도가 유지되어 경로 누락을 최소화한다.
                    lastHistoryLat = lat;
                    lastHistoryLng = lng;
                    lastHistoryAtMs = capturedAtMs;
                }
            } catch (Exception e) {
                Log.e(TAG, "Location upload error", e);
            }
        });
    }

    private String formatIsoUtc(long timeMs) {
        java.text.SimpleDateFormat iso = new java.text.SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        return iso.format(new java.util.Date(timeMs));
    }

    private boolean shouldRecordLocationHistory(double lat, double lng, long capturedAtMs) {
        if (Double.isNaN(lastHistoryLat)) return true;
        float distFromLastHistory = distanceBetween(lat, lng, lastHistoryLat, lastHistoryLng);
        long ageMs = capturedAtMs - lastHistoryAtMs;
        return distFromLastHistory >= MIN_HISTORY_DISTANCE_M || ageMs >= activeMaxHistoryAgeMs;
    }

    private boolean uploadLocationHistory(double lat, double lng, long capturedAtMs, String bearerToken) {
        if (isBlank(userId) || isBlank(familyId) || isBlank(supabaseUrl) || isBlank(supabaseKey) || isBlank(bearerToken)) {
            return false;
        }
        try {
            JSONArray body = buildLocationHistoryRows(lat, lng, capturedAtMs);
            return uploadLocationHistoryRows(body, bearerToken);
        } catch (Exception e) {
            Log.w(TAG, "Location history insert error", e);
            return false;
        }
    }

    private JSONArray buildLocationHistoryRows(double lat, double lng, long capturedAtMs) throws Exception {
        List<RoutePoint> points = new ArrayList<>();
        boolean hasPrevious = !Double.isNaN(lastHistoryLat) && !Double.isNaN(lastHistoryLng) && lastHistoryAtMs > 0L;
        // estimatedFill: 큰 갭을 직선으로 메운 '추정 채움점'에만 true. 실측 GPS 점(마지막)은 항상 실측.
        boolean estimatedFill = false;
        // 도로매칭(Kakao kakao-proxy) 네트워크 호출은 갭이 큰(>150m) 구간에서만 의미가 있다.
        // 현재 도보 도로매칭은 affiliate 권한(403)으로 실패 중이라 매칭 결과가 비어, 조밀 구간
        // (<=150m)은 아래 else 가 조밀 raw GPS 직선으로 기록한다 → 갭 게이트 적용 시 <=150m 에서
        // 무손실(어차피 매칭 결과가 없음). fix 마다 반복되던 Kakao 라운드트립(라디오 깨움)만 제거.
        // ⚠ 도로매칭이 복구되면 이 게이트가 <=150m 곡선을 직선화하므로 재검토 필요(>150m 는 영향 없음).
        if (hasPrevious
                && distanceBetween(lastHistoryLat, lastHistoryLng, lat, lng) > ESTIMATED_FILL_MIN_GAP_M) {
            points.addAll(fetchWalkingRoutePoints(lastHistoryLat, lastHistoryLng, lat, lng));
        }

        if (points.size() >= 2 && hasPrevious) {
            // 실제 도로 경로(Kakao) — 실측 취급.
            List<RoutePoint> filtered = new ArrayList<>();
            for (RoutePoint point : points) {
                if (distanceBetween(lastHistoryLat, lastHistoryLng, point.lat, point.lng) >= 8f) {
                    filtered.add(point);
                }
            }
            points = filtered;
        } else if (hasPrevious && distanceBetween(lastHistoryLat, lastHistoryLng, lat, lng) > ESTIMATED_FILL_MIN_GAP_M) {
            // 도로매칭 실패 + 큰 갭(>150m): 두 점 사이를 직선 보간으로 메우되 그 '채움점'들만
            // 추정으로 표기(frontend dashed). 실측 endpoint 는 아래에서 추가되어 실측으로 남는다.
            points.clear();
            points.addAll(interpolateLinearPath(lastHistoryLat, lastHistoryLng, lat, lng, 12f));
            estimatedFill = true;
        } else {
            // 도로매칭 실패 + 조밀 캡처(<=150m): 직전→실측 직선이 충분히 정확하므로 보간 없이
            // 실측 endpoint 만 기록한다 → 실선(estimated 아님). 무효 KAKAO 키로 매칭이 죽어도
            // 조밀한 raw GPS 만으로 정확한 경로가 그려진다.
            points.clear();
        }

        if (points.isEmpty() || distanceBetween(points.get(points.size() - 1).lat, points.get(points.size() - 1).lng, lat, lng) >= 8f) {
            points.add(new RoutePoint(lat, lng));
        }

        JSONArray rows = new JSONArray();
        int lastIndex = points.size() - 1;
        for (int i = 0; i < points.size(); i++) {
            RoutePoint point = points.get(i);
            JSONObject row = new JSONObject();
            row.put("user_id", userId);
            row.put("family_id", familyId);
            row.put("lat", point.lat);
            row.put("lng", point.lng);
            row.put("recorded_at", interpolateRecordedAt(lastHistoryAtMs, capturedAtMs, i, points.size()));
            // 마지막 점은 실측 GPS fix → 항상 실측. 큰 갭을 메운 합성 채움점만 추정.
            if (estimatedFill && i < lastIndex) {
                row.put("is_estimated", true);
            }
            rows.put(row);
        }
        return rows;
    }

    private boolean uploadLocationHistoryRows(JSONArray rows, String bearerToken) {
        if (rows == null || rows.length() == 0) return false;
        try {
            // Phase C: 직접 INSERT 대신 SECURITY DEFINER RPC 사용. 이유 — anon-key 폴백
            // 경로에서 location_history 의 RLS (user_id = auth.uid()) 가 거부하던 문제.
            // RPC 가 family_members 멤버십으로 authz 후 우회 insert.
            JSONObject body = new JSONObject();
            body.put("p_rows", rows);

            Response response = httpClient.newCall(new Request.Builder()
                .url(supabaseUrl.replaceAll("/+$", "") + "/rest/v1/rpc/record_location_history_rows")
                .header("apikey", supabaseKey)
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + bearerToken)
                .post(RequestBody.create(body.toString(), MediaType.get("application/json")))
                .build()).execute();
            boolean success = response.isSuccessful();
            if (!success) {
                Log.w(TAG, "Location history RPC failed: " + response.code());
            }
            response.close();
            return success;
        } catch (Exception e) {
            Log.w(TAG, "Location history RPC error", e);
            return false;
        }
    }

    private String interpolateRecordedAt(long startMs, long endMs, int index, int total) {
        if (startMs <= 0L || endMs <= startMs || total <= 1) {
            return formatIsoUtc(endMs);
        }
        double ratio = (double) (index + 1) / (double) total;
        long value = startMs + Math.round((endMs - startMs) * ratio);
        return formatIsoUtc(value);
    }

    // Phase C: Kakao 도보 API 실패/빈 응답 시의 폴백 보간 점 생성기.
    // start - end 사이를 minSpacingM 간격으로 균등 분할. 결과는 endpoint 포함.
    // 너무 짧은 거리는 그냥 [start, end] 만 반환.
    private List<RoutePoint> interpolateLinearPath(double startLat, double startLng,
                                                    double endLat, double endLng,
                                                    float minSpacingM) {
        List<RoutePoint> result = new ArrayList<>();
        float total = distanceBetween(startLat, startLng, endLat, endLng);
        if (total < minSpacingM * 1.5f) {
            result.add(new RoutePoint(startLat, startLng));
            result.add(new RoutePoint(endLat, endLng));
            return result;
        }
        int steps = Math.max(2, Math.min(40, (int) Math.ceil(total / minSpacingM)));
        for (int i = 0; i <= steps; i++) {
            double t = (double) i / steps;
            double lat = startLat + (endLat - startLat) * t;
            double lng = startLng + (endLng - startLng) * t;
            result.add(new RoutePoint(lat, lng));
        }
        return result;
    }

    private List<RoutePoint> fetchWalkingRoutePoints(double startLat, double startLng, double endLat, double endLng) {
        List<RoutePoint> points = new ArrayList<>();
        // Walking-route lookups go through the kakao-proxy Edge Function.
        // Needs a valid user JWT (accessToken). If none is available the
        // upstream returns 401 and we fall back to an empty trail — same
        // behaviour as the previous "blank key" early return.
        if (isBlank(supabaseUrl) || isBlank(supabaseKey) || isBlank(accessToken)) return points;
        try {
            String endpoint = supabaseUrl.replaceAll("/+$", "")
                + "/functions/v1/kakao-proxy/walking-directions";
            JSONObject body = new JSONObject()
                .put("origin", new JSONObject().put("lat", startLat).put("lng", startLng))
                .put("destination", new JSONObject().put("lat", endLat).put("lng", endLng));
            Response response = httpClient.newCall(new Request.Builder()
                .url(endpoint)
                .header("apikey", supabaseKey)
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + accessToken)
                .post(RequestBody.create(body.toString(), MediaType.get("application/json")))
                .build()).execute();
            if (!response.isSuccessful()) {
                Log.w(TAG, "Walking route request failed: " + response.code());
                response.close();
                return points;
            }
            String responseBody = response.body() != null ? response.body().string() : "";
            response.close();
            JSONObject data = new JSONObject(responseBody);
            JSONObject route = data.optJSONArray("routes") != null ? data.optJSONArray("routes").optJSONObject(0) : null;
            if (route == null || route.optInt("result_code", -1) != 0) return points;
            JSONArray sections = route.optJSONArray("sections");
            if (sections == null) return points;
            for (int s = 0; s < sections.length(); s++) {
                JSONObject section = sections.optJSONObject(s);
                JSONArray roads = section != null ? section.optJSONArray("roads") : null;
                if (roads == null) continue;
                for (int r = 0; r < roads.length(); r++) {
                    JSONObject road = roads.optJSONObject(r);
                    JSONArray vertexes = road != null ? road.optJSONArray("vertexes") : null;
                    if (vertexes == null) continue;
                    for (int i = 0; i + 1 < vertexes.length(); i += 2) {
                        double lng = vertexes.optDouble(i, Double.NaN);
                        double lat = vertexes.optDouble(i + 1, Double.NaN);
                        if (!Double.isNaN(lat) && !Double.isNaN(lng)) {
                            RoutePoint previous = points.isEmpty() ? null : points.get(points.size() - 1);
                            if (previous == null || distanceBetween(previous.lat, previous.lng, lat, lng) >= 1f) {
                                points.add(new RoutePoint(lat, lng));
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Walking route parse failed", e);
            points.clear();
        }
        return points;
    }

    private void broadcastLocation(double lat, double lng, float accuracy, long capturedAtMs) {
        try {
            String updatedAt = formatIsoUtc(capturedAtMs);
            JSONObject payload = new JSONObject()
                .put("user_id", userId)
                .put("userId", userId)
                .put("family_id", familyId)
                .put("lat", lat)
                .put("lng", lng)
                .put("accuracy", accuracy)
                .put("updated_at", updatedAt)
                .put("updatedAt", updatedAt)
                .put("source", "native-location");

            JSONObject message = new JSONObject()
                .put("topic", "family-" + familyId)
                .put("event", "child_location")
                .put("payload", payload);

            JSONObject broadcastBody = new JSONObject()
                .put("messages", new JSONArray().put(message));

            String bearer = (accessToken != null && !accessToken.isEmpty()) ? accessToken : supabaseKey;
            boolean sent = postRealtimeBroadcast(broadcastBody, bearer);
            if (!sent && bearer != null && !bearer.equals(supabaseKey)) {
                postRealtimeBroadcast(broadcastBody, supabaseKey);
            }
        } catch (Exception e) {
            Log.e(TAG, "Location broadcast error", e);
        }
    }

    private boolean postRealtimeBroadcast(JSONObject body, String bearerToken) {
        try {
            String token = (bearerToken != null && !bearerToken.isEmpty()) ? bearerToken : supabaseKey;
            Request request = new Request.Builder()
                .url(supabaseUrl.replaceAll("/+$", "") + "/realtime/v1/api/broadcast")
                .header("apikey", supabaseKey)
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + token)
                .post(RequestBody.create(body.toString(), MediaType.get("application/json")))
                .build();

            Response response = httpClient.newCall(request).execute();
            boolean ok = response.isSuccessful();
            if (!ok) {
                Log.w(TAG, "Location broadcast failed: " + response.code());
            }
            response.close();
            return ok;
        } catch (Exception e) {
            Log.w(TAG, "Location broadcast request error", e);
            return false;
        }
    }

    // ── Notification Polling (instant alerts from parent) ───────────────────────
    private void startNotificationPolling() {
        if (notifPollRunnable != null) return;

        notifPollRunnable = new Runnable() {
            @Override
            public void run() {
                pollForNotifications();
                handler.postDelayed(this, NOTIF_POLL_INTERVAL_MS);
            }
        };
        handler.postDelayed(notifPollRunnable, 5000);
        Log.i(TAG, "Notification polling started");
    }

    private void pollForNotifications() {
        runOnNetworkThread("notif_poll", () -> {
            try {
                JSONObject body = new JSONObject();
                body.put("p_family_id", familyId);
                body.put("p_user_id", userId);
                body.put("p_role", getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString("role", ""));

                String bearer = (accessToken != null && !accessToken.isEmpty()) ? accessToken : supabaseKey;
                Response response = executePendingNotificationsRequest(body, bearer);
                int code = response.code();
                if (code == 401 || code == 403) {
                    response.close();
                    refreshAccessToken();
                    String freshBearer = (accessToken != null && !accessToken.isEmpty()) ? accessToken : supabaseKey;
                    Log.w(TAG, "Pending notification auth failed (" + code + "), retrying with refreshed token");
                    response = executePendingNotificationsRequest(body, freshBearer);
                    code = response.code();

                    if (code == 401 || code == 403) {
                        response.close();
                        // refresh token 으로 access 네트워크 갱신 후 재시도 (일정 알림 폴링도
                        // D1 1h 만료 백그라운드 복구. 실패하면 Supabase RPC anon-key fallback 으로
                        // 폴링 루프를 살려 다음 주기에서 다시 복구한다.
                        String renewed = networkRefreshAccessToken();
                        if (renewed == null || renewed.isEmpty()) {
                            Log.w(TAG, "Pending notification auth failed (" + code + "), retrying with apikey fallback");
                            response = executePendingNotificationsFallbackRequest(body);
                            if (!response.isSuccessful()) {
                                Log.w(TAG, "Pending notification poll fallback failed: " + response.code());
                                response.close();
                                return;
                            }
                        } else {
                            response = executePendingNotificationsRequest(body, renewed);
                            if (!response.isSuccessful()) {
                                Log.w(TAG, "Pending notification poll failed after refresh: " + response.code());
                                response.close();
                                Log.w(TAG, "Pending notification auth failed after refresh, retrying with apikey fallback");
                                response = executePendingNotificationsFallbackRequest(body);
                                if (!response.isSuccessful()) {
                                    Log.w(TAG, "Pending notification poll fallback failed: " + response.code());
                                    response.close();
                                    return;
                                }
                            }
                        }
                    }
                }
                if (!response.isSuccessful()) {
                    response.close();
                    return;
                }

                String respBody = response.body().string();
                response.close();

                JSONArray notifications = new JSONArray(respBody);
                if (notifications.length() == 0) return;

                Log.i(TAG, "Found " + notifications.length() + " pending notifications");

                JSONArray deliveredIds = new JSONArray();
                for (int i = 0; i < notifications.length(); i++) {
                    JSONObject notif = notifications.getJSONObject(i);
                    String id = notif.getString("id");

                    // 보낸 사람 필터링: 내가 보낸 알림은 표시하지 않음
                    JSONObject data = notif.optJSONObject("data");
                    String sender = (data != null) ? data.optString("senderUserId", "") : "";
                    if (sender.equals(userId)) {
                        Log.d(TAG, "Skipping self-sent notification: " + id);
                        continue;
                    }

                    String title = notif.optString("title", "혜니캘린더");
                    String notifBody = notif.optString("body", "");
                    String type = data != null ? data.optString("type", data.optString("action", "schedule")) : "schedule";
                    boolean emergency = isEmergencyNotification(type, data);
                    String stableId = data != null
                        ? data.optString("pushId", data.optString("idempotencyKey", id))
                        : id;
                    if (!isPendingTargetedToThisDevice(data)) {
                        Log.d(TAG, "Skipping pending notification for another device role: " + id);
                        continue;
                    }
                    if ("remote_listen".equals(type)) {
                        String requestId = readRemoteListenRequestId(data);
                        if (RemoteListenRequestStore.wasLauncherRecentlyShown(this, requestId)) {
                            Log.d(TAG, "Skipping duplicate remote listen pending fallback: " + requestId);
                            deliveredIds.put(id);
                            continue;
                        }
                        publishDeviceStatusFromPending(data);
                        if (!startAmbientListenFromPending(data)) {
                            showRemoteListenLauncher(data, stableId);
                        }
                        deliveredIds.put(id);
                        continue;
                    }
                    if ("remote_listen_stop".equals(type)) {
                        if (stopAmbientListenFromPending(data)) {
                            deliveredIds.put(id);
                        }
                        continue;
                    }
                    if ("request_location".equals(type)) {
                        if (shouldHandleLocationRefreshFromPending(data)) {
                            requestImmediateLocationFix();
                            publishDeviceStatusFromPending(data);
                            deliveredIds.put(id);
                        }
                        continue;
                    }
                    if ("request_device_status".equals(type)) {
                        if (publishDeviceStatusFromPending(data)) {
                            deliveredIds.put(id);
                        }
                        continue;
                    }
                    if (isLocallyAckedPolledNotification(stableId)) {
                        // Suppress repeat sound/banner while still retrying server delivery ack.
                        deliveredIds.put(id);
                        Log.d(TAG, "Locally acked pending notification suppressed: " + stableId);
                        continue;
                    }
                    // 서버가 비긴급 푸시에 notification 블록(tag=pushId)을 붙이므로, 앱이
                    // 백그라운드면 시스템이 이미 트레이에 같은 알림을 직접 표시했을 수 있다.
                    // getActiveNotifications() 에 동일 pushId 태그가 있으면 폴링이 중복으로
                    // 한 번 더 띄우지 않도록 ack 만 남기고 skip 한다(이중 알림 방지).
                    String pushTag = data != null ? data.optString("pushId", "") : "";
                    if (isSystemNotificationPresent(pushTag)) {
                        deliveredIds.put(id);
                        markLocalPolledNotificationAck(stableId);
                        PolledNotificationStore.markAck(this, stableId);
                        Log.d(TAG, "Pending notification already shown by system tray (tag=" + pushTag + "), skipping poll copy");
                        continue;
                    }
                    deliveredIds.put(id);  // 실제 수신한 알림만 delivered 처리
                    showPolledNotification(title, notifBody, type, emergency, stableId);
                    markLocalPolledNotificationAck(stableId);
                }

                if (deliveredIds.length() > 0) {
                    markDelivered(deliveredIds);
                }
            } catch (Exception e) {
                Log.e(TAG, "Notification poll error", e);
            }
        });
    }

    private Response executePendingNotificationsRequest(JSONObject body, String bearerToken) throws Exception {
        String url = supabaseUrl + "/rest/v1/rpc/get_pending_notifications_for_device";
        String token = !isBlank(bearerToken) ? bearerToken : supabaseKey;
        Request req = new Request.Builder()
            .url(url)
            .header("apikey", supabaseKey)
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + token)
            .post(RequestBody.create(body.toString(), MediaType.get("application/json")))
            .build();
        return httpClient.newCall(req).execute();
    }

    private Response executePendingNotificationsFallbackRequest(JSONObject body) throws Exception {
        String url = supabaseUrl + "/rest/v1/rpc/get_pending_notifications_for_device";
        Request req = new Request.Builder()
            .url(url)
            .header("apikey", supabaseKey)
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer " + supabaseKey)
            .post(RequestBody.create(body.toString(), MediaType.get("application/json")))
            .build();
        return httpClient.newCall(req).execute();
    }

    private boolean isPendingTargetedToThisDevice(@Nullable JSONObject data) {
        if (data == null) return true;
        String requestFamilyId = data.optString("familyId", "");
        if (!isBlank(requestFamilyId) && !isBlank(familyId) && !requestFamilyId.equals(familyId)) {
            Log.d(TAG, "Skipping pending notification for another family");
            return false;
        }

        String targetRole = data.optString("targetRole", "");
        if (!isBlank(targetRole)) {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String role = prefs.getString("role", "");
            if (!isBlank(role) && !targetRole.equalsIgnoreCase(role)) {
                return false;
            }
        }

        String targetUserId = data.optString("targetUserId", "");
        return isBlank(targetUserId) || targetUserId.equals(userId);
    }

    private boolean publishDeviceStatusFromPending(@Nullable JSONObject data) {
        if (data != null) {
            String pushFamilyId = data.optString("familyId", "");
            if (!isBlank(pushFamilyId) && !isBlank(familyId) && !pushFamilyId.equals(familyId)) {
                Log.w(TAG, "Device status pending skipped: family mismatch");
                return false;
            }
        }

        return DeviceStatusReporter.publish(
            this,
            httpClient,
            supabaseUrl,
            supabaseKey,
            familyId,
            userId,
            accessToken,
            data != null ? data.optString("requestId", null) : null,
            data != null ? data.optString("requesterUserId", null) : null
        );
    }

    private boolean startAmbientListenFromPending(@Nullable JSONObject data) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "Remote listen pending start skipped: RECORD_AUDIO permission missing");
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            Log.i(TAG, "Remote listen pending start skipped on Android 14+: microphone FGS requires foreground UI");
            return false;
        }

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String role = prefs.getString("role", "");
        if (!isBlank(role) && !"child".equalsIgnoreCase(role)) {
            Log.i(TAG, "Remote listen pending skipped: this device is not child mode");
            return false;
        }

        String requestFamilyId = data != null ? data.optString("familyId", "") : "";
        if (!isBlank(requestFamilyId) && !isBlank(familyId) && !requestFamilyId.equals(familyId)) {
            Log.w(TAG, "Remote listen pending start skipped: family mismatch");
            return false;
        }

        String resolvedFamilyId = firstNonBlank(requestFamilyId, familyId);
        if (isBlank(userId) || isBlank(resolvedFamilyId) || isBlank(supabaseUrl) || isBlank(supabaseKey)) {
            Log.w(TAG, "Remote listen pending start skipped: service context missing");
            return false;
        }

        Intent intent = new Intent(this, AmbientListenService.class);
        intent.setAction(AmbientListenService.ACTION_START);
        intent.putExtra(AmbientListenService.EXTRA_USER_ID, userId);
        intent.putExtra(AmbientListenService.EXTRA_FAMILY_ID, resolvedFamilyId);
        intent.putExtra(AmbientListenService.EXTRA_SUPABASE_URL, supabaseUrl);
        intent.putExtra(AmbientListenService.EXTRA_SUPABASE_KEY, supabaseKey);
        intent.putExtra(AmbientListenService.EXTRA_ACCESS_TOKEN, accessToken != null ? accessToken : "");
        intent.putExtra(AmbientListenService.EXTRA_DURATION_SEC, readRemoteListenDurationSec(data));

        String senderUserId = data != null ? data.optString("senderUserId", "") : "";
        if (!isBlank(senderUserId)) {
            intent.putExtra(AmbientListenService.EXTRA_INITIATOR_USER_ID, senderUserId);
        }
        String requestId = readRemoteListenRequestId(data);
        if (!isBlank(requestId)) {
            intent.putExtra(AmbientListenService.EXTRA_REQUEST_ID, requestId);
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent);
            } else {
                startService(intent);
            }
            Log.i(TAG, "Remote listen native foreground service started from pending notification");
            return true;
        } catch (Exception error) {
            Log.w(TAG, "Remote listen native service start failed from pending notification", error);
            return false;
        }
    }

    private boolean stopAmbientListenFromPending(@Nullable JSONObject data) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String role = prefs.getString("role", "");
        if (!isBlank(role) && !"child".equalsIgnoreCase(role)) {
            Log.i(TAG, "Remote listen pending stop skipped: this device is not child mode");
            return false;
        }

        String requestFamilyId = data != null ? data.optString("familyId", "") : "";
        if (!isBlank(requestFamilyId) && !isBlank(familyId) && !requestFamilyId.equals(familyId)) {
            Log.w(TAG, "Remote listen pending stop skipped: family mismatch");
            return false;
        }

        Intent intent = new Intent(this, AmbientListenService.class);
        intent.setAction(AmbientListenService.ACTION_STOP);
        boolean stopped = stopService(intent);
        Log.i(TAG, "Remote listen native stop requested from pending notification requestId="
            + readRemoteListenRequestId(data)
            + " stopped=" + stopped);
        return true;
    }

    private boolean shouldHandleLocationRefreshFromPending(@Nullable JSONObject data) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String role = prefs.getString("role", "");
        if (!isBlank(role) && !"child".equalsIgnoreCase(role)) {
            Log.i(TAG, "Location refresh pending skipped: this device is not child mode");
            return false;
        }

        String requestFamilyId = data != null ? data.optString("familyId", "") : "";
        if (!isBlank(requestFamilyId) && !isBlank(familyId) && !requestFamilyId.equals(familyId)) {
            Log.w(TAG, "Location refresh pending skipped: family mismatch");
            return false;
        }

        String targetUserId = data != null ? data.optString("targetUserId", data.optString("target_user_id", "")) : "";
        if (!isBlank(targetUserId) && !targetUserId.equals(userId)) {
            Log.i(TAG, "Location refresh pending skipped: target user mismatch");
            return false;
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "Location refresh pending skipped: ACCESS_FINE_LOCATION permission missing");
            return false;
        }

        return !isBlank(userId) && !isBlank(familyId) && !isBlank(supabaseUrl) && !isBlank(supabaseKey);
    }

    private void showRemoteListenLauncher(@Nullable JSONObject data, String stableId) {
        ensureRemoteListenChannel();

        int notificationId = NotificationHelper.stableRequestCode("remote_listen:" + stableId);
        Intent launchIntent = new Intent(this, RemoteListenActivity.class);
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        launchIntent.putExtra("fromPush", true);
        launchIntent.putExtra("remoteListen", true);
        launchIntent.putExtra("launcherNotificationId", notificationId);
        if (data != null) {
            putIfNotBlank(launchIntent, "familyId", data.optString("familyId", familyId));
            putIfNotBlank(launchIntent, "senderUserId", data.optString("senderUserId", ""));
            putIfNotBlank(launchIntent, "durationSec", data.optString("durationSec", ""));
            putIfNotBlank(launchIntent, "requestId", readRemoteListenRequestId(data));
            putIfNotBlank(launchIntent, "targetUserId", data.optString("targetUserId", ""));
        } else {
            putIfNotBlank(launchIntent, "familyId", familyId);
        }

        PendingIntent launchPendingIntent = createRemoteListenPendingIntent(
            launchIntent,
            notificationId
        );

        // 방해금지모드에서도 알람이 울리던 문제 (2026-05-07 사용자 보고) 수정.
        // 알림 자체는 silent + CATEGORY_SERVICE — 알람 채널 우회로 인한 사운드/진동 0.
        // fullScreenIntent 는 그대로 유지 (잠금화면 RemoteListenActivity launch 위해).
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, REMOTE_LISTEN_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_hyeni_notification)
            .setLargeIcon(NotificationHelper.largeIcon(this))
            .setColor(ContextCompat.getColor(this, R.color.notification_accent))
            .setContentTitle("주변 소리 연결 요청")
            .setContentText("탭해서 아이 기기에서 연결을 시작하세요.")
            .setStyle(new NotificationCompat.BigTextStyle().bigText("탭하면 아이 기기에서 마이크 연결 화면이 열립니다."))
            .setAutoCancel(false)
            .setContentIntent(launchPendingIntent)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setFullScreenIntent(launchPendingIntent, true)
            .setWhen(System.currentTimeMillis());

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(notificationId, builder.build());
        }
        try {
            launchPendingIntent.send(this, 0, null, null, null, null, remoteListenSendOptions());
        } catch (PendingIntent.CanceledException error) {
            Log.w(TAG, "Remote listen pending wake activity launch failed", error);
        }
    }

    private PendingIntent createRemoteListenPendingIntent(Intent launchIntent, int requestCode) {
        return PendingIntent.getActivity(
            this,
            requestCode,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE,
            remoteListenCreatorOptions()
        );
    }

    private Bundle remoteListenCreatorOptions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            return null;
        }

        ActivityOptions options = ActivityOptions.makeBasic();
        options.setPendingIntentCreatorBackgroundActivityStartMode(
            ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
        );
        RemoteListenActivity.applyRemoteListenLaunchDisplay(this, options);
        return options.toBundle();
    }

    private Bundle remoteListenSendOptions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return null;
        }

        ActivityOptions options = ActivityOptions.makeBasic();
        options.setPendingIntentBackgroundActivityStartMode(
            ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
        );
        RemoteListenActivity.applyRemoteListenLaunchDisplay(this, options);
        return options.toBundle();
    }

    private void ensureRemoteListenChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel existing = manager.getNotificationChannel(REMOTE_LISTEN_CHANNEL_ID);
        if (existing != null) return;

        // IMPORTANCE_HIGH + setFullScreenIntent 로 잠금화면 / Samsung 폴더블 cover
        // display 에서 RemoteListenActivity launch. sound=null + vibration=false 로
        // 무음, bypassDnd=true 로 cover display 알림 노출 (DND 우회는 표시 정책,
        // 사운드는 별개 — 채널이 sound=null 이면 무음 유지).
        // 사용자 보고(2026-05-07): "폴더가 닫힌 상태에서 주변 소리 듣기 안 됨".
        NotificationChannel channel = new NotificationChannel(
            REMOTE_LISTEN_CHANNEL_ID,
            "원격 듣기 연결 (cover 호환 무음)",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("폴더 닫힘 / 잠금화면에서도 화면만 조용히 켜고 마이크 연결을 시작");
        channel.enableVibration(false);
        channel.setVibrationPattern(null);
        channel.setSound(null, null);
        channel.setBypassDnd(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private void putIfNotBlank(Intent intent, String key, String value) {
        if (!isBlank(value)) {
            intent.putExtra(key, value);
        }
    }

    private int readRemoteListenDurationSec(@Nullable JSONObject data) {
        String raw = data != null ? data.optString("durationSec", "") : "";
        if (isBlank(raw)) return 30;
        try {
            int durationSec = Integer.parseInt(raw);
            if (durationSec < 5) return 30;
            return Math.min(durationSec, 120);
        } catch (NumberFormatException ignored) {
            return 30;
        }
    }

    private String readRemoteListenRequestId(@Nullable JSONObject data) {
        if (data == null) return "";
        return firstNonBlank(
            data.optString("requestId", ""),
            data.optString("pushId", ""),
            data.optString("idempotencyKey", ""),
            data.optString("idempotency_key", "")
        );
    }

    private String firstNonBlank(String... values) {
        if (values == null) return "";
        for (String value : values) {
            if (!isBlank(value)) return value.trim();
        }
        return "";
    }

    private boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    private void markDelivered(JSONArray ids) {
        try {
            JSONObject body = new JSONObject();
            body.put("p_ids", ids);

            String url = supabaseUrl + "/rest/v1/rpc/mark_notifications_delivered";
            String bearer = (accessToken != null && !accessToken.isEmpty()) ? accessToken : supabaseKey;
            Request req = new Request.Builder()
                .url(url)
                .header("apikey", supabaseKey)
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + bearer)
                .post(RequestBody.create(body.toString(), MediaType.get("application/json")))
                .build();

            Response response = httpClient.newCall(req).execute();
            response.close();
        } catch (Exception e) {
            Log.e(TAG, "Mark delivered error", e);
        }
    }

    private boolean isLocallyAckedPolledNotification(String stableId) {
        if (isBlank(stableId)) return false;
        long now = System.currentTimeMillis();
        SharedPreferences prefs = getSharedPreferences(POLLED_DEDUPE_PREFS, MODE_PRIVATE);
        long seenAt = prefs.getLong(stableId, 0L);
        return seenAt > 0 && (now - seenAt) < POLLED_DEDUPE_WINDOW_MS;
    }

    private void markLocalPolledNotificationAck(String stableId) {
        if (isBlank(stableId)) return;
        long now = System.currentTimeMillis();
        SharedPreferences prefs = getSharedPreferences(POLLED_DEDUPE_PREFS, MODE_PRIVATE);
        prefs.edit().putLong(stableId, now).apply();
    }

    // NTV-H4: shownEventNotifs is the in-memory dedup set guarding arrival /
    // miss alerts against duplicates. It is mirrored to SharedPreferences so an
    // OS kill → restart does not lose it and re-fire alerts the parent already
    // received. The set is day-scoped (cleared at midnight), so a snapshot
    // older than 24h is discarded wholesale rather than replayed.
    private void loadShownEventNotifs() {
        try {
            SharedPreferences prefs = getSharedPreferences(SHOWN_NOTIFS_PREFS, MODE_PRIVATE);
            long savedAt = prefs.getLong("savedAt", 0L);
            if (savedAt <= 0L || System.currentTimeMillis() - savedAt >= SHOWN_NOTIFS_TTL_MS) {
                return;
            }
            Set<String> saved = prefs.getStringSet("keys", null);
            if (saved != null) shownEventNotifs.addAll(saved);
        } catch (Exception e) {
            Log.w(TAG, "loadShownEventNotifs failed", e);
        }
    }

    private void persistShownEventNotifs() {
        try {
            getSharedPreferences(SHOWN_NOTIFS_PREFS, MODE_PRIVATE)
                .edit()
                .putStringSet("keys", new java.util.HashSet<>(shownEventNotifs))
                .putLong("savedAt", System.currentTimeMillis())
                .apply();
        } catch (Exception e) {
            Log.w(TAG, "persistShownEventNotifs failed", e);
        }
    }

    // ── Event Time Checking (15분 전 + 시작 시 알림) ────────────────────────────
    private void startEventTimeChecking() {
        if (eventCheckRunnable != null) return;

        eventCheckRunnable = new Runnable() {
            @Override
            public void run() {
                checkEventTimes();
                handler.postDelayed(this, EVENT_CHECK_INTERVAL_MS);
            }
        };
        handler.postDelayed(eventCheckRunnable, 10000); // first check after 10s
        Log.i(TAG, "Event time checking started (every " + EVENT_CHECK_INTERVAL_MS + "ms)");
    }

    private void checkEventTimes() {
        runOnNetworkThread("event_check", () -> {
            try {
                // Get current time in KST
                Calendar kst = Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul"));
                int year = kst.get(Calendar.YEAR);
                int month = kst.get(Calendar.MONTH) + 1; // Calendar.MONTH is 0-based, convert to 1-based
                int day = kst.get(Calendar.DAY_OF_MONTH);
                int nowHour = kst.get(Calendar.HOUR_OF_DAY);
                int nowMin = kst.get(Calendar.MINUTE);
                int nowTotalMin = nowHour * 60 + nowMin;

                String dateKey = year + "-" + month + "-" + day;

                // 일정 목록은 자주 바뀌지 않으므로 네트워크 fetch 와 시각 평가를 분리한다.
                // get_today_events 는 EVENT_REFRESH_INTERVAL_MS(2분)마다만 네트워크로 갱신해 캐시하고,
                // 60초 tick 은 캐시된 events 에 대해 로컬 시각/거리 비교만 수행한다.
                // 리마인더 적시성(fireLocalEventReminders ±1분 밴드 + dateKey dedup)과 자동무음
                // (SILENT_WINDOW 10분 창)이 2분 캐시 지연을 흡수하므로 알림은 누락되지 않는다.
                // 자정 경과(dateKey 변경) 시에는 새 날짜 일정을 즉시 강제 갱신한다.
                long nowMs = System.currentTimeMillis();
                boolean refreshEvents = cachedEventsJson == null
                    || !dateKey.equals(cachedEventsDateKey)
                    || nowMs - eventRefreshAtMs > EVENT_REFRESH_INTERVAL_MS;
                JSONArray events;
                if (refreshEvents) {
                    // Fetch today's events via RPC
                    JSONObject body = new JSONObject();
                    body.put("p_family_id", familyId);
                    body.put("p_date_key", dateKey);

                    String url = supabaseUrl + "/rest/v1/rpc/get_today_events";
                    String bearer = (accessToken != null && !accessToken.isEmpty()) ? accessToken : supabaseKey;
                    Response response = httpClient.newCall(new Request.Builder()
                        .url(url)
                        .header("apikey", supabaseKey)
                        .header("Content-Type", "application/json")
                        .header("Authorization", "Bearer " + bearer)
                        .post(RequestBody.create(body.toString(), MediaType.get("application/json")))
                        .build()).execute();
                    if (response.code() == 401 || response.code() == 403) {
                        // 일정 알림도 D1 1h 만료 시 갱신 후 재시도 (백그라운드 일정 알림 복구).
                        response.close();
                        String renewed = networkRefreshAccessToken();
                        if (renewed == null || renewed.isEmpty()) return;
                        response = httpClient.newCall(new Request.Builder()
                            .url(url)
                            .header("apikey", supabaseKey)
                            .header("Content-Type", "application/json")
                            .header("Authorization", "Bearer " + renewed)
                            .post(RequestBody.create(body.toString(), MediaType.get("application/json")))
                            .build()).execute();
                    }
                    if (!response.isSuccessful()) {
                        response.close();
                        return;
                    }

                    String respBody = response.body().string();
                    response.close();

                    events = new JSONArray(respBody);
                    cachedEventsJson = respBody;
                    cachedEventsDateKey = dateKey;
                    eventRefreshAtMs = nowMs;
                } else {
                    events = new JSONArray(cachedEventsJson);
                }
                if (events.length() == 0) return;

                boolean isChildDevice;
                {
                    SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                    isChildDevice = "child".equalsIgnoreCase(prefs.getString("role", ""));
                }

                // Track whether we're still at the silenced event's location
                boolean stillAtSilentLocation = false;

                for (int i = 0; i < events.length(); i++) {
                    JSONObject ev = events.getJSONObject(i);
                    String eventId = ev.getString("event_id");
                    String title = ev.optString("event_title", "일정");
                    String time = ev.optString("event_time", "00:00");
                    String emoji = ev.optString("event_emoji", "📅");
                    JSONObject location = ev.optJSONObject("event_location");

                    String[] parts = time.split(":");
                    if (parts.length < 2) continue;
                    int evHour, evMin;
                    try {
                        evHour = Integer.parseInt(parts[0].trim());
                        evMin = Integer.parseInt(parts[1].trim());
                    } catch (NumberFormatException nfe) {
                        Log.w(TAG, "Invalid time format: " + time);
                        continue;
                    }
                    int evTotalMin = evHour * 60 + evMin;

                    int diffToStart = evTotalMin - nowTotalMin;

                    // Cron 의존을 못 믿으므로 자녀 디바이스에서 자체 15min/5min/start 로컬 알림.
                    // notificationId가 push-notify cron의 pushId 와 동일 포맷이라 중복 시 교체됨.
                    if (isChildDevice) {
                        fireLocalEventReminders(eventId, title, time, emoji, evTotalMin, nowTotalMin, dateKey);
                    }

                    // ── Geo-fence checks: auto-silent + parent alerts ────────────
                    if (location == null) continue;
                    double evLat = location.optDouble("lat", Double.NaN);
                    double evLng = location.optDouble("lng", Double.NaN);
                    if (Double.isNaN(evLat) || Double.isNaN(evLng)) continue;

                    boolean inTimeWindow = nowTotalMin >= (evTotalMin - SILENT_WINDOW_BEFORE_MIN)
                        && nowTotalMin <= (evTotalMin + SILENT_WINDOW_AFTER_MIN);

                    // GPS 미확보 시 도착/미도착 판정 보류 — 즉시 fix 요청 후 다음 tick에 재평가.
                    if (Double.isNaN(lastUploadedLat)) {
                        if (inTimeWindow) {
                            Log.i(TAG, "GPS not yet acquired for event " + title + " in window, requesting fix");
                            requestImmediateLocationFix();
                        }
                        continue;
                    }

                    float distToEvent = distanceBetween(
                        lastUploadedLat, lastUploadedLng, evLat, evLng);
                    boolean atLocation = distToEvent <= GEOFENCE_RADIUS_M;

                    if (eventId.equals(silentForEventId) && atLocation) {
                        stillAtSilentLocation = true;
                    }

                    if (inTimeWindow && atLocation && silentForEventId == null) {
                        activateSilentMode(eventId, title, evLat, evLng);
                        stillAtSilentLocation = true;
                    }

                    // ── 시작 시각 ~ 시작 후 60분 윈도우에서 도착/미도착 판정 ──
                    String keyStatus = eventId + "-status-" + dateKey;
                    String keyArrived = eventId + "-arrived-" + dateKey;
                    String keyNotArrived = eventId + "-not_arrived-" + dateKey;

                    // 1. 도착(arrived) 판정: 15분 전부터 60분 후까지.
                    //    keyArrived 로 데둡하여 미도착 알림(keyNotArrived) 이후에도 1회 도착 알림 가능.
                    if (diffToStart >= -15 && diffToStart <= 60 && atLocation && !shownEventNotifs.contains(keyArrived)) {
                        shownEventNotifs.add(keyArrived);
                        
                        // 이미 미도착 알림이 나간 상태라면 '지각 도착'으로 문구 변경
                        if (shownEventNotifs.contains(keyNotArrived)) {
                            int lateMin = (int)diffToStart;
                            sendParentAlert(
                                "late_arrived",
                                "✅ 지각 도착",
                                emoji + " " + title + "에 " + lateMin + "분 늦게 도착했어요",
                                "info", eventId, keyArrived
                            );
                            Log.i(TAG, "Late arrival alert (dynamic) for " + title + " (+" + lateMin + "min)");
                        } else {
                            // 정상 도착
                            shownEventNotifs.add(keyStatus); // 레거시 호환용 status 키도 함께 점유
                            sendParentAlert(
                                "arrived",
                                "✅ 도착 확인",
                                emoji + " " + title + "에 잘 도착했어요! (" + time + ")",
                                "info", eventId, keyArrived
                            );
                            Log.i(TAG, "Parent arrival alert for " + title);
                        }
                    }

                    // 2. 미도착(not_arrived) 판정: 정각(0) ~ 5분 사이 1회 허용.
                    //    이미 도착(keyArrived)한 상태면 미도착 알림은 생략.
                    if (diffToStart >= 0 && diffToStart <= 5 && !atLocation && !shownEventNotifs.contains(keyArrived) && !shownEventNotifs.contains(keyNotArrived)) {
                        shownEventNotifs.add(keyNotArrived);
                        shownEventNotifs.add(keyStatus); // 레거시 호환용 status 키도 함께 점유
                        sendParentAlert(
                            "not_arrived",
                            "🚨 미도착 알림",
                            emoji + " " + title + " 시작 시간인데 아직 도착하지 않았어요 (" + time + ")",
                            "emergency", eventId, keyNotArrived
                        );
                        Log.i(TAG, "Parent miss alert for " + title);
                    }

                    // 3. 15분 경과 여전히 미도착인 경우 (초기 미도착 알림 이후 최종 경고)
                    if (diffToStart >= 15 && diffToStart <= 18 && !atLocation && !shownEventNotifs.contains(keyArrived)) {
                        String lateMarkKey = eventId + "-missed15-" + dateKey;
                        if (!shownEventNotifs.contains(lateMarkKey)) {
                            shownEventNotifs.add(lateMarkKey);
                            sendParentAlert(
                                "missed_arrival",
                                "🚨 15분 경과 — 미도착",
                                emoji + " " + title + " 시작 후 15분이 지났는데 아직 도착하지 않았어요",
                                "emergency", eventId, lateMarkKey
                            );
                            Log.i(TAG, "Missed arrival critical alert for " + title);
                        }
                    }
                }

                // ── Restore ringer if we left the silenced event's location ──────
                if (silentForEventId != null && !stillAtSilentLocation) {
                    restoreRingerMode();
                }

                // Clean up old notification keys (reset at midnight)
                if (nowTotalMin == 0) {
                    shownEventNotifs.clear();
                }

                // NTV-H4: persist the dedup set so an OS kill → restart does
                // not lose it and re-fire arrival / miss alerts.
                persistShownEventNotifs();

            } catch (Exception e) {
                Log.e(TAG, "Event time check error", e);
            }
        });
    }

    // ── Send alert to parent (stored in DB + push notification) ────────────────
    // NTV-H2: POST with up to 3 attempts. The first attempt uses the access
    // token; retries fall back to the anon apikey, which covers an expired
    // token (401/403). Transient IO / 5xx failures retry with backoff.
    // Returns true only on a 2xx response.
    private boolean postWithAuthRetry(String url, String jsonBody) {
        return postWithAuthRetry(url, jsonBody, null);
    }

    private boolean postWithAuthRetry(String url, String jsonBody, @Nullable String idempotencyKey) {
        for (int attempt = 1; attempt <= 3; attempt++) {
            // 매 시도마다 현재 access token 사용. 401/403 후 networkRefreshAccessToken()
            // 이 accessToken 을 갱신하므로 다음 시도는 자동으로 새 토큰을 쓴다.
            String bearer = (accessToken != null && !accessToken.isEmpty())
                ? accessToken : supabaseKey;
            try {
                Request.Builder builder = new Request.Builder()
                    .url(url)
                    .header("apikey", supabaseKey)
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + bearer)
                    .post(RequestBody.create(jsonBody, MediaType.get("application/json")));
                if (!isBlank(idempotencyKey)) {
                    builder.header("Idempotency-Key", idempotencyKey);
                }
                Request req = builder.build();
                Response response = httpClient.newCall(req).execute();
                int code = response.code();
                response.close();
                if (code >= 200 && code < 300) return true;
                Log.w(TAG, "postWithAuthRetry " + url + " attempt " + attempt + " -> HTTP " + code);
                // A non-auth 4xx will not be fixed by retrying.
                if (code != 401 && code != 403 && code < 500) return false;
                // 인증 실패 → refresh token 으로 access 갱신(백그라운드 1h 만료 복구).
                if (code == 401 || code == 403) {
                    networkRefreshAccessToken();
                }
            } catch (Exception e) {
                Log.w(TAG, "postWithAuthRetry " + url + " attempt " + attempt + " failed: " + e.getMessage());
            }
            if (attempt < 3) {
                try {
                    Thread.sleep(attempt * 500L);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return false;
                }
            }
        }
        return false;
    }

    // dedupKeys: the shownEventNotifs entries that gated this alert. If every
    // delivery channel fails, they are removed so the next checkEventTimes tick
    // retries — otherwise a transient failure would suppress the alert forever.
    private void sendParentAlert(String alertType, String title, String message,
                                 String severity, String eventId, String... dedupKeys) {
        runOnNetworkThread("parent_alert", () -> {
            try {
                JSONObject body = new JSONObject();
                body.put("p_family_id", familyId);
                body.put("p_alert_type", alertType);
                body.put("p_title", title);
                body.put("p_message", message);
                body.put("p_severity", severity);
                if (eventId != null) body.put("p_event_id", eventId);
                boolean insertOk = postWithAuthRetry(
                    supabaseUrl + "/rest/v1/rpc/insert_parent_alert_v2", body.toString());

                JSONObject pushBody = new JSONObject();
                pushBody.put("action", "parent_alert");
                pushBody.put("familyId", familyId);
                pushBody.put("senderUserId", userId);
                pushBody.put("title", title);
                pushBody.put("message", message);
                pushBody.put("alertType", alertType);
                pushBody.put("severity", severity);
                if (eventId != null) pushBody.put("eventId", eventId);
                boolean pushOk = postWithAuthRetry(
                    supabaseUrl + "/functions/v1/push-notify", pushBody.toString());

                if (insertOk || pushOk) {
                    Log.i(TAG, "Parent alert sent: " + alertType
                        + " (insert=" + insertOk + " push=" + pushOk + ")");
                } else {
                    // NTV-H2: total failure — the parent received nothing and
                    // no record was written. Drop the dedup keys so the next
                    // checkEventTimes tick retries. Safe from a double insert
                    // because the insert above did not succeed.
                    Log.w(TAG, "Parent alert FAILED entirely, rolling back dedup: " + alertType);
                    for (String k : dedupKeys) shownEventNotifs.remove(k);
                    persistShownEventNotifs();
                }
            } catch (Exception e) {
                Log.e(TAG, "Send parent alert error", e);
                for (String k : dedupKeys) shownEventNotifs.remove(k);
                persistShownEventNotifs();
            }
        });
    }

    // ── Local event reminder fallback (자녀 디바이스, cron 미동작 시 보호) ────
    // notificationId 포맷이 push-notify cron의 pushId(`<eventId>-<window>-<dateKey>`)
    // 와 동일하므로, cron이 정상 동작한 경우 동일 알림이 native side에서 다시 와도
    // OS가 같은 ID로 교체 — 사용자에게 중복으로 보이지 않는다.
    private void fireLocalEventReminders(String eventId, String title, String time, String emoji,
                                         int evTotalMin, int nowTotalMin, String dateKey) {
        int[] minsBefore = {15, 5, 0};
        String[] keys = {"15min", "5min", "start"};
        String[] notifTitles = {"🐰 준비 시간!", "🏃 출발!", "⏰ 시작!"};
        String[] bodyTail = {
            " 가기 15분 전이야! 준비물 챙겼니? 🎒",
            " 곧 시작이야! 출발~ 화이팅! 💪",
            " 시작 시간이야! 화이팅! 💪"
        };

        for (int r = 0; r < minsBefore.length; r++) {
            int diff = (evTotalMin - minsBefore[r]) - nowTotalMin;
            if (diff < -1 || diff > 1) continue;

            String reminderKey = eventId + "-" + keys[r] + "-" + dateKey;
            if (shownEventNotifs.contains(reminderKey)) continue;
            shownEventNotifs.add(reminderKey);

            String body = emoji + " " + title + bodyTail[r] + " (" + time + ")";
            int notifId = NotificationHelper.stableRequestCode(reminderKey);

            try {
                NotificationHelper.showNotification(
                    this,
                    notifTitles[r],
                    body,
                    "schedule",
                    false,
                    false,
                    notifId
                );
                Log.i(TAG, "Local event reminder fired: " + keys[r] + " for " + title);
            } catch (Exception e) {
                Log.w(TAG, "Local event reminder failed: " + e.getMessage());
            }
        }
    }

    // ── Auto-Silent Mode Control ───────────────────────────────────────────────
    private void activateSilentMode(String eventId, String eventTitle, double lat, double lng) {
        if (audioManager == null) return;
        try {
            savedRingerMode = audioManager.getRingerMode();
            audioManager.setRingerMode(AudioManager.RINGER_MODE_VIBRATE);
            silentForEventId = eventId;
            silentEventLat = lat;
            silentEventLng = lng;

            // Persist saved ringer mode to SharedPreferences for crash recovery
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            prefs.edit()
                .putInt("savedRingerMode", savedRingerMode)
                .putString("silentForEventId", eventId)
                .apply();

            // Schedule a max-timeout safety restore (3 hours)
            handler.postDelayed(() -> {
                if (silentForEventId != null) {
                    Log.w(TAG, "Auto-silent safety timeout reached, restoring ringer");
                    restoreRingerMode();
                }
            }, SILENT_WINDOW_AFTER_MIN * 60 * 1000L);

            // Update foreground notification to show silent status
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                Notification notif = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setContentTitle("혜니캘린더 🔇")
                    .setContentText("📍 " + eventTitle + " 도착 — 자동 무음 중")
                    .setSmallIcon(R.drawable.ic_hyeni_notification)
                    .setLargeIcon(NotificationHelper.largeIcon(this))
                    .setColor(ContextCompat.getColor(this, R.color.notification_accent))
                    .setOngoing(true)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .build();
                manager.notify(NOTIFICATION_ID, notif);
            }

            Log.i(TAG, "Silent mode ON for: " + eventTitle + " (saved ringer=" + savedRingerMode + ")");
        } catch (SecurityException e) {
            // DND access not granted — reset state so we don't get stuck
            silentForEventId = null;
            savedRingerMode = -1;
            Log.w(TAG, "Cannot set ringer mode (DND access needed): " + e.getMessage());
        }
    }

    private void restoreRingerMode() {
        if (audioManager == null || savedRingerMode < 0) return;
        try {
            audioManager.setRingerMode(savedRingerMode);
            Log.i(TAG, "Ringer restored to mode=" + savedRingerMode
                + " (left event " + silentForEventId + ")");
        } catch (SecurityException e) {
            Log.w(TAG, "Cannot restore ringer mode: " + e.getMessage());
        } finally {
            // Always clear state, even if restore fails
            savedRingerMode = -1;
            silentForEventId = null;
            silentEventLat = Double.NaN;
            silentEventLng = Double.NaN;

            // Clear persisted state
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            prefs.edit()
                .remove("savedRingerMode")
                .remove("silentForEventId")
                .apply();
        }

        // Restore foreground notification
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildForegroundNotification());
        }
    }

    // 시스템 트레이에 같은 pushId 태그의 알림이 이미 떠 있는지 검사한다.
    // 서버가 비긴급 푸시에 붙인 notification 블록을 백그라운드에서 시스템이 직접
    // 표시한 경우를 잡아내 폴링 중복 게시를 막는다. SDK 23+ 에서만 동작(이전은 false).
    private boolean isSystemNotificationPresent(String tag) {
        if (isBlank(tag) || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return false;
        try {
            android.service.notification.StatusBarNotification[] active = manager.getActiveNotifications();
            if (active == null) return false;
            for (android.service.notification.StatusBarNotification sbn : active) {
                if (sbn != null && tag.equals(sbn.getTag())) {
                    return true;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "getActiveNotifications check failed", e);
        }
        return false;
    }

    // ── Heads-Up Notification (popup) ───────────────────────────────────────────
    private void showPolledNotification(String title, String body, String type, boolean emergency, String stableId) {
        boolean isKkuk = "kkuk".equals(type);
        // LocationService 는 자녀 기기 전용 — 비긴급 폴링 알림은 전부 "아이가 받는
        // 메시지"이므로 child_message 채널(IMPORTANCE_HIGH)로 heads-up 팝업을 보장한다.
        // (구버전 설치 기기의 고착된 schedule 채널 설정 때문에 트레이 직행되는 것 방지)
        String channel = emergency ? "emergency" : (isKkuk ? "kkuk" : "child_message");
        // 꾹은 긴급 등급 — 전체화면(fullScreenIntent)으로 띄운다. FCM 경로
        // (MyFirebaseMessagingService.showNotification: fullScreen = emergency || isKkuk)와 동일.
        boolean fullScreen = emergency || isKkuk;
        int notificationId = NotificationHelper.stableRequestCode(stableId);
        // AI 선제 대화/스티커 알림은 탭하면 관련 아이 화면으로 직행한다.
        String route = "ai_proactive".equals(type) ? "ai-chat" : ("sticker".equals(type) ? "child-sticker" : null);
        NotificationHelper.showNotification(
            this,
            title,
            body,
            channel,
            fullScreen,
            fullScreen,
            notificationId,
            route
        );

        Log.i(TAG, "Polled notification: " + title + ", emergency=" + emergency + ", kkuk=" + isKkuk);
    }

    private boolean isEmergencyNotification(String type, @Nullable JSONObject data) {
        if ("emergency".equals(type) || "sos".equals(type)) {
            return true;
        }
        if (data != null && "true".equalsIgnoreCase(data.optString("urgent", "false"))) {
            return true;
        }
        if (!"parent_alert".equals(type)) {
            return false;
        }
        String severity = data != null ? data.optString("severity", "") : "";
        String alertType = data != null ? data.optString("alertType", data.optString("alert_type", "")) : "";
        if ("emergency".equalsIgnoreCase(severity)
                || "critical".equalsIgnoreCase(severity)
                || "urgent".equalsIgnoreCase(severity)) {
            return true;
        }
        return "not_arrived".equals(alertType)
                || "missed_arrival".equals(alertType)
                || "danger_zone".equals(alertType)
                || "danger_enter".equals(alertType)
                || "danger_entry".equals(alertType)
                || "danger_exit".equals(alertType)
                || "sos".equals(alertType)
                || "sos_followup".equals(alertType);
    }

    // ── Notification Channels ───────────────────────────────────────────────────
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;

            // 위치 추적 FGS 전용 채널만 LocationService 에서 생성한다.
            NotificationChannel locationChannel = new NotificationChannel(
                CHANNEL_ID, "위치 추적", NotificationManager.IMPORTANCE_LOW);
            locationChannel.setDescription("아이 위치를 부모님께 공유합니다");
            manager.createNotificationChannel(locationChannel);
        }

        // 긴급/일정/꾹/무음 알림 채널은 NotificationHelper 단일 정의를 따른다.
        // 기존엔 LocationService 가 ALERT_CHANNEL_ID(hyeni_alert_v5)를 delete+재생성하며
        // 라벨("일정 알림")·진동({0,100,60,100})을 자기 값으로 덮어써 NotificationHelper
        // 정의("긴급 알림", {0,300,120,300,120,600})와 드리프트가 났다. 정의를 단일화한다.
        NotificationHelper.createChannels(this);
    }

    // ── Foreground Notification ─────────────────────────────────────────────────
    private Notification buildForegroundNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String role = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString("role", "child");
        String statusText = "parent".equals(role)
            ? "아이와 함께하고 있어요 💕"
            : "부모님이 함께하고 있어요 💕";

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("혜니캘린더")
            .setContentText(statusText)
            .setSmallIcon(R.drawable.ic_hyeni_notification)
            .setLargeIcon(NotificationHelper.largeIcon(this))
            .setColor(ContextCompat.getColor(this, R.color.notification_accent))
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    // ── Cleanup ─────────────────────────────────────────────────────────────────
    private void stopAll() {
        // Restore ringer if silent mode is active
        if (silentForEventId != null) {
            restoreRingerMode();
        }
        if (locationCallback != null) {
            fusedClient.removeLocationUpdates(locationCallback);
            locationCallback = null;
        }
        if (notifPollRunnable != null) {
            handler.removeCallbacks(notifPollRunnable);
            notifPollRunnable = null;
        }
        if (eventCheckRunnable != null) {
            handler.removeCallbacks(eventCheckRunnable);
            eventCheckRunnable = null;
        }
        if (placeGeofenceRunnable != null) {
            handler.removeCallbacks(placeGeofenceRunnable);
            placeGeofenceRunnable = null;
        }
        if (tokenRefreshRunnable != null) {
            handler.removeCallbacks(tokenRefreshRunnable);
            tokenRefreshRunnable = null;
        }
        if (lowBatteryRunnable != null) {
            handler.removeCallbacks(lowBatteryRunnable);
            lowBatteryRunnable = null;
        }
        if (locationFixWatchdogRunnable != null) {
            handler.removeCallbacks(locationFixWatchdogRunnable);
            locationFixWatchdogRunnable = null;
        }
        cancelSignificantMotion();
        unregisterNetworkCallback();
        releaseScopedWakeLock(fixWakeLock);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        stopAll();
        teardownActivityTransitionTracking();
        // Schedule AlarmManager restart if service was not explicitly stopped
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        if (prefs.getBoolean("serviceEnabled", false)) {
            scheduleAlarmRestart();
        }
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.i(TAG, "Task removed, scheduling restart via AlarmManager");
        scheduleAlarmRestart();
        super.onTaskRemoved(rootIntent);
    }

    // ── AlarmManager-based restart (more reliable than startForegroundService in onTaskRemoved) ──
    private static final int ALARM_RESTART_REQUEST_CODE = 9999;

    private void scheduleAlarmRestart() {
        try {
            Intent restartIntent = new Intent(this, BootReceiver.class);
            restartIntent.setAction(BootReceiver.ACTION_RESTART_LOCATION_SERVICE);
            PendingIntent pi = PendingIntent.getBroadcast(
                this, ALARM_RESTART_REQUEST_CODE, restartIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (am != null) {
                long triggerAt = System.currentTimeMillis() + 5000; // restart in 5 seconds
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                } else {
                    am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                }
                Log.i(TAG, "AlarmManager restart scheduled in 5 seconds");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to schedule alarm restart: " + e.getMessage());
        }
    }

    private void cancelAlarmRestart() {
        try {
            Intent restartIntent = new Intent(this, BootReceiver.class);
            restartIntent.setAction(BootReceiver.ACTION_RESTART_LOCATION_SERVICE);
            PendingIntent pi = PendingIntent.getBroadcast(
                this, ALARM_RESTART_REQUEST_CODE, restartIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (am != null) {
                am.cancel(pi);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to cancel alarm restart: " + e.getMessage());
        }
    }

    // ── Doze-bypass 위치 heartbeat (staleness reliability Phase 2) ───────────────
    // 정지+Doze 에서 FusedLocation 콜백·handler 타이머가 멈춰도, AlarmManager 가
    // 주기적으로 BootReceiver→서비스를 깨워 단발 fix 를 강제한다(self-rescheduling:
    // onStartCommand 가 매번 다음 회차를 다시 예약). last_location_at 갱신 → 서버
    // staleness 가 '복구'로 자연 전환된다.
    private static final int ALARM_HEARTBEAT_REQUEST_CODE = 9998;
    // 5분 주기. setExactAndAllowWhileIdle 은 Doze 중 앱당 ~9분 1회로 OS rate-limit
    // 되므로 정지+Doze 최악 시 실발화는 5~9분이 될 수 있다(비-Doze 면 5분 정확).
    private static final long HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000L;

    private PendingIntent heartbeatPendingIntent() {
        Intent hb = new Intent(this, BootReceiver.class);
        hb.setAction(BootReceiver.ACTION_HEARTBEAT_FIX);
        return PendingIntent.getBroadcast(
            this, ALARM_HEARTBEAT_REQUEST_CODE, hb,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void scheduleNextHeartbeat() {
        try {
            AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            long triggerAt = System.currentTimeMillis() + HEARTBEAT_INTERVAL_MS;
            PendingIntent pi = heartbeatPendingIntent();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // Android 12+: exact alarm 권한이 없으면(사용자 미허용) inexact
                // allow-while-idle 로 폴백 — 발화가 maintenance window 까지 밀릴 수
                // 있으나 chain 은 끊기지 않는다.
                if (am.canScheduleExactAlarms()) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                } else {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to schedule heartbeat: " + e.getMessage());
        }
    }

    private void cancelHeartbeat() {
        try {
            AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.cancel(heartbeatPendingIntent());
        } catch (Exception e) {
            Log.w(TAG, "Failed to cancel heartbeat: " + e.getMessage());
        }
    }
}
