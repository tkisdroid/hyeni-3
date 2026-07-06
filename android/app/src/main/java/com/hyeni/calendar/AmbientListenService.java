package com.hyeni.calendar;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
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
    private static final int DEFAULT_DURATION_SEC = 60;

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
    private static final String EVENT_DUPLICATE_START = "duplicate_start";
    private static final Object SESSION_LOCK = new Object();
    private static String activeRequestId = "";

    private static final int SAMPLE_RATE = 16_000;
    private static final int CHUNK_MS = 1_000;
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .protocols(Collections.singletonList(Protocol.HTTP_1_1))
        .build();

    private final AtomicBoolean recording = new AtomicBoolean(false);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private ExecutorService uploadExecutor;
    private Thread captureThread;
    private PowerManager.WakeLock wakeLock;
    private int sequenceNumber = 0;

    private String familyId;
    private String childUserId;
    private String initiatorUserId;
    private String supabaseUrl;
    private String supabaseKey;
    private String accessToken;
    private String requestId;
    private int durationSec;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopCapture("stop_requested");
            stopSelf();
            return START_NOT_STICKY;
        }

        createChannel();
        Notification notification = buildOngoingNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14+ silently mutes mic capture when FGS type is anything
            // other than MICROPHONE (peak16=0 with SPECIAL_USE confirmed via
            // parent-device logs). Always try MICROPHONE first.
            //
            // The SPECIAL_USE fallback below is *normally unreachable*: with the
            // 2026-05-08 fix this service is started exclusively from
            // RemoteListenActivity.onCreate (foreground context), so
            // startForeground(TYPE_MICROPHONE) will not throw
            // ForegroundServiceStartNotAllowed. The fallback is retained as a
            // belt-and-suspenders safeguard for OEMs that may still defer the
            // activity launch on a closed cover display before its onCreate
            // runs the foreground promotion. In that fallback path mic data is
            // muted by the OS, so we stopSelf immediately — surfacing a clean
            // failure rather than streaming silence that looks like success.
            boolean micTypeStarted = false;
            try {
                startForeground(
                    NOTIF_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                );
                micTypeStarted = true;
                Log.i(TAG, "Started FGS with TYPE_MICROPHONE");
            } catch (Exception micError) {
                Log.w(TAG, "FGS TYPE_MICROPHONE denied (likely cover-display path), falling back to SPECIAL_USE", micError);
                try {
                    startForeground(
                        NOTIF_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                    );
                } catch (Exception specError) {
                    Log.e(TAG, "All FGS types denied; stopping ambient listen", specError);
                    stopSelf();
                    return START_NOT_STICKY;
                }
            }
            if (!micTypeStarted) {
                Log.w(TAG, "Microphone foreground-service type denied; stopping ambient listen");
                Log.w(TAG, "FGS started in SPECIAL_USE mode — mic capture will be silent on Android 14+. Stopping early.");
                removeForegroundNotification();
                stopSelf();
                return START_NOT_STICKY;
            }
        } else {
            startForeground(NOTIF_ID, notification);
        }

        configure(intent);
        if (!hasRecordAudioPermission()) {
            Log.w(TAG, "RECORD_AUDIO permission missing; ambient listen stopped");
            removeForegroundNotification();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!hasRequiredConfig()) {
            Log.w(TAG, "Ambient listen config missing; ambient listen stopped");
            removeForegroundNotification();
            stopSelf();
            return START_NOT_STICKY;
        }

        startCaptureIfNeeded();
        return START_REDELIVER_INTENT;
    }

    @Override
    public void onDestroy() {
        stopCapture("service_destroyed");
        removeForegroundNotification();
        super.onDestroy();
    }

    private void configure(Intent intent) {
        familyId = readExtraOrPrefs(intent, EXTRA_FAMILY_ID, "familyId");
        childUserId = readExtraOrPrefs(intent, EXTRA_USER_ID, "userId");
        initiatorUserId = readExtraOrPrefs(intent, EXTRA_INITIATOR_USER_ID, "");
        supabaseUrl = readExtraOrPrefs(intent, EXTRA_SUPABASE_URL, "supabaseUrl");
        supabaseKey = readExtraOrPrefs(intent, EXTRA_SUPABASE_KEY, "supabaseKey");
        accessToken = readExtraOrPrefs(intent, EXTRA_ACCESS_TOKEN, "accessToken");
        requestId = intent != null ? intent.getStringExtra(EXTRA_REQUEST_ID) : "";
        durationSec = intent != null ? intent.getIntExtra(EXTRA_DURATION_SEC, DEFAULT_DURATION_SEC) : DEFAULT_DURATION_SEC;
        if (durationSec < 5) durationSec = DEFAULT_DURATION_SEC;
        if (durationSec > 120) durationSec = 120;
    }

    private String readExtraOrPrefs(Intent intent, String extraKey, String prefKey) {
        String value = intent != null ? intent.getStringExtra(extraKey) : null;
        if (notBlank(value)) return value.trim();
        if (!notBlank(prefKey)) return "";
        return getSharedPreferences("hyeni_location_prefs", MODE_PRIVATE).getString(prefKey, "");
    }

    private boolean hasRequiredConfig() {
        return notBlank(familyId)
            && notBlank(childUserId)
            && notBlank(supabaseUrl)
            && notBlank(supabaseKey);
    }

    private boolean hasRecordAudioPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED;
    }

    private boolean notBlank(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private void startCaptureIfNeeded() {
        String nextRequestId = notBlank(requestId) ? requestId.trim() : "legacy-" + System.currentTimeMillis();
        synchronized (SESSION_LOCK) {
            if (recording.get()) {
                if (nextRequestId.equals(activeRequestId)) {
                    Log.i(TAG, EVENT_DUPLICATE_START + " ignored for requestId=" + nextRequestId);
                } else {
                    Log.i(TAG, "Ambient listen already running; " + EVENT_DUPLICATE_START + " ignored for requestId=" + nextRequestId);
                }
                requestId = activeRequestId;
                return;
            }
            activeRequestId = nextRequestId;
            requestId = nextRequestId;
        }

        if (!recording.compareAndSet(false, true)) {
            Log.i(TAG, "Ambient listen capture already running");
            clearActiveRequest();
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
            shutdownUploader();
            clearActiveRequest();
            finishServiceAfterCapture();
            return;
        }

        AudioRecord recorder = null;
        try {
            recorder = new AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                Math.max(minBuffer * 2, SAMPLE_RATE * 2)
            );

            if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
                Log.e(TAG, "AudioRecord failed to initialize");
                return;
            }

            recorder.startRecording();
            Log.i(TAG, "Native ambient audio capture started");

            long stopAt = System.currentTimeMillis() + durationSec * 1000L;
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
        } catch (Exception error) {
            Log.e(TAG, "Ambient audio capture failed", error);
        } finally {
            recording.set(false);
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
            shutdownUploader();
            clearActiveRequest();
            Log.i(TAG, "Ambient audio capture finished requestId=" + requestId + " chunks=" + sequenceNumber);
            finishServiceAfterCapture();
        }
    }

    private void clearActiveRequest() {
        synchronized (SESSION_LOCK) {
            if (!notBlank(requestId) || requestId.equals(activeRequestId)) {
                activeRequestId = "";
            }
        }
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

            boolean shouldFallbackToAnon = notBlank(accessToken) && !accessToken.equals(supabaseKey);
            String primaryToken = shouldFallbackToAnon ? accessToken : supabaseKey;
            boolean sent = postBroadcast(body, primaryToken, !shouldFallbackToAnon);
            if (!sent && shouldFallbackToAnon) {
                sent = postBroadcast(body, supabaseKey, true);
            }
            if (sent) {
                Log.i(TAG, "Realtime audio chunk sent seq=" + seq + " requestId=" + requestId);
            }
        } catch (Exception error) {
            Log.e(TAG, "Failed to post ambient audio chunk", error);
        }
    }

    private boolean postBroadcast(JSONObject body, String bearerToken, boolean logFailure) throws IOException {
        String token = notBlank(bearerToken) ? bearerToken : supabaseKey;
        Request request = new Request.Builder()
            .url(supabaseUrl.replaceAll("/+$", "") + "/realtime/v1/api/broadcast")
            .header("apikey", supabaseKey)
            .header("Authorization", "Bearer " + token)
            .header("Content-Type", "application/json")
            .post(RequestBody.create(body.toString(), JSON))
            .build();

        try (Response response = HTTP.newCall(request).execute()) {
            if (response.isSuccessful()) return true;
            String errorBody = response.body() != null ? response.body().string() : "";
            if (logFailure) {
                Log.w(TAG, "Realtime broadcast failed: " + response.code() + " / " + errorBody);
            }
            return false;
        }
    }

    private void stopCapture(String reason) {
        if (recording.getAndSet(false)) {
            Log.i(TAG, "Stopping ambient audio capture: " + reason);
        }
        if (captureThread != null) {
            captureThread.interrupt();
            captureThread = null;
        }
        releaseWakeLock();
        shutdownUploader();
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
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(Service.STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
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

    private void shutdownUploader() {
        ExecutorService executor = uploadExecutor;
        uploadExecutor = null;
        if (executor != null) {
            executor.shutdown();
        }
    }

    private Notification buildOngoingNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("\uC8FC\uBCC0 \uC18C\uB9AC \uC5F0\uACB0 \uC911")
            .setContentText("\uBD80\uBAA8\uB2D8\uACFC \uC5F0\uACB0\uB41C \uC8FC\uBCC0 \uC18C\uB9AC \uB4E3\uAE30 \uC138\uC158\uC774 \uC2E4\uD589 \uC911\uC785\uB2C8\uB2E4")
            .setSmallIcon(R.drawable.ic_hyeni_notification)
            .setLargeIcon(NotificationHelper.largeIcon(this))
            .setColor(ContextCompat.getColor(this, R.color.notification_accent))
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm == null) return;
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "\uC8FC\uBCC0 \uC18C\uB9AC \uC138\uC158",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("\uC8FC\uBCC0 \uC18C\uB9AC \uB4E3\uAE30 \uC138\uC158\uC774 \uD65C\uC131\uD654\uB41C \uB3D9\uC548 \uD45C\uC2DC\uB429\uB2C8\uB2E4");
            channel.setShowBadge(false);
            nm.createNotificationChannel(channel);
        }
    }
}
