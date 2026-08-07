package com.hyeni.calendar;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Base64;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.HttpUrl;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Native ambient-listen foreground service.
 *
 * Findmykids keeps the "sound around" session in native code: a visible
 * foreground service owns microphone capture and publishes audio to the parent
 * listener. This service follows that shape for Hyeni while reusing the
 * existing Supabase Realtime broadcast channel used by the React parent UI.
 */
public class AmbientListenService extends Service {

    private static final String TAG = "AmbientListenService";
    private static final String CHANNEL_ID = "ambient_listen_fgs";
    private static final int NOTIF_ID = 1001;

    public static final String ACTION_START = "com.hyeni.calendar.AMBIENT_LISTEN_START";
    public static final String ACTION_STOP = "com.hyeni.calendar.AMBIENT_LISTEN_STOP";
    public static final String EXTRA_USER_ID = "userId";
    public static final String EXTRA_FAMILY_ID = "familyId";
    public static final String EXTRA_INITIATOR_USER_ID = "initiatorUserId";
    public static final String EXTRA_SUPABASE_URL = "supabaseUrl";
    public static final String EXTRA_SUPABASE_KEY = "supabaseKey";
    public static final String EXTRA_ACCESS_TOKEN = "accessToken";
    public static final String EXTRA_DURATION_SEC = "durationSec";
    public static final String EXTRA_REQUEST_ID = "requestId";
    public static final String EXTRA_TARGET_USER_ID = "targetUserId";
    public static final String EXTRA_CONSENT_TOKEN = "consentToken";
    public static final String EXTRA_SESSION_NONCE = "sessionNonce";
    public static final String EXTRA_CAPTURE_EXPIRES_AT_MS = "captureExpiresAtMs";
    private static final String EVENT_DUPLICATE_START = "duplicate_start";
    private static final Object SESSION_LOCK = new Object();
    private static String activeRequestId = "";
    private static String activeTargetUserId = "";
    private static String activeSessionNonce = "";

    private static final int SAMPLE_RATE = 16_000;
    private static final int CHUNK_MS = 1_000;
    private static final int MAX_AUDIO_UPLOAD_ATTEMPTS = 2;
    private static final long AUDIO_UPLOAD_RETRY_DELAY_MS = 250L;
    private static final String PREFS_NAME = "hyeni_location_prefs";
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .protocols(Collections.singletonList(Protocol.HTTP_1_1))
        .build();
    private static final OkHttpClient STATUS_HTTP = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .callTimeout(12, TimeUnit.SECONDS)
        .protocols(Collections.singletonList(Protocol.HTTP_1_1))
        .build();
    private static final ExecutorService STATUS_EXECUTOR = Executors.newSingleThreadExecutor();

    private final AtomicBoolean recording = new AtomicBoolean(false);
    private final AtomicBoolean uploadFailureReported = new AtomicBoolean(false);
    private final AtomicBoolean serverEndReported = new AtomicBoolean(false);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private ExecutorService uploadExecutor;
    private Thread captureThread;
    private volatile AudioRecord activeRecorder;
    private PowerManager.WakeLock wakeLock;
    private int sequenceNumber = 0;

    private String familyId;
    private String childUserId;
    private String initiatorUserId;
    private String supabaseUrl;
    private String supabaseKey;
    private volatile String accessToken;
    private String requestId;
    private String targetUserId;
    private String consentToken;
    private String sessionNonce;
    private int durationSec;
    private long captureExpiresAtMs;
    private volatile String terminalReason = "";

    private static final class BroadcastResult {
        final boolean success;
        final int statusCode;

        BroadcastResult(boolean success, int statusCode) {
            this.success = success;
            this.statusCode = statusCode;
        }

        boolean retryable() {
            return statusCode == 0 || statusCode == 429 || statusCode >= 500;
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            String stopRequestId = clean(intent.getStringExtra(EXTRA_REQUEST_ID));
            String stopTargetUserId = clean(intent.getStringExtra(EXTRA_TARGET_USER_ID));
            String stopSessionNonce = clean(intent.getStringExtra(EXTRA_SESSION_NONCE));
            if (matchesActiveSession(stopRequestId, stopTargetUserId, stopSessionNonce)) {
                stopCapture("stop_requested");
                stopSelf();
            } else {
                Log.w(TAG, "Ignoring remote listen stop for a different session");
            }
            return START_NOT_STICKY;
        }

