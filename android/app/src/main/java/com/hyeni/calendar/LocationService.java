package com.hyeni.calendar;

import android.Manifest;
import android.annotation.SuppressLint;
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
import com.google.android.gms.location.CurrentLocationRequest;
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
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
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
    private static final String CHANNEL_ID = "hyeni_location_v5_private";
    private static final String ALERT_CHANNEL_ID = NotificationHelper.CHANNEL_EMERGENCY;
    public static final String ACTION_REFRESH_NOW = "REFRESH_NOW";
    // Doze-bypass 위치 heartbeat (staleness reliability Phase 2). 정지+Doze 에서
    // FusedLocation 콜백이 멈춰도 특별 권한이 필요 없는 AlarmManager inexact alarm이 주기적으로
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
    // 도로매칭(Kakao) 호출 게이트: 직전→실측 거리가 이 값을 넘는 '듬성한 갭'에서만 매칭을 시도한다.
    // 이보다 조밀한 캡처는 raw GPS 직선이 이미 충분히 정확하다. 2026-07-30부터 매칭이 실패해도
    // 합성 채움점(is_estimated)을 만들지 않고 실측점만 남긴다. trailMath 150m 기준과 정렬.
    private static final float ROUTE_MATCH_MIN_GAP_M = 150f;
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
    private static final long FIX_WAKELOCK_TIMEOUT_MS = 35 * 1000L; // high 12s + balanced 12s + last-known 3s 여유
    private static final long HIGH_ACCURACY_FIX_TIMEOUT_MS = 12_000L;
    private static final long BALANCED_FIX_TIMEOUT_MS = 12_000L;
    private static final long LAST_KNOWN_FIX_TIMEOUT_MS = 3_000L;
    private static final long EVENT_EVIDENCE_FIX_MIN_INTERVAL_MS = 3 * 60_000L;
    private volatile long lastEventEvidenceFixRequestElapsedMs = 0L;
    // 측위 획득뿐 아니라 upsert 인증 재시도까지 포함한 single-flight의 절대 상한이다.
    // 늦게 도착한 Task/HTTP 콜백은 generation 검증에서 폐기되어 다음 요청을 막지 않는다.
    private static final long IMMEDIATE_FIX_CHAIN_DEADLINE_MS = 85_000L;

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
    private float lastUploadedAccuracyM = Float.NaN;
    private long lastUploadedAtMs = 0L;
    private long lastUploadedElapsedRealtimeNanos = 0L;
    private double lastHistoryLat = Double.NaN;
    private double lastHistoryLng = Double.NaN;
    private long lastHistoryAtMs = 0L;
    private long lastHistoryElapsedRealtimeNanos = 0L;
    private long lastLocationAcceptedAtMs = 0L;
    private long lastLocationAcceptedElapsedRealtimeNanos = 0L;
    private boolean lastLocationAcceptedWasForceUpload = false;
    private long lastLowBatterySaveAtMs = 0L;
    // 배터리 ≤5% 진입 시 부모 알림을 에피소드당 1회만 보낸다(충전으로 회복되면 해제).
    private boolean lowBatteryAlertSent = false;

    // 오프라인 이동경로 버퍼 파일 (네트워크 유실 시 점 적재, 복구 시 플러시)
    private File locationBufferFile;
    private ConnectivityManager.NetworkCallback networkCallback;
    private final AtomicBoolean flushInFlight = new AtomicBoolean(false);
    // startTracking 초기 fix·FCM REFRESH_NOW·pending fallback이 겹쳐도 한 측위 체인만 실행한다.
    private final AtomicBoolean immediateFixInFlight = new AtomicBoolean(false);
    private final AtomicInteger immediateFixGenerationCounter = new AtomicInteger(0);
    private final AtomicInteger serviceLifecycleEpoch = new AtomicInteger(0);
    private final Object immediateFixStateLock = new Object();
    private final Object locationStateLock = new Object();
    private final Map<String, Long> pendingLocationRefreshRequests = new ConcurrentHashMap<>();
    private final Map<String, Set<String>> pendingLocationNotificationIds = new ConcurrentHashMap<>();
    private volatile Set<String> activeLocationRefreshRequestIds = Collections.emptySet();
    private volatile long activeLocationRefreshNotBeforeElapsedMs = 0L;
    private volatile int activeImmediateFixGeneration = 0;
    private volatile CancellationTokenSource activeHighAccuracyFixToken;
    private volatile CancellationTokenSource activeBalancedFixToken;
    private volatile Runnable immediateFixDeadlineTask;
    private volatile boolean serviceStopping = false;

    private String supabaseUrl;
    private String supabaseKey;
    private String userId;
    private String familyId;
    private String role;
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
        String refreshRequestId = refreshNow && intent != null
            ? intent.getStringExtra("requestId")
            : null;
        serviceStopping = false;

        if (intent != null && "STOP".equals(intent.getAction())) {
            SessionTokenStore.setServiceEnabled(prefs, false);
            ServiceKeepAlive.cancel(this);
            cancelAlarmRestart();
            cancelHeartbeat();
            stopAll();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        SessionTokenStore.ContextSnapshot context;
        if (intent != null && intent.hasExtra("userId")) {
            context = SessionTokenStore.reconcileContext(
                prefs,
                intent.getStringExtra("accessToken"),
                intent.getStringExtra("refreshToken"),
                false,
                intent.getStringExtra("sessionNonce"),
                intent.getStringExtra("userId"),
                intent.getStringExtra("familyId"),
                intent.getStringExtra("role"),
                intent.getStringExtra("supabaseUrl"),
                intent.getStringExtra("supabaseKey"),
                true,
                intent.getStringExtra("intervalMode")
            );
            if (!context.acceptedIncoming && !context.serviceEnabled) {
                Log.w(TAG, "Rejected stale location context while service is disabled");
                stopSelf();
                return START_NOT_STICKY;
            }
            if (!context.acceptedIncoming) {
                Log.w(TAG, "Ignored stale location context; using current native session");
            }
        } else {
            context = SessionTokenStore.readContext(prefs);
            if (!context.serviceEnabled) {
                Log.i(TAG, "Location service restart skipped because tracking is disabled");
                stopSelf();
                return START_NOT_STICKY;
            }
        }
        applySessionContext(context);
        applyLocationIntervalMode(context.locationIntervalMode, true);

        if (userId == null || familyId == null || supabaseUrl == null) {
            Log.w(TAG, "Missing config, stopping service");
            stopSelf();
            return START_NOT_STICKY;
        }
        if (isBlank(accessToken) && isBlank(refreshToken)) {
            Log.w(TAG, "Missing auth token, stopping service");
            SessionTokenStore.setServiceEnabled(prefs, false);
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
        // 콜드 스타트에서는 startLocationTracking()이 먼저 단발 fix를 시작한다. 그 전에
        // requestId를 등록해야 FCM 요청이 같은 generation snapshot에 포함되어 이중 측위를 막는다.
        if (refreshNow) {
            registerLocationRefreshRequest(refreshRequestId, null);
        }
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

    private void applySessionContext(SessionTokenStore.ContextSnapshot context) {
        accessToken = context.accessToken;
        refreshToken = context.refreshToken;
        userId = context.userId;
        familyId = context.familyId;
        role = context.role;
        supabaseUrl = context.supabaseUrl;
        supabaseKey = context.supabaseKey;
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

    // 아이 기기 상태(저배터리·종료 등)를 부모에게 알린다. 서버의 단일 parent-alerts
    // endpoint가 멱등 저장과 부모 FCM 연쇄를 함께 책임져 부분 성공·중복 푸시를 막는다.
    private void sendParentDeviceAlert(String alertType, String title, String message,
                                       String severity, String idempotencyKey) {
        if (isBlank(familyId) || isBlank(supabaseUrl) || isBlank(supabaseKey)) {
            lowBatteryAlertSent = false;
            Log.w(TAG, "parent device alert skipped: missing Supabase config");
            return;
        }
        final String baseUrl = supabaseUrl.replaceAll("/+$", "");
        runOnNetworkThread("device_alert", () -> {
            try {
                JSONObject alertBody = new JSONObject()
                    .put("family_id", familyId)
                    .put("alert_type", alertType)
                    .put("title", title)
                    .put("message", message)
                    .put("severity", severity)
                    .put("event_id", idempotencyKey)
                    .put("child_user_id", userId);
                boolean delivered = postWithAuthRetry(
                    baseUrl + "/api/parent-alerts",
                    alertBody.toString()
                );
                if (delivered) {
                    Log.i(TAG, "parent device alert accepted: " + alertType);
                } else {
                    Log.w(TAG, "parent device alert failed entirely: " + alertType);
                }
                if (!delivered) {
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
    private final java.util.List<org.json.JSONObject> cachedPlaces = new java.util.ArrayList<>(); // canonical {placeKey,name,source,lat,lng}
    private volatile boolean placeAlertsEnabled = false; // registered_place_alerts_enabled
    private volatile String cachedChildName = ""; // family_members.name (부모 알림 카피용, M2)
    private static final long PLACE_FIX_FRESH_MS = 15 * 60_000L; // 서버 GEOFENCE_FIX_FRESH_MS parity (M1)
    private long placeRefreshAtMs = 0L;
    private Runnable placeGeofenceRunnable;
    // 발사 중인 장소 — 알림 성공 뒤에야 상태가 저장되므로, 그 사이 재평가(새 fix 즉시 평가 또는
    // 60초 tick)가 같은 전이를 한 번 더 쏘지 못하게 막는다(2026-07-24 중복 알림 방어).
    private final java.util.Set<String> placeAlertInFlight =
        java.util.Collections.synchronizedSet(new java.util.HashSet<String>());

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
        if (!"child".equalsIgnoreCase(role)) return; // 자녀 기기 전용
        long now = System.currentTimeMillis();
        if (now - placeRefreshAtMs > PLACE_REFRESH_INTERVAL_MS || (placeRefreshAtMs == 0L)) {
            placeRefreshAtMs = now;
            runOnNetworkThread("place_refresh", this::refreshPlacesAndGates);
        }
        if (!placeAlertsEnabled || Double.isNaN(lastUploadedLat) || Double.isNaN(lastUploadedLng)) return;
        // M1: stale fix 면 평가 skip — wall-clock 만 흐르고 좌표가 frozen 이면 가짜
        // dwell/departure 전이가 날 수 있다(서버 GEOFENCE_FIX_FRESH_MS 와 동일 보호).
        if (lastUploadedAtMs <= 0L || now < lastUploadedAtMs || now - lastUploadedAtMs > PLACE_FIX_FRESH_MS) return;
        java.util.List<org.json.JSONObject> places;
        synchronized (cachedPlaces) { places = new java.util.ArrayList<>(cachedPlaces); }
        for (org.json.JSONObject p : places) {
            try {
                evaluateOnePlace(
                    p,
                    lastUploadedLat,
                    lastUploadedLng,
                    lastUploadedAccuracyM,
                    lastUploadedAtMs
                );
            }
            catch (Exception e) { Log.w(TAG, "place eval failed", e); }
        }
    }

    // saved_places + Premium academies fetch + 가족 설정 게이트 갱신. 백그라운드 Thread.
    private void refreshPlacesAndGates() {
        if (isBlank(familyId) || isBlank(supabaseUrl)) {
            disablePlaceAlertsAndClearCache();
            return;
        }
        final String base = supabaseUrl.replaceAll("/+$", "");
        // master switch 정본을 새로 확인하기 전에는 이전 true/cache를 사용하지 않는다.
        placeAlertsEnabled = false;
        try {
            // 가족 설정은 전체 등록장소 알림의 master switch다. 티어 대상은 각 저장 장소의
            // 서버 계산 필드로 판정한다. 조회 실패·누락·중복·타입 불일치는 false로 닫는다.
            org.json.JSONArray fam = httpGetArray(base + "/rest/v1/families?id=eq." + familyId + "&select=registered_place_alerts_enabled");
            placeAlertsEnabled = TierAlertTargetPolicy.isServerRegisteredPlaceAlertsEnabled(fam);
            if (!placeAlertsEnabled) {
                disablePlaceAlertsAndClearCache();
                return;
            }

            // M2: 부모 알림 카피용 자녀 표시명 (없으면 childDisplayName 이 "아이" 폴백)
            org.json.JSONArray me = httpGetArray(base + "/rest/v1/family_members?family_id=eq." + familyId + "&user_id=eq." + userId + "&select=name");
            if (me != null && me.length() > 0) cachedChildName = me.getJSONObject(0).optString("name", "");

            // 학원은 Premium 전용이다. 정본 entitlement 조회 실패·누락·불일치는 false 로
            // 닫아 403과 불필요한 refresh 회전을 피하고, 과거 Premium 학원 캐시도 아래
            // 정본 교체에서 반드시 제거한다.
            org.json.JSONObject entitlement = httpGetObject(
                base + "/api/entitlement?family_id=" + familyId
            );
            boolean premium = TierAlertTargetPolicy.isServerPremiumEntitlement(entitlement);

            java.util.List<org.json.JSONObject> next = new java.util.ArrayList<>();
            collectPlaces(
                next,
                base + "/rest/v1/saved_places?family_id=eq." + familyId
                    + "&select=id,name,location,tier_alert_active,tier_alert_inactive_reason"
                    + "&order=created_at.asc,id.asc",
                "saved_place",
                true
            );
            if (premium) {
                collectPlaces(
                    next,
                    base + "/rest/v1/academies?family_id=eq." + familyId + "&select=id,name,location",
                    "academy",
                    false
                );
            }
            next = canonicalizePlaceJson(next);
            // 네트워크/정본 실패 때 예전 장소를 유지하면 삭제됐거나 티어 한도를 벗어난
            // 장소가 계속 알림을 만들 수 있다. 가용성보다 오알림 방지를 우선해 매번
            // 현재 성공 응답만으로 전체 교체하며, 실패한 소스의 stale 캐시는 남기지 않는다.
            synchronized (cachedPlaces) { cachedPlaces.clear(); cachedPlaces.addAll(next); }
        } catch (Exception e) {
            disablePlaceAlertsAndClearCache();
            Log.w(TAG, "refreshPlacesAndGates failed", e);
        }
    }

    private void disablePlaceAlertsAndClearCache() {
        placeAlertsEnabled = false;
        synchronized (cachedPlaces) { cachedPlaces.clear(); }
    }

    private void collectPlaces(
        java.util.List<org.json.JSONObject> out,
        String url,
        String source,
        boolean requireServerAlertTarget
    ) {
        try {
            org.json.JSONArray arr = httpGetArray(url);
            for (int i = 0; arr != null && i < arr.length(); i++) {
                org.json.JSONObject r = arr.getJSONObject(i);
                if (requireServerAlertTarget && !TierAlertTargetPolicy.isServerAlertTarget(r)) continue;
                org.json.JSONObject loc = r.optJSONObject("location");
                if (loc == null) continue;
                double lat = loc.optDouble("lat", Double.NaN), lng = loc.optDouble("lng", Double.NaN);
                if (Double.isNaN(lat) || Double.isNaN(lng)) continue;
                String name = r.optString("name", "등록된 장소");
                org.json.JSONObject p = new org.json.JSONObject()
                    .put("placeKey", "registered:" + source + ":" + r.optString("id"))
                    .put("source", source)
                    .put("name", name)
                    .put("lat", lat).put("lng", lng);
                // 장소별 알림 반경(location JSON, 30~300 클램프). 없으면 이름 기반 기본값 —
                // 학교 100m, 조부모댁 등 가족 주거지 150m(서버 parity).
                double radius = loc.optDouble("alertRadiusM", loc.optDouble("alert_radius_m", Double.NaN));
                Double resolved = null;
                if (!Double.isNaN(radius) && radius > 0) {
                    resolved = Math.min(300.0, Math.max(30.0, radius));
                } else {
                    resolved = GeofenceStateMachine.defaultRegisteredPlaceRadiusM(name);
                }
                if (resolved != null) p.put("alertRadiusM", (double) resolved);
                out.add(p);
            }
        } catch (Exception e) { Log.w(TAG, "collectPlaces failed: " + source, e); }
    }

    private java.util.List<org.json.JSONObject> canonicalizePlaceJson(java.util.List<org.json.JSONObject> input) {
        java.util.List<RegisteredPlaceResolver.PlaceCandidate> candidates = new java.util.ArrayList<>();
        // canonicalize 는 PlaceCandidate 필드만 보존하므로, 장소별 알림 반경은 placeKey 로
        // 별도 보관했다가 결과에 다시 붙인다.
        java.util.Map<String, Double> radiusByKey = new java.util.HashMap<>();
        for (org.json.JSONObject p : input) {
            candidates.add(new RegisteredPlaceResolver.PlaceCandidate(
                p.optString("placeKey", ""),
                p.optString("name", "등록된 장소"),
                p.optString("source", ""),
                p.optDouble("lat", Double.NaN),
                p.optDouble("lng", Double.NaN)));
            double r = p.optDouble("alertRadiusM", Double.NaN);
            if (!Double.isNaN(r) && r > 0) radiusByKey.put(p.optString("placeKey", ""), r);
        }
        java.util.List<org.json.JSONObject> out = new java.util.ArrayList<>();
        for (RegisteredPlaceResolver.PlaceCandidate p : RegisteredPlaceResolver.canonicalize(candidates)) {
            try {
                org.json.JSONObject o = new org.json.JSONObject()
                    .put("placeKey", p.placeKey)
                    .put("source", p.source)
                    .put("name", p.name)
                    .put("lat", p.lat)
                    .put("lng", p.lng);
                Double r = radiusByKey.get(p.placeKey);
                if (r != null) o.put("alertRadiusM", (double) r);
                out.add(o);
            } catch (Exception e) {
                Log.w(TAG, "canonicalizePlaceJson failed", e);
            }
        }
        return out;
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

    @Nullable
    private org.json.JSONObject httpGetObject(String url) {
        String bearer = (accessToken != null && !accessToken.isEmpty()) ? accessToken : supabaseKey;
        try {
            Request req = new Request.Builder().url(url)
                .header("apikey", supabaseKey).header("Authorization", "Bearer " + bearer).get().build();
            Response resp = httpClient.newCall(req).execute();
            if (resp.code() == 401 || resp.code() == 403) {
                resp.close();
                String renewed = networkRefreshAccessToken();
                if (renewed == null || renewed.isEmpty()) return null;
                resp = httpClient.newCall(new Request.Builder().url(url)
                    .header("apikey", supabaseKey).header("Authorization", "Bearer " + renewed).get().build()).execute();
            }
            if (!resp.isSuccessful()) { resp.close(); return null; }
            String body = resp.body() != null ? resp.body().string() : "{}";
            resp.close();
            return new org.json.JSONObject(body);
        } catch (Exception e) { Log.w(TAG, "httpGetObject failed: " + url, e); return null; }
    }

    @Nullable
    private JSONObject findOverlappingScheduledEvent(double placeLat, double placeLng, long fixCapturedAtMs) {
        return findScheduledEventAtPlace(placeLat, placeLng, fixCapturedAtMs, true);
    }

    @Nullable
    private JSONObject findNearbyScheduledEvent(double placeLat, double placeLng, long fixCapturedAtMs) {
        return findScheduledEventAtPlace(placeLat, placeLng, fixCapturedAtMs, false);
    }

    @Nullable
    private JSONObject findScheduledEventAtPlace(
            double placeLat,
            double placeLng,
            long fixCapturedAtMs,
            boolean requireActiveArrivalWindow) {
        String raw = cachedEventsJson;
        if (raw == null || raw.isEmpty()) return null;
        try {
            Calendar atFix = Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul"));
            atFix.setTimeInMillis(fixCapturedAtMs);
            String expectedDateKey = atFix.get(Calendar.YEAR) + "-" + atFix.get(Calendar.MONTH) + "-"
                + atFix.get(Calendar.DAY_OF_MONTH);
            if (!expectedDateKey.equals(cachedEventsDateKey)) return null;
            int nowMinute = atFix.get(Calendar.HOUR_OF_DAY) * 60 + atFix.get(Calendar.MINUTE);
            JSONArray events = new JSONArray(raw);
            JSONObject best = null;
            int bestEventMinute = 0;
            String bestEventId = null;
            for (int i = 0; i < events.length(); i++) {
                JSONObject event = events.optJSONObject(i);
                if (event == null) continue;
                String time = event.optString("event_time", event.optString("time", ""));
                String[] parts = time.split(":");
                if (parts.length != 2) continue;
                int eventMinute;
                try {
                    eventMinute = Integer.parseInt(parts[0]) * 60 + Integer.parseInt(parts[1]);
                } catch (NumberFormatException ignored) {
                    continue;
                }
                JSONObject location = event.optJSONObject("event_location");
                if (location == null) location = event.optJSONObject("location");
                if (location == null) {
                    String locationJson = event.optString("event_location", event.optString("location", ""));
                    if (!locationJson.isEmpty()) location = new JSONObject(locationJson);
                }
                if (location == null || !location.has("lat") || !location.has("lng")) continue;
                boolean matches = requireActiveArrivalWindow
                    ? RegisteredPlaceScheduleOverlapPolicy.shouldSuppress(
                        placeLat,
                        placeLng,
                        location.optDouble("lat", Double.NaN),
                        location.optDouble("lng", Double.NaN),
                        eventMinute,
                        nowMinute)
                    : RegisteredPlaceScheduleOverlapPolicy.shouldAssociate(
                        placeLat,
                        placeLng,
                        location.optDouble("lat", Double.NaN),
                        location.optDouble("lng", Double.NaN),
                        eventMinute,
                        nowMinute);
                if (!matches) continue;
                String eventId = event.optString("event_id", "");
                if (RegisteredPlaceScheduleOverlapPolicy.isBetterCandidate(
                        eventMinute, eventId, bestEventMinute, bestEventId, nowMinute)) {
                    best = event;
                    bestEventMinute = eventMinute;
                    bestEventId = eventId;
                }
            }
            return best;
        } catch (Exception e) {
            Log.w(TAG, "schedule overlap check failed", e);
        }
        return null;
    }

    private void evaluateOnePlace(org.json.JSONObject p, double lat, double lng,
                                  float accuracyM, long fixCapturedAtMs) throws Exception {
        long now = fixCapturedAtMs;
        String placeKey = p.getString("placeKey");
        double plat = p.getDouble("lat"), plng = p.getDouble("lng");
        // 장소별 알림 반경(없으면 null → config 기본 30m). collectPlaces 가 학교류 기본을 채운다.
        double rRaw = p.optDouble("alertRadiusM", Double.NaN);
        Double placeRadius = (!Double.isNaN(rRaw) && rRaw > 0) ? rRaw : null;
        boolean hadGeoState = hasFreshGeoState(placeKey);
        GeofenceStateMachine.GeofenceState prev = loadGeoState(placeKey);
        GeofenceStateMachine.GeofenceState evalState = hadGeoState
            ? prev
            : GeofenceStateMachine.bootstrapInitialInside(
                prev, lat, lng, (double) accuracyM, now, plat, plng, placeRadius, GeofenceStateMachine.GeofenceConfig.DEFAULT);
        // TTL 만료 후 "밖" 상태가 이어지면 sameState 로 저장이 스킵돼 신선도가 영영 회복되지
        // 않고, 이후 첫 도착이 bootstrap 에 무알림으로 삼켜진다 — 부트스트랩 평가를 했으면
        // 값이 같아도 반드시 저장해 TTL 을 갱신한다(도착 알림 유실 방지, 2026-07-10).
        if (!hadGeoState || !sameState(prev, evalState)) saveGeoState(placeKey, evalState);
        GeofenceStateMachine.TransitionResult res = GeofenceStateMachine.evaluateTransition(
            evalState, lat, lng, (double) accuracyM, now, plat, plng, placeRadius, GeofenceStateMachine.GeofenceConfig.DEFAULT);
        // fix 기반 평가가 알림 전이를 내지 않았으면 wall-clock 타이머로 한 번 더 본다. 정지 중
        // 업로드 간격(120초) 때문에 dwell·이탈 타이머가 이미 만족했는데도 다음 fix 가 올 때까지
        // 알림이 밀리던 지연을 없앤다(2026-07-24 실측: 도착 3.5분·출발 2분).
        if (res.action != GeofenceStateMachine.Action.ENTER
            && res.action != GeofenceStateMachine.Action.LEAVE) {
            GeofenceStateMachine.TransitionResult timer = GeofenceStateMachine.evaluateTimer(
                res.nextState, lat, lng, (double) accuracyM, fixCapturedAtMs, System.currentTimeMillis(),
                plat, plng, placeRadius, GeofenceStateMachine.GeofenceConfig.DEFAULT,
                GeofenceStateMachine.TIMER_FIX_FRESH_MS);
            if (!sameState(res.nextState, timer.nextState)) res = timer;
        }
        if (res.action == GeofenceStateMachine.Action.ENTER || res.action == GeofenceStateMachine.Action.LEAVE) {
            final boolean arrived = res.action == GeofenceStateMachine.Action.ENTER;
            long episodeMs = arrived
                ? (res.nextState.firstInsideAtMs != null ? res.nextState.firstInsideAtMs : now)
                : (res.nextState.lastDepartedAtMs != null ? res.nextState.lastDepartedAtMs : now);
            final JSONObject scheduleEvent = arrived ? findOverlappingScheduledEvent(plat, plng, episodeMs) : null;
            final JSONObject scheduleAssociation = arrived
                ? (scheduleEvent != null ? scheduleEvent : findNearbyScheduledEvent(plat, plng, episodeMs))
                : null;
            long bucket = GeofenceIdempotency.placeEpisodeBucket(episodeMs);
            final String occurrenceId = scheduleAssociation != null
                ? scheduleAssociation.optString("event_occurrence_id", "")
                : "";
            final String sourceEventId = scheduleAssociation != null
                ? scheduleAssociation.optString("event_id", "")
                : "";
            final String key = !occurrenceId.isEmpty()
                ? occurrenceId
                : GeofenceIdempotency.placePresenceIdempotencyKey(arrived ? "arrived" : "left", userId, placeKey, bucket);
            String place = p.optString("name", "등록된 장소");
            final String eventTitle = scheduleEvent != null
                ? scheduleEvent.optString("event_title", "일정")
                : "";
            final String alertType = scheduleEvent != null ? "arrived" : (arrived ? "place_arrived" : "place_left");
            final String title = scheduleEvent != null
                ? ("✅ " + eventTitle + " 도착")
                : (arrived ? ("✅ " + place + " 도착") : ("🚶 " + place + " 출발"));
            final String msg = scheduleEvent != null
                ? (childDisplayName() + "가 " + eventTitle + " 장소에 도착했어요.")
                : (arrived
                    ? (childDisplayName() + "가 " + place + "에 도착했어요.")
                    : (childDisplayName() + "가 " + place + "에서 출발했어요."));
            final String fPlaceKey = placeKey;
            final String fPlaceName = place;
            final GeofenceStateMachine.GeofenceState fNext = res.nextState;
            // H1: 전송 성공 시에만 phase 진행(서버 deliverAlert retry 설계 parity). 실패 시
            // state 미진행 → 다음 tick 재시도(멱등키로 dedup, 부모 알림 유실 방지).
            // 상태가 저장되기 전까지는 같은 전이가 다시 평가될 수 있으므로 장소별 in-flight
            // 가드로 잠근다 — 이게 없으면 새 fix 즉시 평가가 같은 알림을 한 번 더 쏜다.
            if (!placeAlertInFlight.add(fPlaceKey)) return;
            try {
            runOnNetworkThread("place_alert", () -> {
                try {
                    if (sendPlaceAlert(alertType, title, msg, key, episodeMs, sourceEventId, fPlaceKey)) {
                        if (!occurrenceId.isEmpty()) {
                            shownEventNotifs.add(occurrenceId + "-arrived");
                            persistShownEventNotifs();
                        }
                        saveGeoState(fPlaceKey, fNext);
                        // 집 도착이면 AI 친구가 먼저 말을 건다(숙제·하루 이야기).
                        if (arrived && fPlaceName.contains("집")) triggerHomeArrivalAiGreeting(fPlaceName);
                    }
                } finally {
                    placeAlertInFlight.remove(fPlaceKey);
                }
            });
            } catch (Throwable t) {
                // 스레드 제출 자체가 실패하면 람다의 finally 가 돌지 않아 잠금이 영구히 남는다
                // → 그 장소는 앱 재시작까지 알림이 끊긴다. 여기서 반드시 풀어준다.
                placeAlertInFlight.remove(fPlaceKey);
                Log.w(TAG, "place alert dispatch failed", t);
            }
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

    // place_arrived/place_left 부모 알림 발송. 서버 단일 endpoint가 event_id+alert_type
    // 멱등 저장과 부모 FCM을 함께 처리한다. 실패 시 state를 진행하지 않아 다음 tick 재시도한다.
    private boolean sendPlaceAlert(String alertType, String title, String message, String idemUuid,
                                   long occurredAtMs, @Nullable String sourceEventId, @Nullable String placeKey) {
        if (isBlank(familyId) || isBlank(supabaseUrl) || isBlank(supabaseKey)) return false;
        final String base = supabaseUrl.replaceAll("/+$", "");
        try {
            JSONObject alertBody = RegisteredPlaceAlertPayload.build(
                familyId,
                alertType,
                title,
                message,
                idemUuid,
                userId,
                occurredAtMs,
                sourceEventId,
                placeKey
            );
            boolean delivered = postWithAuthRetry(base + "/api/parent-alerts", alertBody.toString());
            Log.i(TAG, "place alert " + alertType + " accepted=" + delivered);
            return delivered;
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
        SessionTokenStore.Snapshot session = SessionTokenStore.read(prefs);
        if (!session.accessToken.isEmpty() && !session.accessToken.equals(accessToken)) {
            accessToken = session.accessToken;
            Log.i(TAG, "Access token refreshed from SharedPreferences");
        }
        // 포그라운드에서 WebView 가 updateToken 으로 새 refresh token 을 써둘 수 있으므로 동기화.
        if (!session.refreshToken.isEmpty() && !session.refreshToken.equals(refreshToken)) {
            refreshToken = session.refreshToken;
        }
    }

    private final Object refreshLock = new Object();
    private volatile long lastNetworkRefreshAtMs = 0L;

    private void stopForInvalidSession(String reason) {
        Log.w(TAG, "Stopping location service due to invalid session: " + reason);
        SessionTokenStore.setServiceEnabled(
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE),
            false
        );
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
            synchronized (SessionTokenStore.class) {
                SessionTokenStore.Snapshot beforeRefresh = SessionTokenStore.read(prefs);
                String prefAccess = beforeRefresh.accessToken;
                if (!prefAccess.isEmpty() && !prefAccess.equals(failedToken)) {
                    accessToken = prefAccess;
                    if (!beforeRefresh.refreshToken.isEmpty()) refreshToken = beforeRefresh.refreshToken;
                    return prefAccess;
                }
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
            final long refreshGeneration = SessionTokenStore.generation();
            SessionTokenStore.Snapshot refreshStart = SessionTokenStore.read(prefs);
            if (refreshStart.accessToken.isEmpty() && refreshStart.refreshToken.isEmpty()) return null;
            try {
                String url = supabaseUrl.replaceAll("/+$", "") + "/auth/refresh";
                JSONObject reqBody = new JSONObject();
                reqBody.put("refresh_token", refreshToken);
                // 기기 바인딩 회전 — WebView 와 같은 deviceInstallId 를 제시해야
                // 스탬핑된 체인이 회전된다(세션 사본의 회전으로 기기가 고아 되는 것 방지).
                String deviceInstallId = prefs.getString("deviceInstallId", null);
                if (deviceInstallId != null && !deviceInstallId.isEmpty()) {
                    reqBody.put("device_install_id", deviceInstallId);
                }
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
                    synchronized (SessionTokenStore.class) {
                        SessionTokenStore.Snapshot afterRefreshAttempt = SessionTokenStore.read(prefs);
                        String afterAccess = afterRefreshAttempt.accessToken;
                        if (!afterAccess.isEmpty() && !afterAccess.equals(failedToken)) {
                            accessToken = afterAccess;
                            if (!afterRefreshAttempt.refreshToken.isEmpty()) {
                                refreshToken = afterRefreshAttempt.refreshToken;
                            }
                            Log.i(TAG, "Adopted WebView-refreshed token from prefs after refresh race");
                            return afterAccess;
                        }
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
                synchronized (SessionTokenStore.class) {
                    SessionTokenStore.Snapshot storedSession = SessionTokenStore.reconcileIfGeneration(
                        prefs,
                        newAccess,
                        newRefresh,
                        true,
                        refreshGeneration,
                        userId,
                        familyId,
                        role
                    );
                    if (storedSession == null) {
                        Log.i(TAG, "Ignored network refresh response after explicit session clear");
                        return null;
                    }
                    accessToken = storedSession.accessToken;
                    refreshToken = storedSession.refreshToken;
                }
                lastNetworkRefreshAtMs = System.currentTimeMillis();
                Log.i(TAG, "Access token network-refreshed via /auth/refresh");
                return accessToken;
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
        // wall clock 수동/네트워크 보정은 정지 시간을 되감거나 급증시킬 수 있다.
        long now = android.os.SystemClock.elapsedRealtime();

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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACTIVITY_RECOGNITION)
                    != PackageManager.PERMISSION_GRANTED) {
                Log.i(TAG, "ACTIVITY_RECOGNITION not granted — vehicle wake disabled (significant-motion only)");
                return;
            }
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
            ContextCompat.registerReceiver(
                this,
                activityTransitionReceiver,
                new IntentFilter(ACTION_ACTIVITY_TRANSITION),
                ContextCompat.RECEIVER_NOT_EXPORTED
            );

            requestActivityTransitionUpdates(request);
        } catch (Exception error) {
            Log.w(TAG, "setupActivityTransitionTracking failed", error);
        }
    }

    /**
     * Android 10+는 호출 직전 권한 확인 뒤에만 진입한다. Android 9 이하는 해당
     * 런타임 권한이 없으며, 호출 중 권한이 바뀌는 경합도 SecurityException으로 닫는다.
     */
    @SuppressLint("MissingPermission")
    private void requestActivityTransitionUpdates(ActivityTransitionRequest request) {
        try {
            ActivityRecognition.getClient(this)
                .requestActivityTransitionUpdates(request, activityTransitionPendingIntent)
                .addOnSuccessListener(ignored -> Log.i(TAG, "Activity transition updates registered"))
                .addOnFailureListener(error -> Log.w(TAG, "Activity transition register failed", error));
            activityTransitionRegistered = true;
        } catch (SecurityException error) {
            if (activityTransitionReceiver != null) {
                unregisterReceiver(activityTransitionReceiver);
                activityTransitionReceiver = null;
            }
            Log.w(TAG, "Activity transition permission changed before registration", error);
        }
    }

    private void teardownActivityTransitionTracking() {
        if (!activityTransitionRegistered) return;
        removeActivityTransitionUpdatesIfPermitted();
        try {
            if (activityTransitionReceiver != null) unregisterReceiver(activityTransitionReceiver);
        } catch (Exception ignored) {
            // receiver may not be registered
        }
        activityTransitionReceiver = null;
        activityTransitionRegistered = false;
    }

    @SuppressLint("MissingPermission")
    private void removeActivityTransitionUpdatesIfPermitted() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                && ContextCompat.checkSelfPermission(this, Manifest.permission.ACTIVITY_RECOGNITION)
                    != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        try {
            if (activityTransitionPendingIntent != null) {
                ActivityRecognition.getClient(this)
                    .removeActivityTransitionUpdates(activityTransitionPendingIntent);
            }
        } catch (SecurityException ignored) {
            // 권한이 확인 직후 회수되면 해제 요청만 건너뛴다.
        }
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
                long nowElapsedRealtimeNanos = android.os.SystemClock.elapsedRealtimeNanos();
                long ageMs = lastLocationAcceptedElapsedRealtimeNanos > 0L
                    ? Math.max(
                        0L,
                        (nowElapsedRealtimeNanos - lastLocationAcceptedElapsedRealtimeNanos) / 1_000_000L
                    )
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

    private void registerLocationRefreshRequest(@Nullable String requestId,
                                                @Nullable String pendingNotificationId) {
        if (isBlank(requestId)) return;
        String normalizedRequestId = requestId.trim();
        pendingLocationRefreshRequests.putIfAbsent(
            normalizedRequestId,
            android.os.SystemClock.elapsedRealtime()
        );
        if (!isBlank(pendingNotificationId)) {
            pendingLocationNotificationIds
                .computeIfAbsent(normalizedRequestId, ignored -> ConcurrentHashMap.newKeySet())
                .add(pendingNotificationId.trim());
        }
    }

    private void requestImmediateLocationFix() {
        requestImmediateLocationFix(null, null);
    }

    private void requestEventEvidenceLocationFix() {
        long nowElapsed = android.os.SystemClock.elapsedRealtime();
        long previous = lastEventEvidenceFixRequestElapsedMs;
        if (previous > 0L && nowElapsed - previous < EVENT_EVIDENCE_FIX_MIN_INTERVAL_MS) return;
        lastEventEvidenceFixRequestElapsedMs = nowElapsed;
        requestImmediateLocationFix();
    }

    private void requestImmediateLocationFix(@Nullable String requestId,
                                             @Nullable String pendingNotificationId) {
        registerLocationRefreshRequest(requestId, pendingNotificationId);

        final int generation;
        final Runnable deadlineTask;
        synchronized (immediateFixStateLock) {
            if (serviceStopping) {
                Log.d(TAG, "Immediate location fix ignored while service is stopping");
                return;
            }
            if (!immediateFixInFlight.compareAndSet(false, true)) {
                Log.d(TAG, "Immediate location fix already in flight — duplicate wake merged");
                return;
            }
            generation = immediateFixGenerationCounter.incrementAndGet();
            activeImmediateFixGeneration = generation;
            activeLocationRefreshRequestIds = Collections.unmodifiableSet(
                new HashSet<>(pendingLocationRefreshRequests.keySet())
            );
            long notBeforeElapsedMs = 0L;
            for (String activeRequestId : activeLocationRefreshRequestIds) {
                Long requestedAtElapsedMs = pendingLocationRefreshRequests.get(activeRequestId);
                if (requestedAtElapsedMs != null) {
                    notBeforeElapsedMs = Math.max(notBeforeElapsedMs, requestedAtElapsedMs);
                }
            }
            activeLocationRefreshNotBeforeElapsedMs = notBeforeElapsedMs;
            deadlineTask = () -> {
                if (!isImmediateFixGenerationActive(generation)) return;
                Log.e(TAG, "Immediate location fix chain exceeded hard deadline; generation=" + generation);
                finishImmediateLocationFix(generation);
            };
            immediateFixDeadlineTask = deadlineTask;
            handler.postDelayed(deadlineTask, IMMEDIATE_FIX_CHAIN_DEADLINE_MS);
        }

        acquireFixWakeLock();
        requestHighAccuracyLocationFix(generation);
    }

    private void requestHighAccuracyLocationFix(int generation) {
        if (!isImmediateFixGenerationActive(generation)) return;
        final CancellationTokenSource cts = new CancellationTokenSource();
        final AtomicBoolean stageFinished = new AtomicBoolean(false);
        final Runnable timeoutTask = () -> {
            if (!stageFinished.compareAndSet(false, true)
                    || !isImmediateFixGenerationActive(generation)) return;
            Log.w(TAG, "High-accuracy fix timed out (12s), falling back to balanced power");
            cts.cancel();
            requestBalancedLocationFix(generation);
        };
        try {
            synchronized (immediateFixStateLock) {
                if (!isImmediateFixGenerationActive(generation)) return;
                activeHighAccuracyFixToken = cts;
            }
            CurrentLocationRequest request = new CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setMaxUpdateAgeMillis(0L)
                .setDurationMillis(HIGH_ACCURACY_FIX_TIMEOUT_MS)
                .build();
            handler.postDelayed(timeoutTask, HIGH_ACCURACY_FIX_TIMEOUT_MS);
            fusedClient.getCurrentLocation(request, cts.getToken())
                .addOnSuccessListener(location -> {
                    if (!stageFinished.compareAndSet(false, true)) return;
                    handler.removeCallbacks(timeoutTask);
                    if (!isImmediateFixGenerationActive(generation)) return;
                    if (location != null && handleLocation(location, true, generation)) {
                        return;
                    }
                    // provider가 오래된 cache를 돌려준 경우에도 성공으로 끝내지 않고
                    // Wi-Fi/Cell 기반의 새 fix를 다시 요구한다.
                    requestBalancedLocationFix(generation);
                })
                .addOnFailureListener(error -> {
                    if (!stageFinished.compareAndSet(false, true)) return;
                    handler.removeCallbacks(timeoutTask);
                    if (!isImmediateFixGenerationActive(generation)) return;
                    Log.w(TAG, "Immediate high-accuracy request failed", error);
                    requestBalancedLocationFix(generation);
                });
        } catch (SecurityException error) {
            handler.removeCallbacks(timeoutTask);
            Log.e(TAG, "Location permission not granted for immediate fix", error);
            finishImmediateLocationFix(generation);
        } catch (RuntimeException error) {
            handler.removeCallbacks(timeoutTask);
            Log.e(TAG, "Immediate high-accuracy request could not start", error);
            finishImmediateLocationFix(generation);
        }
    }

    private void requestBalancedLocationFix(int generation) {
        if (!isImmediateFixGenerationActive(generation)) return;
        final CancellationTokenSource cts = new CancellationTokenSource();
        final AtomicBoolean stageFinished = new AtomicBoolean(false);
        final Runnable timeoutTask = () -> {
            if (!stageFinished.compareAndSet(false, true)
                    || !isImmediateFixGenerationActive(generation)) return;
            Log.w(TAG, "Balanced location fix timed out (12s), trying last known fix");
            cts.cancel();
            requestLastKnownLocationUpload("balanced_location_timeout", generation);
        };
        try {
            synchronized (immediateFixStateLock) {
                if (!isImmediateFixGenerationActive(generation)) return;
                activeBalancedFixToken = cts;
            }
            CurrentLocationRequest request = new CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_BALANCED_POWER_ACCURACY)
                .setMaxUpdateAgeMillis(0L)
                .setDurationMillis(BALANCED_FIX_TIMEOUT_MS)
                .build();
            handler.postDelayed(timeoutTask, BALANCED_FIX_TIMEOUT_MS);
            fusedClient.getCurrentLocation(request, cts.getToken())
                .addOnSuccessListener(location -> {
                    if (!stageFinished.compareAndSet(false, true)) return;
                    handler.removeCallbacks(timeoutTask);
                    if (!isImmediateFixGenerationActive(generation)) return;
                    if (location != null && handleLocation(location, true, generation)) {
                        return;
                    }
                    requestLastKnownLocationUpload("balanced_location_unusable", generation);
                })
                .addOnFailureListener(error -> {
                    if (!stageFinished.compareAndSet(false, true)) return;
                    handler.removeCallbacks(timeoutTask);
                    if (!isImmediateFixGenerationActive(generation)) return;
                    Log.w(TAG, "Balanced location request failed", error);
                    requestLastKnownLocationUpload("balanced_location_failed", generation);
                });
        } catch (SecurityException error) {
            handler.removeCallbacks(timeoutTask);
            Log.e(TAG, "Location permission not granted for balanced fix", error);
            finishImmediateLocationFix(generation);
        } catch (RuntimeException error) {
            handler.removeCallbacks(timeoutTask);
            Log.e(TAG, "Balanced location request could not start", error);
            finishImmediateLocationFix(generation);
        }
    }

    private boolean isImmediateFixGenerationActive(int generation) {
        return generation > 0
            && immediateFixInFlight.get()
            && activeImmediateFixGeneration == generation
            && !serviceStopping;
    }

    private boolean isServiceLifecycleActive(int lifecycleEpoch) {
        return !serviceStopping && serviceLifecycleEpoch.get() == lifecycleEpoch;
    }

    private boolean finishImmediateLocationFix(int generation) {
        return transitionImmediateLocationFix(generation, false);
    }

    private boolean completeImmediateLocationFix(int generation) {
        return transitionImmediateLocationFix(generation, true);
    }

    private boolean transitionImmediateLocationFix(int generation, boolean uploaded) {
        boolean hasUnattemptedRequest = false;
        JSONArray deliveredNotificationIds = new JSONArray();
        synchronized (immediateFixStateLock) {
            if (serviceStopping
                    || generation != activeImmediateFixGeneration
                    || !immediateFixInFlight.get()) return false;
            Set<String> attemptedRequestIds = activeLocationRefreshRequestIds;
            if (uploaded) {
                // 성공 completion claim과 stopAll/deadline을 같은 lock에서 직렬화한다.
                // 이 블록을 먼저 획득한 쪽만 generation의 ACK 권한을 가진다.
                for (String requestId : attemptedRequestIds) {
                    PolledNotificationStore.markAck(this, requestId);
                    pendingLocationRefreshRequests.remove(requestId);
                    Set<String> notificationIds = pendingLocationNotificationIds.remove(requestId);
                    if (notificationIds == null) continue;
                    for (String notificationId : notificationIds) {
                        if (!isBlank(notificationId)) deliveredNotificationIds.put(notificationId);
                    }
                }
            }
            for (String pendingRequestId : pendingLocationRefreshRequests.keySet()) {
                if (!attemptedRequestIds.contains(pendingRequestId)) {
                    hasUnattemptedRequest = true;
                    break;
                }
            }
            if (immediateFixDeadlineTask != null) {
                handler.removeCallbacks(immediateFixDeadlineTask);
                immediateFixDeadlineTask = null;
            }
            if (activeHighAccuracyFixToken != null) {
                activeHighAccuracyFixToken.cancel();
                activeHighAccuracyFixToken = null;
            }
            if (activeBalancedFixToken != null) {
                activeBalancedFixToken.cancel();
                activeBalancedFixToken = null;
            }
            activeLocationRefreshRequestIds = Collections.emptySet();
            activeLocationRefreshNotBeforeElapsedMs = 0L;
            activeImmediateFixGeneration = 0;
            immediateFixInFlight.set(false);
        }
        releaseScopedWakeLock(fixWakeLock);
        if (deliveredNotificationIds.length() > 0) {
            runOnNetworkThread(
                "location_refresh_ack",
                () -> markDelivered(deliveredNotificationIds)
            );
        }
        if (hasUnattemptedRequest && !serviceStopping) {
            handler.post(this::requestImmediateLocationFix);
        }
        return true;
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
                        row.put("accuracy_m", point.accuracy);
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

    private void requestLastKnownLocationUpload(String reason, int generation) {
        if (!isImmediateFixGenerationActive(generation)) return;
        final AtomicBoolean stageFinished = new AtomicBoolean(false);
        final Runnable timeoutTask = () -> {
            if (!stageFinished.compareAndSet(false, true)
                    || !isImmediateFixGenerationActive(generation)) return;
            Log.w(TAG, "Last known location request timed out after " + reason);
            finishImmediateLocationFix(generation);
        };
        try {
            handler.postDelayed(timeoutTask, LAST_KNOWN_FIX_TIMEOUT_MS);
            fusedClient.getLastLocation()
                .addOnSuccessListener(location -> {
                    if (!stageFinished.compareAndSet(false, true)) return;
                    handler.removeCallbacks(timeoutTask);
                    if (!isImmediateFixGenerationActive(generation)) return;
                    if (location == null) {
                        Log.w(TAG, "Last known location unavailable after " + reason);
                        finishImmediateLocationFix(generation);
                        return;
                    }
                    Log.i(TAG, "Uploading last known location after " + reason);
                    if (!handleLocation(location, true, generation)) {
                        finishImmediateLocationFix(generation);
                    }
                })
                .addOnFailureListener(error -> {
                    if (!stageFinished.compareAndSet(false, true)) return;
                    handler.removeCallbacks(timeoutTask);
                    if (!isImmediateFixGenerationActive(generation)) return;
                    Log.w(TAG, "Last known location request failed", error);
                    finishImmediateLocationFix(generation);
                });
        } catch (SecurityException error) {
            handler.removeCallbacks(timeoutTask);
            Log.e(TAG, "Location permission not granted for last known location", error);
            finishImmediateLocationFix(generation);
        } catch (RuntimeException error) {
            handler.removeCallbacks(timeoutTask);
            Log.e(TAG, "Last known location request could not start", error);
            finishImmediateLocationFix(generation);
        }
    }

    private void handleLocation(Location location, boolean forceUpload) {
        handleLocation(location, forceUpload, 0);
    }

    private boolean handleLocation(Location location, boolean forceUpload, int refreshGeneration) {
        if (location == null) return false;

        long receivedAtMs = System.currentTimeMillis();
        long receivedElapsedRealtimeNanos = android.os.SystemClock.elapsedRealtimeNanos();
        long capturedAtMs = LocationFixPolicy.resolveCapturedAtMs(
            location.getTime(),
            location.getElapsedRealtimeNanos(),
            receivedAtMs,
            receivedElapsedRealtimeNanos
        );
        long providerElapsedRealtimeNanos = location.getElapsedRealtimeNanos();
        long providerElapsedRealtimeMs = providerElapsedRealtimeNanos > 0L
            ? providerElapsedRealtimeNanos / 1_000_000L
            : 0L;
        if (refreshGeneration > 0
                && activeLocationRefreshNotBeforeElapsedMs > 0L
                && providerElapsedRealtimeMs > 0L
                && providerElapsedRealtimeMs < activeLocationRefreshNotBeforeElapsedMs) {
            Log.w(TAG, "Location fix predates active refresh request; generation=" + refreshGeneration);
            return false;
        }
        if (forceUpload && !LocationFixPolicy.isFreshForLiveRefresh(capturedAtMs, receivedAtMs)) {
            Log.w(TAG, "Stale cached location rejected for live refresh: age="
                + Math.max(0L, receivedAtMs - capturedAtMs) + "ms");
            return false;
        }

        float accuracy = location.getAccuracy();
        // NTV-H8: manual refresh (forceUpload=true) 는 아이가 실내에 있어 GPS 가 부정확해도
        // "가장 최근의 최선(best-effort)" 위치를 부모에게 보여줘야 함.
        // 기존 50m 는 실외 전용 수준이라, 200m 로 완화하되 forceUpload 시에는 필터를 아예 건너뛴다.
        if (accuracy > MAX_ACCURACY_M && !forceUpload) {
            Log.w(TAG, "Location rejected: accuracy " + String.format("%.0f", accuracy)
                + "m exceeds " + (int) MAX_ACCURACY_M + "m threshold");
            return false;
        }
        if (accuracy > 200f && forceUpload) {
            Log.w(TAG, "Location accuracy is poor (" + String.format("%.0f", accuracy)
                + "m) but forcing upload per parent request");
        }

        final double lat;
        final double lng;
        synchronized (locationStateLock) {
            // 비동기 provider 콜백이 역순으로 도착하면 오래된 fix가 Kalman·정지 판정·
            // history 기준점을 과거로 되감는다. 모든 가변 상태를 건드리기 전에 차단한다.
            if (LocationFixPolicy.isOutOfOrder(
                    capturedAtMs,
                    lastLocationAcceptedAtMs,
                    providerElapsedRealtimeNanos,
                    lastLocationAcceptedElapsedRealtimeNanos)) {
                Log.w(TAG, "Out-of-order location fix rejected: capturedAt=" + capturedAtMs
                    + ", lastAcceptedAt=" + lastLocationAcceptedAtMs);
                return false;
            }
            if (LocationFixPolicy.isDuplicateAcceptedFix(
                    capturedAtMs,
                    lastLocationAcceptedAtMs,
                    providerElapsedRealtimeNanos,
                    lastLocationAcceptedElapsedRealtimeNanos,
                    forceUpload,
                    lastLocationAcceptedWasForceUpload)) {
                Log.d(TAG, "Duplicate provider fix merged before upload: capturedAt=" + capturedAtMs);
                return false;
            }

            double[] filtered = applyKalmanFilter(
                location.getLatitude(),
                location.getLongitude(),
                accuracy
            );
            lat = filtered[0];
            lng = filtered[1];

            updateStationaryState(location);
            lastLocationAcceptedAtMs = Math.max(lastLocationAcceptedAtMs, capturedAtMs);
            if (providerElapsedRealtimeNanos > 0L) {
                lastLocationAcceptedElapsedRealtimeNanos = Math.max(
                    lastLocationAcceptedElapsedRealtimeNanos,
                    providerElapsedRealtimeNanos
                );
            }
            lastLocationAcceptedWasForceUpload = forceUpload;
            if (!forceUpload && !Double.isNaN(lastUploadedLat)) {
                float distFromLast = distanceBetween(lat, lng, lastUploadedLat, lastUploadedLng);
                long ageMs = providerElapsedRealtimeNanos > 0L
                        && lastUploadedElapsedRealtimeNanos > 0L
                    ? (providerElapsedRealtimeNanos - lastUploadedElapsedRealtimeNanos) / 1_000_000L
                    : capturedAtMs - lastUploadedAtMs;
                if (distFromLast < MIN_UPLOAD_DISTANCE_M && ageMs < activeMaxUploadAgeMs) {
                    Log.d(TAG, "Skipping upload: moved "
                        + String.format("%.1f", distFromLast) + "m, age="
                        + (ageMs / 1000) + "s");
                    return false;
                }
            }
        }

        Log.d(TAG, "Location update: accuracy=" + String.format("%.0f", accuracy)
            + "m, stationary=" + isStationary + ", force=" + forceUpload);
        uploadLocation(
            lat,
            lng,
            accuracy,
            capturedAtMs,
            LocationFixPolicy.resolveFixAgeMs(capturedAtMs, receivedAtMs),
            receivedElapsedRealtimeNanos / 1_000_000L,
            providerElapsedRealtimeNanos,
            refreshGeneration
        );
        return true;
    }

    private void uploadLocation(double lat, double lng, float accuracy, long capturedAtMs,
                                long fixAgeMs, long receivedElapsedRealtimeMs,
                                long fixElapsedRealtimeNanos,
                                int refreshGeneration) {
        if (serviceStopping) return;
        final int uploadLifecycleEpoch = serviceLifecycleEpoch.get();
        if (!isServiceLifecycleActive(uploadLifecycleEpoch)) return;
        runOnNetworkThread("upload", () -> {
            int generationToFinish = refreshGeneration;
            try {
                if (!isServiceLifecycleActive(uploadLifecycleEpoch)
                        || (generationToFinish > 0
                            && !isImmediateFixGenerationActive(generationToFinish))) {
                    generationToFinish = 0;
                    return;
                }
                JSONObject body = new JSONObject();
                body.put("p_user_id", userId);
                body.put("p_family_id", familyId);
                body.put("p_lat", lat);
                body.put("p_lng", lng);
                body.put("p_recorded_at", formatIsoUtc(capturedAtMs));
                body.put("p_accuracy", accuracy);
                // Worker는 이 monotonic 기반 age로 serverNow-age를 계산할 수 있어,
                // 아이 기기 wall clock이 틀려도 정상 fix를 미래 시각으로 거절하지 않는다.
                long queuedAgeMs = Math.max(
                    0L,
                    android.os.SystemClock.elapsedRealtime() - receivedElapsedRealtimeMs
                );
                body.put("p_fix_age_ms", Math.max(0L, fixAgeMs) + queuedAgeMs);

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
                if (!isServiceLifecycleActive(uploadLifecycleEpoch)
                        || (generationToFinish > 0
                            && !isImmediateFixGenerationActive(generationToFinish))) {
                    generationToFinish = 0;
                    return;
                }

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
                    if (!isServiceLifecycleActive(uploadLifecycleEpoch)
                            || (generationToFinish > 0
                                && !isImmediateFixGenerationActive(generationToFinish))) {
                        generationToFinish = 0;
                        return;
                    }

                    if (code2 == 401 || code2 == 403) {
                        // 3차 시도: refresh token 으로 access token 을 네트워크 갱신 후 재시도.
                        // (D1 컷오버 후 백그라운드 1h 만료의 핵심 복구 경로. anon key 폴백은
                        //  Worker rest-shim 이 ES256 access 만 받으므로 무효 → 제거.)
                        String renewed = networkRefreshAccessToken();
                        if (renewed != null && !renewed.isEmpty()) {
                            if (!isServiceLifecycleActive(uploadLifecycleEpoch)
                                    || (generationToFinish > 0
                                        && !isImmediateFixGenerationActive(generationToFinish))) {
                                generationToFinish = 0;
                                return;
                            }
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
                if (generationToFinish > 0) {
                    boolean completionClaimed = uploaded
                        ? completeImmediateLocationFix(generationToFinish)
                        : finishImmediateLocationFix(generationToFinish);
                    generationToFinish = 0;
                    if (!completionClaimed) return;
                }
                synchronized (immediateFixStateLock) {
                    if (!isServiceLifecycleActive(uploadLifecycleEpoch)) return;
                    boolean acceptedAsLatestUpload = false;
                    synchronized (locationStateLock) {
                        boolean newerThanLastUpload = fixElapsedRealtimeNanos > 0L
                                && lastUploadedElapsedRealtimeNanos > 0L
                            ? fixElapsedRealtimeNanos > lastUploadedElapsedRealtimeNanos
                            : capturedAtMs > lastUploadedAtMs;
                        if (uploaded && newerThanLastUpload) {
                            lastUploadedLat = lat;
                            lastUploadedLng = lng;
                            lastUploadedAccuracyM = accuracy;
                            lastUploadedAtMs = capturedAtMs;
                            lastUploadedElapsedRealtimeNanos = fixElapsedRealtimeNanos;
                            acceptedAsLatestUpload = true;
                        }
                    }
                    if (acceptedAsLatestUpload) {
                        // stopAll과 같은 lock 안에서 prefs/broadcast까지 commit해
                        // lifecycle 확인 직후 종료되는 TOCTOU를 막는다.
                        try {
                            getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
                                .putString("last_uploaded_lat", String.valueOf(lat))
                                .putString("last_uploaded_lng", String.valueOf(lng))
                                .putFloat("last_uploaded_accuracy_m", accuracy)
                                .putLong("last_uploaded_at_ms", capturedAtMs)
                                .apply();
                        } catch (Exception persistErr) {
                            Log.w(TAG, "last-location prefs persist failed", persistErr);
                        }
                        broadcastLocation(lat, lng, accuracy, capturedAtMs);
                        // 새 fix 를 채택했으면 60초 tick 을 기다리지 않고 바로 재평가한다.
                        // 도착·출발 확정이 최대 tick 주기만큼 밀리던 지연을 없앤다(2026-07-24).
                        // 계산만 하는 경로라 배터리 영향은 없고, 발사 경합은 placeAlertInFlight 가 막는다.
                        if (handler != null) {
                            handler.post(() -> {
                                try { tickPlaceGeofence(); }
                                catch (Exception e) { Log.w(TAG, "place geofence immediate tick failed", e); }
                            });
                        }
                    }
                }

                // 이동경로 점 — 서버 성공 전 로컬 큐에 먼저 적재한다.
                // 온라인 업로드 성공 후에만 방금 적재한 동일 점을 제거하므로, 앱 종료/
                // 네트워크 전환/프로세스 킬 타이밍에도 원본 GPS 점이 기기에 남는다.
                final int pendingBefore;
                final boolean queued;
                synchronized (immediateFixStateLock) {
                    if (!isServiceLifecycleActive(uploadLifecycleEpoch)) return;
                    if (!shouldRecordLocationHistory(
                        lat,
                        lng,
                        capturedAtMs,
                        fixElapsedRealtimeNanos)) return;
                    pendingBefore = LocationBuffer.size(locationBufferFile);
                    queued = LocationBuffer.append(locationBufferFile, lat, lng, accuracy, capturedAtMs);
                }
                boolean historyRecorded = uploaded
                    && !isBlank(successfulBearer)
                    && uploadLocationHistory(lat, lng, accuracy, capturedAtMs, successfulBearer);
                synchronized (immediateFixStateLock) {
                    if (!isServiceLifecycleActive(uploadLifecycleEpoch)) return;
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
                    synchronized (locationStateLock) {
                        boolean newerThanLastHistory = fixElapsedRealtimeNanos > 0L
                                && lastHistoryElapsedRealtimeNanos > 0L
                            ? fixElapsedRealtimeNanos > lastHistoryElapsedRealtimeNanos
                            : capturedAtMs > lastHistoryAtMs;
                        if (newerThanLastHistory) {
                            lastHistoryLat = lat;
                            lastHistoryLng = lng;
                            lastHistoryAtMs = capturedAtMs;
                            lastHistoryElapsedRealtimeNanos = fixElapsedRealtimeNanos;
                        }
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Location upload error", e);
            } finally {
                if (generationToFinish > 0) {
                    finishImmediateLocationFix(generationToFinish);
                }
            }
        });
    }

    private String formatIsoUtc(long timeMs) {
        java.text.SimpleDateFormat iso = new java.text.SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        return iso.format(new java.util.Date(timeMs));
    }

    private boolean shouldRecordLocationHistory(double lat, double lng, long capturedAtMs,
                                                long fixElapsedRealtimeNanos) {
        synchronized (locationStateLock) {
            boolean outOfOrder = fixElapsedRealtimeNanos > 0L
                    && lastHistoryElapsedRealtimeNanos > 0L
                ? fixElapsedRealtimeNanos < lastHistoryElapsedRealtimeNanos
                : capturedAtMs < lastHistoryAtMs;
            if (outOfOrder) return false;
            if (Double.isNaN(lastHistoryLat)) return true;
            float distFromLastHistory = distanceBetween(lat, lng, lastHistoryLat, lastHistoryLng);
            long ageMs = fixElapsedRealtimeNanos > 0L
                    && lastHistoryElapsedRealtimeNanos > 0L
                ? (fixElapsedRealtimeNanos - lastHistoryElapsedRealtimeNanos) / 1_000_000L
                : capturedAtMs - lastHistoryAtMs;
            return distFromLastHistory >= MIN_HISTORY_DISTANCE_M || ageMs >= activeMaxHistoryAgeMs;
        }
    }

    private boolean uploadLocationHistory(double lat, double lng, float accuracy,
                                          long capturedAtMs, String bearerToken) {
        if (isBlank(userId) || isBlank(familyId) || isBlank(supabaseUrl) || isBlank(supabaseKey) || isBlank(bearerToken)) {
            return false;
        }
        try {
            JSONArray body = buildLocationHistoryRows(lat, lng, accuracy, capturedAtMs);
            return uploadLocationHistoryRows(body, bearerToken);
        } catch (Exception e) {
            Log.w(TAG, "Location history insert error", e);
            return false;
        }
    }

    private JSONArray buildLocationHistoryRows(double lat, double lng, float accuracy,
                                               long capturedAtMs) throws Exception {
        List<RoutePoint> points = new ArrayList<>();
        boolean hasPrevious = !Double.isNaN(lastHistoryLat) && !Double.isNaN(lastHistoryLng) && lastHistoryAtMs > 0L;
        // 도로매칭(Kakao kakao-proxy) 네트워크 호출은 갭이 큰(>150m) 구간에서만 의미가 있다.
        // 현재 도보 도로매칭은 affiliate 권한(403)으로 실패 중이라 매칭 결과가 비어, 조밀 구간
        // (<=150m)은 아래 else 가 조밀 raw GPS 직선으로 기록한다 → 갭 게이트 적용 시 <=150m 에서
        // 무손실(어차피 매칭 결과가 없음). fix 마다 반복되던 Kakao 라운드트립(라디오 깨움)만 제거.
        // ⚠ 도로매칭이 복구되면 이 게이트가 <=150m 곡선을 직선화하므로 재검토 필요(>150m 는 영향 없음).
        if (hasPrevious
                && distanceBetween(lastHistoryLat, lastHistoryLng, lat, lng) > ROUTE_MATCH_MIN_GAP_M) {
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
        } else {
            // 도로매칭 실패(또는 조밀 캡처): 실측 endpoint 만 기록한다.
            // 2026-07-30: 갭이 큰 구간을 12m 간격 직선으로 메우던 '추정 채움점'(is_estimated=1)을
            // 더 만들지 않는다. 채움점은 두 실측점 사이 직선 위의 합성점이라 부모 화면이 실측점을
            // 실선으로 이으면 기하가 같고, 머문 곳·방문·출발 근거에서도 이미 제외돼 소비자가 없었다.
            // 실측(2026-07-29 15:30~19:30): 1448행 중 1028행이 채움점 → 업로드·D1 행이 3배로 불었다.
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
            // 업로드하는 모든 점은 실측 GPS fix 또는 도로매칭 결과다(합성 채움점을 만들지 않는다).
            if (i == lastIndex && Float.isFinite(accuracy) && accuracy >= 0f) {
                row.put("accuracy_m", accuracy);
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
                body.put("p_role", role);

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
                    String alertType = data != null
                        ? data.optString("alertType", data.optString("alert_type", ""))
                        : "";
                    boolean emergency = isEmergencyNotification(type, data);
                    String stableId = data != null
                        ? firstNonBlank(
                            data.optString("pushId", ""),
                            data.optString("idempotencyKey", ""),
                            data.optString("idempotency_key", ""),
                            data.optString("requestId", ""),
                            id
                        )
                        : id;
                    if (!isPendingTargetedToThisDevice(data)) {
                        Log.d(TAG, "Skipping pending notification for another device role: " + id);
                        continue;
                    }
                    if ("remote_listen".equals(type)) {
                        publishDeviceStatusFromPending(data);
                        RemoteListenNotification.Result result = RemoteListenNotification.show(
                            this,
                            new RemoteListenNotification.Request(
                                readRemoteListenRequestId(data),
                                data != null ? data.optString("familyId", "") : "",
                                data != null
                                    ? firstNonBlank(
                                        data.optString("targetUserId", ""),
                                        data.optString("target_user_id", "")
                                    )
                                    : "",
                                data != null ? data.optString("senderUserId", "") : "",
                                data != null ? data.optString("requestedAt", "") : "",
                                data != null ? data.optString("expiresAt", "") : "",
                                readRemoteListenDurationSec(data)
                            )
                        );
                        if (result.shouldAcknowledge()) {
                            deliveredIds.put(id);
                        }
                        continue;
                    }
                    if ("remote_listen_stop".equals(type)) {
                        if (stopAmbientListenFromPending(data)) {
                            deliveredIds.put(id);
                        }
                        continue;
                    }
                    if ("request_location".equals(type)) {
                        if (PolledNotificationStore.isAcked(this, stableId)) {
                            pendingLocationRefreshRequests.remove(stableId);
                            pendingLocationNotificationIds.remove(stableId);
                            deliveredIds.put(id);
                            Log.d(TAG, "Skipping duplicate location refresh pending fallback: " + stableId);
                            continue;
                        }
                        if (shouldHandleLocationRefreshFromPending(data)) {
                            // FCM과 같은 requestId면 현재 generation에 병합된다. fresh fix의
                            // 서버 upsert가 실패하면 ACK/delivered를 남기지 않아 다음 poll이 재시도한다.
                            requestImmediateLocationFix(stableId, id);
                            publishDeviceStatusFromPending(data);
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
                    NotificationHelper.DeliveryReceipt receipt = showPolledNotification(
                        title,
                        notifBody,
                        type,
                        alertType,
                        emergency,
                        stableId,
                        data != null ? data.optString("route", "") : ""
                    );
                    if (receipt.shouldAcknowledge()) {
                        deliveredIds.put(id);
                        markLocalPolledNotificationAck(stableId);
                        PolledNotificationStore.markAck(this, stableId);
                    } else {
                        Log.w(TAG, "Pending notification was not posted: " + receipt.getStatus().name());
                    }
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
        Map<String, String> payload = new HashMap<>();
        String[] targetKeys = {
            "targetUserId", "target_user_id",
            "targetFamilyId", "target_family_id", "familyId", "family_id",
            "targetRole", "target_role"
        };
        for (String key : targetKeys) {
            if (data != null && data.has(key) && !data.isNull(key)) {
                payload.put(key, data.optString(key, ""));
            }
        }
        NotificationTargetPolicy.Decision decision = NotificationTargetPolicy.evaluate(
            payload,
            userId,
            familyId,
            role
        );
        if (!decision.allowsDelivery()) {
            Log.d(TAG, "Skipping pending notification by target policy: " + decision.name());
        }
        return decision.allowsDelivery();
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

    private boolean stopAmbientListenFromPending(@Nullable JSONObject data) {
        if (!isBlank(role) && !"child".equalsIgnoreCase(role)) {
            Log.i(TAG, "Remote listen pending stop skipped: this device is not child mode");
            return false;
        }

        String requestFamilyId = data != null ? data.optString("familyId", "") : "";
        if (!isBlank(requestFamilyId) && !isBlank(familyId) && !requestFamilyId.equals(familyId)) {
            Log.w(TAG, "Remote listen pending stop skipped: family mismatch");
            return false;
        }

        String requestId = readRemoteListenRequestId(data);
        String targetUserId = data != null
            ? firstNonBlank(
                data.optString("targetUserId", ""),
                data.optString("target_user_id", "")
            )
            : "";
        String sessionNonce = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .getString("sessionNonce", "");
        if (isBlank(requestId)
                || isBlank(targetUserId)
                || !targetUserId.equals(userId)
                || !AmbientListenService.stopActiveSession(
                    requestId,
                    targetUserId,
                    sessionNonce)) {
            Log.w(TAG, "Remote listen pending stop skipped: session mismatch");
            return false;
        }
        Log.i(TAG, "Remote listen active capture stop requested from pending requestId=" + requestId);
        return true;
    }

    private boolean shouldHandleLocationRefreshFromPending(@Nullable JSONObject data) {
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

    private int readRemoteListenDurationSec(@Nullable JSONObject data) {
        String raw = data != null ? data.optString("durationSec", "") : "";
        if (isBlank(raw)) return RemoteListenRequestPolicy.DEFAULT_DURATION_SEC;
        try {
            return RemoteListenRequestPolicy.normalizeDurationSec(Integer.parseInt(raw));
        } catch (NumberFormatException ignored) {
            return RemoteListenRequestPolicy.DEFAULT_DURATION_SEC;
        }
    }

    private String readRemoteListenRequestId(@Nullable JSONObject data) {
        if (data == null) return "";
        return data.optString("requestId", "").trim();
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
                // 앱/Worker date_key 규칙은 0-index 월이다. 예: 2026-6-7 = 2026년 7월 7일.
                int monthIndex = kst.get(Calendar.MONTH);
                int day = kst.get(Calendar.DAY_OF_MONTH);
                int nowHour = kst.get(Calendar.HOUR_OF_DAY);
                int nowMin = kst.get(Calendar.MINUTE);
                int nowTotalMin = nowHour * 60 + nowMin;

                String dateKey = year + "-" + monthIndex + "-" + day;

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
                    // 알림 시간은 일정 배열과 별도 정본이다. 일정이 비었거나 RPC가 실패해도
                    // 2분 cycle마다 best-effort로 현재 사용자 cache를 갱신한다.
                    refreshNotificationQuietHoursBestEffort();
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

                boolean isChildDevice = "child".equalsIgnoreCase(role);

                // Track whether we're still at the silenced event's location
                boolean stillAtSilentLocation = false;

                for (int i = 0; i < events.length(); i++) {
                    JSONObject ev = events.getJSONObject(i);
                    String eventId = ev.getString("event_id");
                    String eventOccurrenceId = ev.optString("event_occurrence_id", eventId + ":" + dateKey + ":legacy");
                    String eventRevisionKey = ev.optString("event_revision_key", "legacy");
                    String title = ev.optString("event_title", "일정");
                    String time = ev.optString("event_time", "00:00");
                    String emoji = ev.optString("event_emoji", "📅");
                    JSONObject location = ev.optJSONObject("event_location");
                    boolean eventRemindersEnabled = ev.optBoolean("event_reminders_enabled", true);
                    JSONArray eventReminderMinutes = ev.optJSONArray("event_reminder_minutes");

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

                    int minutesFromStart = nowTotalMin - evTotalMin;

                    // Cron 의존을 못 믿으므로 자녀 디바이스에서 자체 15min/5min/start 로컬 알림.
                    // notificationId가 push-notify cron의 pushId 와 동일 포맷이라 중복 시 교체됨.
                    if (isChildDevice) {
                        fireLocalEventReminders(
                            eventId,
                            title,
                            time,
                            emoji,
                            evTotalMin,
                            nowTotalMin,
                            dateKey,
                            eventRevisionKey,
                            eventRemindersEnabled,
                            eventReminderMinutes
                        );
                    }

                    // ── Geo-fence checks: auto-silent + parent alerts ────────────
                    // 위치 기반 도착/미도착은 실제 자녀 기기 위치에서만 평가한다.
                    if (!isChildDevice) continue;
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
                            requestEventEvidenceLocationFix();
                        }
                        continue;
                    }

                    float distToEvent = distanceBetween(
                        lastUploadedLat, lastUploadedLng, evLat, evLng);
                    EventArrivalPolicy.ArrivalDecision arrivalDecision = EventArrivalPolicy.classify(
                        distToEvent,
                        lastUploadedAccuracyM,
                        lastUploadedAtMs,
                        nowMs,
                        GEOFENCE_RADIUS_M
                    );
                    if (arrivalDecision == EventArrivalPolicy.ArrivalDecision.UNKNOWN) {
                        if (inTimeWindow || (minutesFromStart >= 0 && minutesFromStart <= 18)) {
                            Log.i(TAG, "Event location evidence unknown for " + title + ", requesting fresh fix");
                            requestEventEvidenceLocationFix();
                        }
                        continue;
                    }
                    boolean atLocation = arrivalDecision == EventArrivalPolicy.ArrivalDecision.AT_LOCATION;

                    if (eventId.equals(silentForEventId) && atLocation) {
                        stillAtSilentLocation = true;
                    }

                    if (inTimeWindow && atLocation && silentForEventId == null) {
                        activateSilentMode(eventId, title, evLat, evLng);
                        stillAtSilentLocation = true;
                    }

                    // ── 시작 시각 ~ 시작 후 60분 윈도우에서 도착/미도착 판정 ──
                    String keyStatus = eventOccurrenceId + "-status";
                    String keyArrived = eventOccurrenceId + "-arrived";
                    String keyNotArrived = eventOccurrenceId + "-not_arrived";

                    // 1. 도착(arrived) 판정: 15분 전부터 60분 후까지.
                    //    keyArrived 로 데둡하여 미도착 알림(keyNotArrived) 이후에도 1회 도착 알림 가능.
                    if (minutesFromStart >= -15 && minutesFromStart <= 60 && atLocation && !shownEventNotifs.contains(keyArrived)) {
                        shownEventNotifs.add(keyArrived);
                        
                        // 이미 미도착 알림이 나간 상태라면 '지각 도착'으로 문구 변경
                        if (shownEventNotifs.contains(keyNotArrived)) {
                            int lateMin = minutesFromStart;
                            sendParentAlert(
                                "late_arrived",
                                "✅ 지각 도착",
                                emoji + " " + title + "에 " + lateMin + "분 늦게 도착했어요",
                                "info", eventOccurrenceId, eventId, keyArrived
                            );
                            Log.i(TAG, "Late arrival alert (dynamic) for " + title + " (+" + lateMin + "min)");
                        } else {
                            // 정상 도착
                            shownEventNotifs.add(keyStatus); // 레거시 호환용 status 키도 함께 점유
                            sendParentAlert(
                                "arrived",
                                "✅ 도착 확인",
                                emoji + " " + title + "에 잘 도착했어요! (" + time + ")",
                                "info", eventOccurrenceId, eventId, keyArrived
                            );
                            Log.i(TAG, "Parent arrival alert for " + title);
                        }
                    }

                    // 2. 미도착(not_arrived) 판정: 정각(0) ~ 5분 사이 1회 허용.
                    //    이미 도착(keyArrived)한 상태면 미도착 알림은 생략.
                    if (minutesFromStart >= 0 && minutesFromStart <= 5 && !atLocation && !shownEventNotifs.contains(keyArrived) && !shownEventNotifs.contains(keyNotArrived)) {
                        shownEventNotifs.add(keyNotArrived);
                        shownEventNotifs.add(keyStatus); // 레거시 호환용 status 키도 함께 점유
                        sendParentAlert(
                            "not_arrived",
                            "🚨 미도착 알림",
                            emoji + " " + title + " 시작 시간인데 아직 도착하지 않았어요 (" + time + ")",
                            "emergency", eventOccurrenceId, eventId, keyNotArrived
                        );
                        Log.i(TAG, "Parent miss alert for " + title);
                    }

                    // 3. 15분 경과 여전히 미도착인 경우 (초기 미도착 알림 이후 최종 경고)
                    if (minutesFromStart >= 15 && minutesFromStart <= 18 && !atLocation && !shownEventNotifs.contains(keyArrived)) {
                        String lateMarkKey = eventOccurrenceId + "-missed15";
                        if (!shownEventNotifs.contains(lateMarkKey)) {
                            shownEventNotifs.add(lateMarkKey);
                            sendParentAlert(
                                "missed_arrival",
                                "🚨 15분 경과 — 미도착",
                                emoji + " " + title + " 시작 후 15분이 지났는데 아직 도착하지 않았어요",
                                "emergency", eventOccurrenceId, eventId, lateMarkKey
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
                                 String severity, String eventId, String sourceEventId,
                                 String... dedupKeys) {
        runOnNetworkThread("parent_alert", () -> {
            try {
                JSONObject body = new JSONObject();
                body.put("family_id", familyId);
                body.put("alert_type", alertType);
                body.put("title", title);
                body.put("message", message);
                body.put("severity", severity);
                if (eventId != null) body.put("event_id", eventId);
                if (sourceEventId != null) body.put("source_event_id", sourceEventId);
                if (userId != null && !userId.isEmpty()) body.put("child_user_id", userId);
                boolean delivered = postWithAuthRetry(
                    supabaseUrl + "/api/parent-alerts", body.toString());

                if (delivered) {
                    Log.i(TAG, "Parent alert accepted: " + alertType);
                } else {
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

    /** 일정 조회와 독립적인 현재 사용자 알림 시간 cache 갱신. 실패 시 기존 snapshot을 보존한다. */
    private void refreshNotificationQuietHoursBestEffort() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        SessionTokenStore.ContextSnapshot requestContext = SessionTokenStore.readContext(prefs);
        if (isBlank(requestContext.userId)
                || isBlank(requestContext.accessToken)
                || isBlank(requestContext.supabaseUrl)) {
            return;
        }

        String expectedUserId = requestContext.userId;
        Response response = null;
        try {
            response = executeNotificationQuietHoursRequest(
                    requestContext.supabaseUrl,
                    requestContext.supabaseKey,
                    requestContext.accessToken
            );
            if (response.code() == 401) {
                response.close();
                response = null;
                String renewed = networkRefreshAccessToken();
                if (isBlank(renewed)) return;

                SessionTokenStore.ContextSnapshot retryContext = SessionTokenStore.readContext(prefs);
                if (!expectedUserId.equals(retryContext.userId)) return;
                response = executeNotificationQuietHoursRequest(
                        retryContext.supabaseUrl,
                        retryContext.supabaseKey,
                        renewed
                );
            }
            if (!response.isSuccessful() || response.body() == null) return;

            String responseBody = response.body().string();
            if (isBlank(responseBody) || "null".equals(responseBody.trim())) return;
            JSONObject row = new JSONObject(responseBody);
            String responseUserId = row.optString("user_id", "");
            JSONObject quietHours = row.optJSONObject("quiet_hours");
            if (isBlank(responseUserId) || quietHours == null) return;

            Object enabledRaw = quietHours.opt("enabled");
            Integer startMinute = readQuietMinute(quietHours, "start_minute");
            Integer endMinute = readQuietMinute(quietHours, "end_minute");
            if (!(enabledRaw instanceof Boolean)
                    || startMinute == null
                    || endMinute == null
                    || startMinute.equals(endMinute)) {
                return;
            }

            Object updatedAtRaw = quietHours.opt("updated_at");
            long updatedAtMs;
            if (updatedAtRaw == null || updatedAtRaw == JSONObject.NULL) {
                updatedAtMs = 0L;
            } else if (updatedAtRaw instanceof String) {
                updatedAtMs = parseQuietHoursUpdatedAtMs((String) updatedAtRaw);
                if (updatedAtMs <= 0L) return;
            } else {
                return;
            }

            // 네트워크 응답 직후 계정이 바뀌었으면 이전 사용자의 설정을 저장하지 않는다.
            SessionTokenStore.ContextSnapshot currentContext = SessionTokenStore.readContext(prefs);
            if (!responseUserId.equals(currentContext.userId)
                    || !expectedUserId.equals(currentContext.userId)) {
                return;
            }
            NotificationQuietHoursStore.SaveResult result =
                    NotificationQuietHoursStore.saveIfCurrentSession(
                            prefs,
                            currentContext.userId,
                            (Boolean) enabledRaw,
                            startMinute,
                            endMinute,
                            NotificationQuietHoursStore.SEOUL_TIME_ZONE_ID,
                            updatedAtMs
                    );
            Log.i(TAG, "Quiet-hours refresh result=" + result.name());
        } catch (Exception error) {
            Log.w(TAG, "Quiet-hours refresh failed: " + error.getClass().getSimpleName());
        } finally {
            if (response != null) response.close();
        }
    }

    private Response executeNotificationQuietHoursRequest(
            String baseUrl,
            String apiKey,
            String bearerToken
    ) throws Exception {
        Request.Builder builder = new Request.Builder()
                .url(baseUrl.replaceAll("/+$", "") + "/api/notif-settings")
                .header("Authorization", "Bearer " + bearerToken)
                .get();
        if (!isBlank(apiKey)) builder.header("apikey", apiKey);
        return httpClient.newCall(builder.build()).execute();
    }

    private static Integer readQuietMinute(JSONObject quietHours, String key) {
        Object raw = quietHours.opt(key);
        if (!(raw instanceof Number)) return null;
        Number number = (Number) raw;
        double numeric = number.doubleValue();
        int value = number.intValue();
        if (!Double.isFinite(numeric) || numeric != (double) value || value < 0 || value > 1439) {
            return null;
        }
        return value;
    }

    private static long parseQuietHoursUpdatedAtMs(String value) {
        if (value == null) return 0L;
        String normalized = value.trim();
        if (normalized.matches("\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?")) {
            normalized = normalized.replace(' ', 'T') + "Z";
        }
        return RemoteListenRequestPolicy.parseTimestampMs(normalized);
    }

    // ── Local event reminder fallback (자녀 디바이스, cron 미동작 시 보호) ────
    // notificationId 포맷이 push-notify cron의 pushId(`<eventId>-<window>-<dateKey>`)
    // 와 동일하므로, cron이 정상 동작한 경우 동일 알림이 native side에서 다시 와도
    // OS가 같은 ID로 교체 — 사용자에게 중복으로 보이지 않는다.
    private void fireLocalEventReminders(String eventId, String title, String time, String emoji,
                                         int evTotalMin, int nowTotalMin, String dateKey,
                                         String eventRevisionKey,
                                         boolean enabled, @Nullable JSONArray configuredMinutes) {
        if (!enabled) return;
        java.util.LinkedHashSet<Integer> minsBefore = new java.util.LinkedHashSet<>();
        if (configuredMinutes != null) {
            for (int i = 0; i < configuredMinutes.length(); i++) {
                int minute = configuredMinutes.optInt(i, -1);
                if (minute > 0 && minute <= 24 * 60) minsBefore.add(minute);
            }
        }
        // 시작 알림은 사전 알림 시간과 별개인 아이 전용 기본 알림이다.
        minsBefore.add(0);

        for (int minute : minsBefore) {
            int targetMinute = evTotalMin - minute;
            int lateBy = nowTotalMin - targetMinute;
            if (lateBy < 0 || lateBy > 2) continue;

            String key = minute == 0 ? "start" : minute + "min";
            String reminderKey = eventId + "-" + key + "-" + dateKey + "-" + eventRevisionKey;
            if (shownEventNotifs.contains(reminderKey)) continue;
            if (PolledNotificationStore.isAcked(this, reminderKey)) {
                shownEventNotifs.add(reminderKey);
                continue;
            }
            String notifTitle;
            String bodyTail;
            if (minute == 0) {
                notifTitle = "⏰ 시작!";
                bodyTail = " 시작 시간이야! 화이팅! 💪";
            } else if (minute <= 5) {
                notifTitle = "🏃 출발!";
                bodyTail = " 곧 시작이야! 출발~ 화이팅! 💪";
            } else {
                notifTitle = minute >= 30 ? "🐰 곧 준비!" : "🐰 준비 시간!";
                bodyTail = " 가기 " + minute + "분 전이야! 준비물 챙겼니? 🎒";
            }
            String body = emoji + " " + title + bodyTail + " (" + time + ")";
            int notifId = NotificationHelper.stableRequestCode(reminderKey);

            try {
                NotificationHelper.DeliveryReceipt receipt = NotificationHelper.showNotification(
                    this,
                    notifTitle,
                    body,
                    "schedule",
                    false,
                    false,
                    notifId,
                    "/child/home",
                    NotificationQuietHoursPolicy.NotificationIdentity.of("event_reminder", "")
                );
                if (receipt.shouldAcknowledge()) {
                    shownEventNotifs.add(reminderKey);
                    PolledNotificationStore.markAck(this, reminderKey);
                    Log.i(TAG, "Local event reminder fired: " + key + " for " + title);
                } else {
                    Log.w(TAG, "Local event reminder was not posted: " + receipt.getStatus().name());
                }
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
                    .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                    .setPublicVersion(NotificationHelper.buildPublicVersion(
                        this, CHANNEL_ID, false, null
                    ))
                    .setGroup(NotificationGroupPolicy.GROUP_LOCATION_STATUS)
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
        if (isBlank(tag)) return false;
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
    private NotificationHelper.DeliveryReceipt showPolledNotification(
            String title,
            String body,
            String type,
            String alertType,
            boolean emergency,
            String stableId,
            String payloadRoute
    ) {
        boolean isKkuk = "kkuk".equals(type);
        String channel = NotificationChannelPolicy.channelFor(type, alertType, emergency);
        // 꾹은 긴급 등급 — 전체화면(fullScreenIntent)으로 띄운다. FCM 경로
        // (MyFirebaseMessagingService.showNotification: fullScreen = emergency || isKkuk)와 동일.
        boolean fullScreen = emergency || isKkuk;
        int notificationId = NotificationHelper.stableRequestCode(stableId);
        // AI 선제 대화/부모 메모/스티커 알림은 탭하면 관련 아이 화면으로 직행한다.
        String route = !isBlank(payloadRoute)
            ? payloadRoute
            : ("ai_proactive".equals(type)
                ? "ai-chat"
                : ("new_memo".equals(type) ? "child-memo" : ("sticker".equals(type) ? "child-sticker" : null)));
        NotificationHelper.DeliveryReceipt receipt = NotificationHelper.showNotification(
            this,
            title,
            body,
            channel,
            fullScreen,
            fullScreen,
            notificationId,
            route,
            NotificationQuietHoursPolicy.NotificationIdentity.of(type, alertType)
        );

        if (receipt.shouldAcknowledge()) {
            Log.i(TAG, "Polled notification: " + title + ", emergency=" + emergency + ", kkuk=" + isKkuk);
        }
        return receipt;
    }

    private boolean isEmergencyNotification(String type, @Nullable JSONObject data) {
        return NotificationUrgencyPolicy.isEmergency(
            type,
            data != null ? data.optString("urgent", "") : "",
            data != null ? data.optString("severity", "") : "",
            data != null ? data.optString("alertType", data.optString("alert_type", "")) : ""
        );
    }

    // ── Notification Channels ───────────────────────────────────────────────────
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;

            // 위치 추적 FGS 전용 채널만 LocationService 에서 생성한다.
            NotificationChannel previous = manager.getNotificationChannel("hyeni_location_v4");
            NotificationChannel locationChannel = new NotificationChannel(
                CHANNEL_ID,
                "위치 추적",
                NotificationHelper.legacyImportance(
                    manager, "hyeni_location_v4", NotificationManager.IMPORTANCE_LOW
                )
            );
            locationChannel.setDescription("아이 위치를 부모님께 공유합니다");
            NotificationHelper.applyLegacyChannelBehavior(locationChannel, previous);
            locationChannel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(locationChannel);
            if (previous != null) manager.deleteNotificationChannel("hyeni_location_v4");
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

        String statusText = "parent".equals(role)
            ? "가족 위치 확인 기능이 실행 중이에요"
            : "보호자에게 위치를 공유하고 있어요";

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("위치 공유 중")
            .setContentText(statusText)
            .setSmallIcon(R.drawable.ic_hyeni_notification)
            .setLargeIcon(NotificationHelper.largeIcon(this))
            .setColor(ContextCompat.getColor(this, R.color.notification_accent))
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(NotificationHelper.buildPublicVersion(
                this, CHANNEL_ID, false, pendingIntent
            ))
            .setGroup(NotificationGroupPolicy.GROUP_LOCATION_STATUS)
            .build();
    }

    // ── Cleanup ─────────────────────────────────────────────────────────────────
    private void stopAll() {
        synchronized (immediateFixStateLock) {
            serviceStopping = true;
            serviceLifecycleEpoch.incrementAndGet();
            // 진행 중 Task/HTTP 콜백의 generation을 무효화하고 single-flight를 완전히
            // 초기화한다. 명시 로그아웃/서비스 종료 뒤 늦은 ACK가 세션을 되살리지 않는다.
            activeImmediateFixGeneration = immediateFixGenerationCounter.incrementAndGet();
            if (immediateFixDeadlineTask != null) {
                handler.removeCallbacks(immediateFixDeadlineTask);
                immediateFixDeadlineTask = null;
            }
            if (activeHighAccuracyFixToken != null) {
                activeHighAccuracyFixToken.cancel();
                activeHighAccuracyFixToken = null;
            }
            if (activeBalancedFixToken != null) {
                activeBalancedFixToken.cancel();
                activeBalancedFixToken = null;
            }
            activeLocationRefreshRequestIds = Collections.emptySet();
            activeLocationRefreshNotBeforeElapsedMs = 0L;
            pendingLocationRefreshRequests.clear();
            pendingLocationNotificationIds.clear();
            immediateFixInFlight.set(false);
        }
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
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                Log.i(TAG, "AlarmManager inexact restart requested after 5 seconds");
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
    // 5분 후 inexact alarm을 요청한다. Doze·시스템 부하에서는 maintenance window까지
    // 지연될 수 있으며, 15분 WorkManager keepalive가 끊긴 chain을 함께 복구한다.
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
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
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
