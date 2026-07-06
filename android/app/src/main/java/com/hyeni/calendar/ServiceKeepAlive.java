package com.hyeni.calendar;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

/**
 * WorkManager periodic worker that ensures LocationService stays alive.
 * Runs every 15 minutes (minimum WorkManager interval).
 * If the service was killed by the OS, battery optimizer, or OEM cleanup,
 * this worker will restart it.
 */
public class ServiceKeepAlive extends Worker {

    private static final String TAG = "ServiceKeepAlive";
    private static final String WORK_NAME = "hyeni_service_keepalive";
    private static final String PREFS_NAME = "hyeni_location_prefs";

    public ServiceKeepAlive(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean enabled = prefs.getBoolean("serviceEnabled", false);
        String userId = prefs.getString("userId", null);

        if (!enabled || userId == null) {
            Log.d(TAG, "Service not enabled or no userId, skipping restart");
            return Result.success();
        }

        // 위치 권한이 없으면 SDK34+ FGS 시작이 크래시하므로 skip (LocationService 도
        // 같은 가드를 갖지만, background 에서 startForegroundService 호출 자체가 거부될
        // 때를 대비해 여기서도 선제 체크).
        if (androidx.core.content.ContextCompat.checkSelfPermission(
                ctx, android.Manifest.permission.ACCESS_FINE_LOCATION)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "Location permission not granted, skipping keepalive restart");
            return Result.success();
        }

        // Restart the foreground service WITH the heartbeat action so each 15-min
        // run also (a) forces an immediate fresh fix and (b) re-arms the
        // self-rescheduling AlarmManager heartbeat chain. 2026-06-10 사건: 모토로라
        // 의 App Standby 버킷 강등으로 AlarmManager 하트비트 체인이 5시간 끊겼다.
        // WorkManager 가 살아 도는 매 회차마다 ACTION_HEARTBEAT_FIX 로 기동하면
        // 단발 fix 로 last_location_at 을 갱신하고 끊긴 하트비트 체인을 자가 복구한다
        // (no-action 기동은 onStartCommand 가 fix 를 강제하지 않아 효과가 약했다).
        try {
            Intent intent = new Intent(ctx, LocationService.class);
            intent.setAction(LocationService.ACTION_HEARTBEAT_FIX);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent);
            } else {
                ctx.startService(intent);
            }
            Log.i(TAG, "LocationService restarted by WorkManager keepalive (heartbeat fix)");
        } catch (Exception e) {
            Log.e(TAG, "Failed to restart LocationService: " + e.getMessage());
        }

        return Result.success();
    }

    /**
     * Schedule the keepalive worker. Call this when LocationService starts.
     */
    public static void schedule(Context context) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
            .build();

        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                ServiceKeepAlive.class, 15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .setInitialDelay(15, TimeUnit.MINUTES)
            .build();

        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            );

        Log.i(TAG, "WorkManager keepalive scheduled (every 15min)");
    }

    /**
     * Cancel the keepalive worker. Call this when service is explicitly stopped.
     */
    public static void cancel(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
        Log.i(TAG, "WorkManager keepalive cancelled");
    }
}