        String incomingRequestId = clean(
            intent != null ? intent.getStringExtra(EXTRA_REQUEST_ID) : ""
        );
        synchronized (SESSION_LOCK) {
            if (!activeRequestId.isEmpty()) {
                Log.i(TAG, EVENT_DUPLICATE_START + " ignored for requestId=" + incomingRequestId);
                if (!activeRequestId.equals(incomingRequestId)) {
                    RemoteListenRequestStore.markFinished(
                        this,
                        incomingRequestId,
                        "capture_already_active"
                    );
                }
                return START_NOT_STICKY;
            }
        }

        configure(intent);
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        SessionTokenStore.ContextSnapshot current = SessionTokenStore.readContext(prefs);
        String currentSessionNonce = clean(prefs.getString("sessionNonce", ""));
        applyCurrentCredentials(current);

        if (!hasRecordAudioPermission() || !hasRequiredConfig()) {
            rejectStart("permission_or_config_missing");
            return START_NOT_STICKY;
        }
        if (!"child".equalsIgnoreCase(current.role)
                || !childUserId.equals(targetUserId)
                || !RemoteListenRequestPolicy.matchesContext(
                    familyId,
                    targetUserId,
                    sessionNonce,
                    current.familyId,
                    current.userId,
                    currentSessionNonce)) {
            rejectStart("session_context_mismatch");
            return START_NOT_STICKY;
        }
        if (!RemoteListenRequestStore.consumeAcceptance(
                this,
                requestId,
                consentToken,
                current.familyId,
                current.userId,
                currentSessionNonce,
                captureExpiresAtMs,
                System.currentTimeMillis())) {
            rejectStart("consent_missing_or_expired");
            return START_NOT_STICKY;
        }
        if (!reserveActiveSession()) {
            rejectStart("duplicate_start");
            return START_NOT_STICKY;
        }

        createChannel();
        try {
            Notification notification = buildOngoingNotification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(
                    NOTIF_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                );
            } else {
                startForeground(NOTIF_ID, notification);
            }
            startCapture();
            return START_NOT_STICKY;
        } catch (RuntimeException error) {
            Log.e(TAG, "Consent-based microphone foreground service start failed", error);
            terminalReason = "audio_upload_failed";
            reportSessionEndBestEffort(terminalReason, false);
            RemoteListenRequestStore.markFinished(this, requestId, terminalReason);
            clearActiveRequest();
            removeForegroundNotification();
            stopSelf();
            return START_NOT_STICKY;
        }
    }

    @Override
    public void onDestroy() {
        stopCapture("service_destroyed");
        removeForegroundNotification();
        super.onDestroy();
    }

    private void configure(Intent intent) {
        uploadFailureReported.set(false);
        serverEndReported.set(false);
        terminalReason = "";
        familyId = readExtra(intent, EXTRA_FAMILY_ID);
        childUserId = readExtra(intent, EXTRA_USER_ID);
        targetUserId = readExtra(intent, EXTRA_TARGET_USER_ID);
        initiatorUserId = readExtra(intent, EXTRA_INITIATOR_USER_ID);
        requestId = readExtra(intent, EXTRA_REQUEST_ID);
        consentToken = readExtra(intent, EXTRA_CONSENT_TOKEN);
        sessionNonce = readExtra(intent, EXTRA_SESSION_NONCE);
        int requestedDuration = intent != null
            ? intent.getIntExtra(
                EXTRA_DURATION_SEC,
                RemoteListenRequestPolicy.DEFAULT_DURATION_SEC
            )
            : RemoteListenRequestPolicy.DEFAULT_DURATION_SEC;
        durationSec = RemoteListenRequestPolicy.normalizeDurationSec(requestedDuration);
        captureExpiresAtMs = intent != null
            ? intent.getLongExtra(EXTRA_CAPTURE_EXPIRES_AT_MS, 0L)
            : 0L;
    }

    private void applyCurrentCredentials(SessionTokenStore.ContextSnapshot current) {
        supabaseUrl = clean(current.supabaseUrl);
        supabaseKey = clean(current.supabaseKey);
        accessToken = clean(current.accessToken);
    }

    private String readExtra(Intent intent, String extraKey) {
        return clean(intent != null ? intent.getStringExtra(extraKey) : "");
    }

    private boolean hasRequiredConfig() {
        return notBlank(familyId)
            && notBlank(childUserId)
            && notBlank(targetUserId)
            && notBlank(requestId)
            && notBlank(consentToken)
            && notBlank(accessToken)
            && notBlank(supabaseUrl)
            && notBlank(supabaseKey)
            && RemoteListenConsentClient.captureDeadlineMs(
                System.currentTimeMillis(),
                captureExpiresAtMs
            ) > 0L;
    }

    private boolean hasRecordAudioPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED;
    }

    private static boolean notBlank(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }

    private boolean reserveActiveSession() {
        synchronized (SESSION_LOCK) {
            if (!activeRequestId.isEmpty()) return false;
            activeRequestId = requestId;
            activeTargetUserId = targetUserId;
            activeSessionNonce = sessionNonce;
            return true;
        }
    }

    private void startCapture() {
        if (!recording.compareAndSet(false, true)) {
            RemoteListenRequestStore.markFinished(this, requestId, "capture_already_running");
            clearActiveRequest();
            removeForegroundNotification();
            stopSelf();
            return;
        }

        sequenceNumber = 0;
        uploadExecutor = Executors.newSingleThreadExecutor();
        acquireWakeLock();
        captureThread = new Thread(this::captureLoop, "hyeni-ambient-audio");
        captureThread.start();
    }

    private void captureLoop() {
        int minBuffer = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        );
        if (minBuffer <= 0) {
            Log.e(TAG, "Invalid AudioRecord min buffer: " + minBuffer);
            recording.set(false);
            releaseWakeLock();
            shutdownUploader(false);
            terminalReason = "audio_upload_failed";
            reportSessionEndBestEffort(terminalReason, false);
            RemoteListenRequestStore.markFinished(this, requestId, terminalReason);
            clearActiveRequest();
            finishServiceAfterCapture();
            return;
        }

        AudioRecord recorder = null;
        String completionReason = "timeout";
        try {
            long stopAt = RemoteListenConsentClient.captureDeadlineMs(
                System.currentTimeMillis(), captureExpiresAtMs
            );
            if (stopAt <= 0L) {
                Log.w(TAG, "Server consent capture window expired before microphone start");
                return;
            }
            recorder = new AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                Math.max(minBuffer * 2, SAMPLE_RATE * 2)
            );

            if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
                Log.e(TAG, "AudioRecord failed to initialize");
                completionReason = "audio_upload_failed";
                return;
            }

            activeRecorder = recorder;
            recorder.startRecording();
            Log.i(TAG, "Native ambient audio capture started");

            int samplesPerChunk = SAMPLE_RATE * CHUNK_MS / 1000;
            short[] readBuffer = new short[Math.max(1024, minBuffer / 2)];

            while (recording.get() && System.currentTimeMillis() < stopAt) {
                ByteArrayOutputStream pcm = new ByteArrayOutputStream(samplesPerChunk * 2);
                int samplesNeeded = samplesPerChunk;

                while (recording.get() && samplesNeeded > 0 && System.currentTimeMillis() < stopAt) {
                    int toRead = Math.min(readBuffer.length, samplesNeeded);
                    int read = recorder.read(readBuffer, 0, toRead);
                    if (read <= 0) {
                        Log.w(TAG, "AudioRecord read returned " + read);
                        break;
                    }
                    writePcm16Le(pcm, readBuffer, read);
                    samplesNeeded -= read;
                }

                byte[] pcmBytes = pcm.toByteArray();
                if (pcmBytes.length > 0) {
                    int peak16 = peakPcm16(pcmBytes);
                    if (peak16 <= 0) {
                        Log.w(TAG, "AudioRecord produced all-zero PCM chunk seq=" + sequenceNumber
                            + " requestId=" + requestId);
                        continue;
                    }
                    int seq = sequenceNumber++;
                    byte[] wav = buildWavChunk(pcmBytes, SAMPLE_RATE, 1);
                    dispatchAudioChunk(seq, wav, CHUNK_MS, peak16);
                }
            }
        } catch (SecurityException error) {
            Log.e(TAG, "Audio capture permission denied", error);
            completionReason = "audio_upload_failed";
        } catch (Exception error) {
            Log.e(TAG, "Ambient audio capture failed", error);
            completionReason = "audio_upload_failed";
        } finally {
            recording.set(false);
            if (activeRecorder == recorder) activeRecorder = null;
            if (recorder != null) {
                try {
                    if (recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                        recorder.stop();
                    }
                } catch (Exception ignored) {
                    // ignore stop errors
                }
                recorder.release();
            }
            releaseWakeLock();
            if (terminalReason.isEmpty()) terminalReason = completionReason;
            String resolvedReason = normalizeServerEndReason(terminalReason);
            reportSessionEndBestEffort(resolvedReason, true);
            shutdownUploader(false);
            RemoteListenRequestStore.markFinished(this, requestId, resolvedReason);
            clearActiveRequest();
            Log.i(TAG, "Ambient audio capture finished requestId=" + requestId + " chunks=" + sequenceNumber);
            finishServiceAfterCapture();
        }
    }

    private void clearActiveRequest() {
        synchronized (SESSION_LOCK) {
            if (!notBlank(requestId) || requestId.equals(activeRequestId)) {
                activeRequestId = "";
                activeTargetUserId = "";
                activeSessionNonce = "";
            }
        }
    }

    static boolean matchesActiveSession(
            String stopRequestId,
            String stopTargetUserId,
            String stopSessionNonce
    ) {
        synchronized (SESSION_LOCK) {
            return RemoteListenRequestPolicy.matchesStop(
                activeRequestId,
                stopRequestId,
                activeTargetUserId,
                stopTargetUserId,
                activeSessionNonce,
                stopSessionNonce
            );
        }
    }

    static boolean hasActiveSession() {
        synchronized (SESSION_LOCK) {
            return !activeRequestId.isEmpty();
        }
    }

    static void stopForRetiringSession(Context context, String retiringSessionNonce) {
        if (context == null) return;
        String request;
        String target;
        String nonce;
        synchronized (SESSION_LOCK) {
            nonce = clean(retiringSessionNonce);
            if (activeRequestId.isEmpty()
                    || nonce.isEmpty()
                    || !nonce.equals(activeSessionNonce)) {
                return;
            }
            request = activeRequestId;
            target = activeTargetUserId;
        }
        Intent stopIntent = new Intent(context, AmbientListenService.class);
        stopIntent.setAction(ACTION_STOP);
        stopIntent.putExtra(EXTRA_REQUEST_ID, request);
        stopIntent.putExtra(EXTRA_TARGET_USER_ID, target);
        stopIntent.putExtra(EXTRA_SESSION_NONCE, nonce);
        try {
            context.startService(stopIntent);
        } catch (RuntimeException error) {
            Log.w(TAG, "Retiring session remote listen stop dispatch failed", error);
        }
    }

    private void rejectStart(String reason) {
        Log.w(TAG, "Remote listen start rejected: " + reason);
        RemoteListenRequestStore.markFinished(this, requestId, reason);
        removeForegroundNotification();
        stopSelf();
    }

    private void writePcm16Le(ByteArrayOutputStream out, short[] samples, int count) {
        for (int i = 0; i < count; i++) {
            short sample = samples[i];
            out.write(sample & 0xff);
            out.write((sample >> 8) & 0xff);
        }
    }

    private byte[] buildWavChunk(byte[] pcmBytes, int sampleRate, int channels) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(pcmBytes.length + 44);
        int byteRate = sampleRate * channels * 2;
        writeAscii(out, "RIFF");
        writeIntLe(out, 36 + pcmBytes.length);
        writeAscii(out, "WAVE");
        writeAscii(out, "fmt ");
        writeIntLe(out, 16);
        writeShortLe(out, 1);
        writeShortLe(out, channels);
        writeIntLe(out, sampleRate);
        writeIntLe(out, byteRate);
        writeShortLe(out, channels * 2);
        writeShortLe(out, 16);
        writeAscii(out, "data");
        writeIntLe(out, pcmBytes.length);
        out.write(pcmBytes);
        return out.toByteArray();
    }

    private int peakPcm16(byte[] pcmBytes) {
        int peak = 0;
        for (int i = 0; i + 1 < pcmBytes.length; i += 2) {
            int lo = pcmBytes[i] & 0xff;
            int hi = pcmBytes[i + 1];
            int sample = (short) ((hi << 8) | lo);
            int abs = sample == Short.MIN_VALUE ? 32768 : Math.abs(sample);
            if (abs > peak) peak = abs;
        }
        return peak;
    }

    private void writeAscii(ByteArrayOutputStream out, String value) {
        for (int i = 0; i < value.length(); i++) {
            out.write(value.charAt(i));
        }
    }

    private void writeIntLe(ByteArrayOutputStream out, int value) {
        out.write(value & 0xff);
        out.write((value >> 8) & 0xff);
        out.write((value >> 16) & 0xff);
        out.write((value >> 24) & 0xff);
    }

    private void writeShortLe(ByteArrayOutputStream out, int value) {
        out.write(value & 0xff);
        out.write((value >> 8) & 0xff);
    }

    private void dispatchAudioChunk(int seq, byte[] wav, int durationMs, int peak16) {
        ExecutorService executor = uploadExecutor;
        if (executor == null || executor.isShutdown()) return;
        executor.execute(() -> postAudioChunk(seq, wav, durationMs, peak16));
    }

    private void postAudioChunk(int seq, byte[] wav, int durationMs, int peak16) {
        try {
            String base64 = Base64.encodeToString(wav, Base64.NO_WRAP);
            JSONObject payload = new JSONObject()
                .put("data", base64)
                .put("mimeType", "audio/wav")
                .put("durationMs", durationMs)
                .put("sequenceNumber", seq)
                .put("peak16", peak16)
                .put("source", "native-audiorecord")
                .put("childUserId", childUserId)
                .put("initiatorUserId", initiatorUserId)
                .put("requestId", requestId);

            JSONObject message = new JSONObject()
                .put("topic", "family-" + familyId)
                .put("event", "audio_chunk")
                .put("payload", payload);

            JSONObject body = new JSONObject()
                .put("messages", new JSONArray().put(message));

            if (!notBlank(accessToken)) {
                Log.w(TAG, "Realtime audio chunk skipped: access JWT missing");
                return;
            }
            BroadcastResult result = postBroadcastWithRetry(body);
            if (result.success) {
                Log.i(TAG, "Realtime audio chunk sent seq=" + seq + " requestId=" + requestId);
                return;
            }
            String reason = result.statusCode == 401
                ? "audio_auth_failed"
                : System.currentTimeMillis() >= captureExpiresAtMs
                    ? "timeout"
                    : "audio_upload_failed";
            reportCaptureFailure(reason);
        } catch (Exception error) {
            Log.e(TAG, "Failed to post ambient audio chunk", error);
            reportCaptureFailure("audio_upload_failed");
        }
    }

    private BroadcastResult postBroadcastWithRetry(JSONObject body) {
        BroadcastResult last = new BroadcastResult(false, 0);
        for (int attempt = 0; attempt < MAX_AUDIO_UPLOAD_ATTEMPTS; attempt++) {
            last = postBroadcast(body, accessToken);
            if (last.success) return last;

            if (last.statusCode == 401) {
                String renewed = refreshCurrentAccessToken(accessToken);
                if (notBlank(renewed)) {
                    accessToken = renewed;
                } else {
                    return last;
                }
            } else if (!last.retryable()) {
                return last;
            }

            if (attempt + 1 < MAX_AUDIO_UPLOAD_ATTEMPTS) {
                try {
                    Thread.sleep(AUDIO_UPLOAD_RETRY_DELAY_MS);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    return last;
                }
            }
        }
        return last;
    }

    private BroadcastResult postBroadcast(JSONObject body, String bearerToken) {
        if (!notBlank(bearerToken)) return new BroadcastResult(false, 401);
        Request request = new Request.Builder()
            .url(supabaseUrl.replaceAll("/+$", "") + "/realtime/v1/api/broadcast")
            .header("apikey", supabaseKey)
            .header("Authorization", "Bearer " + bearerToken)
            .header("Content-Type", "application/json")
            .post(RequestBody.create(body.toString(), JSON))
            .build();

        try (Response response = HTTP.newCall(request).execute()) {
            if (response.isSuccessful()) return new BroadcastResult(true, response.code());
            String errorBody = response.body() != null ? response.body().string() : "";
            Log.w(TAG, "Realtime broadcast failed: " + response.code() + " / " + errorBody);
            return new BroadcastResult(false, response.code());
        } catch (IOException error) {
            Log.w(TAG, "Realtime broadcast transport failed", error);
            return new BroadcastResult(false, 0);
        }
    }

    private String refreshCurrentAccessToken(String failedToken) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        SessionTokenStore.ContextSnapshot current = SessionTokenStore.readContext(prefs);
        String currentNonce = clean(prefs.getString("sessionNonce", ""));
        if (!RemoteListenRequestPolicy.matchesContext(
                familyId,
                childUserId,
                sessionNonce,
                current.familyId,
                current.userId,
                currentNonce)) {
            return null;
        }
        return RemoteListenConsentClient.refreshAccessToken(
            prefs,
            current,
            currentNonce,
            failedToken
        );
    }

    private void reportCaptureFailure(String reason) {
        String resolvedReason = normalizeServerEndReason(reason);
        if (!uploadFailureReported.compareAndSet(false, true)) return;
        terminalReason = resolvedReason;
        Log.w(TAG, "Stopping remote listen after audio delivery failure: " + resolvedReason);
        reportSessionEndBestEffort(resolvedReason, false);
        mainHandler.post(() -> {
            stopCapture(resolvedReason);
            stopSelf();
        });
    }

    private void reportSessionEndBestEffort(String reason, boolean afterPendingUploads) {
        final String resolvedReason = normalizeServerEndReason(reason);
        final String reportRequestId = clean(requestId);
        final String reportFamilyId = clean(familyId);
        final String reportChildUserId = clean(childUserId);
        final String reportSessionNonce = clean(sessionNonce);
        final String reportBaseUrl = clean(supabaseUrl);
        if (reportRequestId.isEmpty()
                || reportFamilyId.isEmpty()
                || reportChildUserId.isEmpty()
                || reportSessionNonce.isEmpty()
                || reportBaseUrl.isEmpty()
                || !serverEndReported.compareAndSet(false, true)) {
            return;
        }

        Runnable report = () -> reportSessionEnd(
            reportBaseUrl,
            reportRequestId,
            reportFamilyId,
            reportChildUserId,
            reportSessionNonce,
            resolvedReason
        );
        ExecutorService currentUploader = uploadExecutor;
        if (afterPendingUploads && currentUploader != null && !currentUploader.isShutdown()) {
            try {
                currentUploader.execute(report);
                return;
            } catch (RuntimeException error) {
                Log.w(TAG, "Could not queue remote listen end after audio uploads", error);
            }
        }
        STATUS_EXECUTOR.execute(report);
    }

    private void reportSessionEnd(
            String backendUrl,
            String endingRequestId,
            String endingFamilyId,
            String endingChildUserId,
            String endingSessionNonce,
            String reason
    ) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        SessionTokenStore.ContextSnapshot expected = SessionTokenStore.readContext(prefs);
        String expectedNonce = clean(prefs.getString("sessionNonce", ""));
        if (!RemoteListenRequestPolicy.matchesContext(
                endingFamilyId,
                endingChildUserId,
                endingSessionNonce,
                expected.familyId,
                expected.userId,
                expectedNonce)) {
            Log.w(TAG, "Skipped remote listen end report after session changed");
            return;
        }

        String bearer = expected.accessToken;
        BroadcastResult last = new BroadcastResult(false, 0);
        for (int attempt = 0; attempt < MAX_AUDIO_UPLOAD_ATTEMPTS; attempt++) {
            last = patchSessionEnd(backendUrl, endingRequestId, reason, bearer);
            if (last.success) {
                Log.i(TAG, "Remote listen end reported: " + reason);
                return;
            }
            if (last.statusCode == 401) {
                String refreshed = RemoteListenConsentClient.refreshAccessToken(
                    prefs,
                    expected,
                    expectedNonce,
                    bearer
                );
                if (!notBlank(refreshed)) break;
                bearer = refreshed;
                accessToken = refreshed;
            } else if (!last.retryable()) {
                break;
            }
            if (attempt + 1 < MAX_AUDIO_UPLOAD_ATTEMPTS) {
                try {
                    Thread.sleep(AUDIO_UPLOAD_RETRY_DELAY_MS);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
        Log.w(TAG, "Remote listen end report failed: HTTP " + last.statusCode);
    }

    private BroadcastResult patchSessionEnd(
            String backendUrl,
            String endingRequestId,
            String reason,
            String bearer
    ) {
        if (!notBlank(bearer)) return new BroadcastResult(false, 401);
        final HttpUrl endpoint;
        try {
            endpoint = HttpUrl.get(backendUrl).newBuilder()
                .addPathSegments("api/remote-listen/sessions")
                .addPathSegment(endingRequestId)
                .build();
        } catch (IllegalArgumentException error) {
            return new BroadcastResult(false, 0);
        }
        JSONObject body = new JSONObject();
        try {
            body.put("end_reason", reason);
        } catch (Exception error) {
            return new BroadcastResult(false, 0);
        }
        Request request = new Request.Builder()
            .url(endpoint)
            .header("Authorization", "Bearer " + bearer)
            .header("Content-Type", "application/json")
            .patch(RequestBody.create(body.toString(), JSON))
            .build();
        try (Response response = STATUS_HTTP.newCall(request).execute()) {
            return new BroadcastResult(response.isSuccessful(), response.code());
        } catch (IOException error) {
            Log.w(TAG, "Remote listen end report transport failed", error);
            return new BroadcastResult(false, 0);
        }
    }

    private String normalizeServerEndReason(String reason) {
        String value = clean(reason);
        if ("timeout".equals(value)
                || "request_timeout".equals(value)
                || "user_stop".equals(value)
                || "audio_auth_failed".equals(value)
                || "audio_upload_failed".equals(value)) {
            return value;
        }
        if ("stop_requested".equals(value)) return "user_stop";
        return "audio_upload_failed";
    }

    private void stopCapture(String reason) {
        String resolvedReason = normalizeServerEndReason(reason);
        if (terminalReason.isEmpty()) terminalReason = resolvedReason;
        if (recording.getAndSet(false)) {
            Log.i(TAG, "Stopping ambient audio capture: " + resolvedReason);
        }
        AudioRecord recorder = activeRecorder;
        activeRecorder = null;
        if (recorder != null) {
            try {
                if (recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                    recorder.stop();
                }
            } catch (RuntimeException error) {
                Log.w(TAG, "Active recorder stop failed", error);
            }
        }
        if (captureThread != null) {
            captureThread.interrupt();
            captureThread = null;
        }
        HTTP.dispatcher().cancelAll();
        releaseWakeLock();
        shutdownUploader(true);
        reportSessionEndBestEffort(terminalReason, false);
        RemoteListenRequestStore.markFinished(this, requestId, terminalReason);
        removeForegroundNotification();
        clearActiveRequest();
    }

    private void finishServiceAfterCapture() {
        Runnable cleanup = () -> {
            removeForegroundNotification();
            stopSelf();
        };
        if (Looper.myLooper() == Looper.getMainLooper()) {
            cleanup.run();
        } else {
            mainHandler.post(cleanup);
        }
    }

    private void removeForegroundNotification() {
        try {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
        } catch (Exception error) {
            Log.w(TAG, "Foreground notification removal failed", error);
        }

        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(NOTIF_ID);
            }
        } catch (Exception error) {
            Log.w(TAG, "Foreground notification cancel failed", error);
        }
    }

    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "hyeni:ambient_listen");
            wakeLock.acquire(Math.max(5, durationSec + 5) * 1000L);
        } catch (Exception error) {
            Log.w(TAG, "WakeLock acquire failed", error);
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {
            // ignore wake lock release errors
        }
        wakeLock = null;
    }

    private void shutdownUploader(boolean immediate) {
        ExecutorService executor = uploadExecutor;
        uploadExecutor = null;
        if (executor != null) {
            if (immediate) executor.shutdownNow();
            else executor.shutdown();
        }
    }

    private Notification buildOngoingNotification() {
        Intent stopIntent = new Intent(this, AmbientListenService.class);
        stopIntent.setAction(ACTION_STOP);
        stopIntent.putExtra(EXTRA_REQUEST_ID, requestId);
        stopIntent.putExtra(EXTRA_TARGET_USER_ID, targetUserId);
        stopIntent.putExtra(EXTRA_SESSION_NONCE, sessionNonce);
        PendingIntent stopPendingIntent = PendingIntent.getService(
            this,
            NotificationHelper.stableRequestCode("remote_listen_stop:" + requestId),
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("주변 소리를 보호자에게 공유 중")
            .setContentText("최대 1분 동안 공유돼. 언제든 바로 멈출 수 있어.")
            .setSmallIcon(R.drawable.ic_hyeni_notification)
            .setLargeIcon(NotificationHelper.largeIcon(this))
            .setColor(ContextCompat.getColor(this, R.color.notification_accent))
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(0, "공유 중지", stopPendingIntent)
            .build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm == null) return;
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "주변 소리 공유 상태",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("위급 주변 소리 공유가 진행되는 동안 아이 화면과 알림에 표시됩니다.");
            channel.setShowBadge(false);
            nm.createNotificationChannel(channel);
        }
    }
}
