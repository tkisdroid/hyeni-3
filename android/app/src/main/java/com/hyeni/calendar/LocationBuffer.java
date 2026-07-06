package com.hyeni.calendar;

import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.util.ArrayList;
import java.util.List;

/**
 * 네트워크 유실 시 이동경로 점을 기기에 적재하는 파일 기반 큐 (JSON Lines).
 * 한 줄이 한 점 — {"lat":..,"lng":..,"accuracy":..,"recorded_at":epochMs}.
 * 모든 연산은 LOCK 으로 직렬화 — LocationService 의 여러 background 스레드에서 안전.
 */
final class LocationBuffer {
    private static final String TAG = "LocationBuffer";
    private static final Object LOCK = new Object();

    static final class BufferedPoint {
        final double lat;
        final double lng;
        final float accuracy;
        final long recordedAtMs;

        BufferedPoint(double lat, double lng, float accuracy, long recordedAtMs) {
            this.lat = lat;
            this.lng = lng;
            this.accuracy = accuracy;
            this.recordedAtMs = recordedAtMs;
        }
    }

    private LocationBuffer() {}

    static boolean append(File file, double lat, double lng, float accuracy, long recordedAtMs) {
        synchronized (LOCK) {
            try (FileWriter writer = new FileWriter(file, true)) {
                JSONObject obj = new JSONObject();
                obj.put("lat", lat);
                obj.put("lng", lng);
                obj.put("accuracy", accuracy);
                obj.put("recorded_at", recordedAtMs);
                writer.write(obj.toString());
                writer.write("\n");
                return true;
            } catch (Exception error) {
                Log.w(TAG, "append failed", error);
                return false;
            }
        }
    }

    static List<BufferedPoint> readAll(File file) {
        List<BufferedPoint> points = new ArrayList<>();
        synchronized (LOCK) {
            if (file == null || !file.exists()) return points;
            try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.trim().isEmpty()) continue;
                    try {
                        JSONObject obj = new JSONObject(line);
                        points.add(new BufferedPoint(
                            obj.getDouble("lat"),
                            obj.getDouble("lng"),
                            (float) obj.optDouble("accuracy", 0d),
                            obj.getLong("recorded_at")));
                    } catch (Exception parseError) {
                        // 손상된 줄 — 건너뛴다 (전체 손실 방지)
                        Log.d(TAG, "skipping corrupt buffer line");
                    }
                }
            } catch (Exception error) {
                Log.w(TAG, "readAll failed", error);
            }
        }
        return points;
    }

    // 앞에서 n 줄 제거 — 플러시 성공분 제거.
    // n 이 실제 줄 수보다 크면 파일 전체를 비운다.
    static void removeFirst(File file, int n) {
        if (n <= 0) return;
        synchronized (LOCK) {
            if (file == null || !file.exists()) return;
            List<String> kept = new ArrayList<>();
            try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
                String line;
                int index = 0;
                while ((line = reader.readLine()) != null) {
                    if (index >= n) kept.add(line);
                    index++;
                }
            } catch (Exception error) {
                Log.w(TAG, "removeFirst read failed", error);
                return;
            }
            rewrite(file, kept);
        }
    }

    // 서버 기록이 확인된 특정 점만 제거한다. flush/remove 경합으로 해당 점이
    // 이미 없어졌다면 다른 새 점은 그대로 보존한다.
    static void removeMatching(File file, double lat, double lng, long recordedAtMs) {
        synchronized (LOCK) {
            if (file == null || !file.exists()) return;
            List<String> kept = new ArrayList<>();
            boolean removed = false;
            try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (!removed && isMatchingPoint(line, lat, lng, recordedAtMs)) {
                        removed = true;
                        continue;
                    }
                    kept.add(line);
                }
            } catch (Exception error) {
                Log.w(TAG, "removeMatching read failed", error);
                return;
            }
            if (removed) rewrite(file, kept);
        }
    }

    // recorded_at 이 (now - maxAgeMs) 보다 오래된 줄 제거.
    static void prune(File file, long maxAgeMs) {
        long cutoff = System.currentTimeMillis() - maxAgeMs;
        synchronized (LOCK) {
            if (file == null || !file.exists()) return;
            List<String> kept = new ArrayList<>();
            try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.trim().isEmpty()) continue;
                    try {
                        if (new JSONObject(line).getLong("recorded_at") >= cutoff) {
                            kept.add(line);
                        }
                    } catch (Exception parseError) {
                        // 손상된 줄 — prune 은 정리 단계이므로 버린다.
                        // (이미 파싱 불가 = flush 도 불가능한 데이터)
                    }
                }
            } catch (Exception error) {
                Log.w(TAG, "prune read failed", error);
                return;
            }
            rewrite(file, kept);
        }
    }

    // 줄 수가 maxLines 를 초과하면 앞에서(가장 오래된) 초과분을 제거.
    // age prune 만으로는 48시간 안에 줄 수가 무한정 늘 수 있어 — 그 상한을 강제한다
    // (플러시가 계속 실패해도 버퍼 크기가 발산하지 않게 하는 보조 안전장치).
    static void trimToMaxLines(File file, int maxLines) {
        if (maxLines <= 0) return;
        synchronized (LOCK) {
            if (file == null || !file.exists()) return;
            List<String> lines = new ArrayList<>();
            try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    lines.add(line);
                }
            } catch (Exception error) {
                Log.w(TAG, "trimToMaxLines read failed", error);
                return;
            }
            if (lines.size() <= maxLines) return;
            List<String> kept = new ArrayList<>(
                lines.subList(lines.size() - maxLines, lines.size()));
            rewrite(file, kept);
        }
    }

    static int size(File file) {
        synchronized (LOCK) {
            if (file == null || !file.exists()) return 0;
            int count = 0;
            try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (!line.trim().isEmpty()) count++;
                }
            } catch (Exception error) {
                Log.w(TAG, "size failed", error);
            }
            return count;
        }
    }

    private static boolean isMatchingPoint(String line, double lat, double lng, long recordedAtMs) {
        if (line == null || line.trim().isEmpty()) return false;
        try {
            JSONObject obj = new JSONObject(line);
            return obj.getLong("recorded_at") == recordedAtMs
                && Math.abs(obj.getDouble("lat") - lat) < 1e-9
                && Math.abs(obj.getDouble("lng") - lng) < 1e-9;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static void rewrite(File file, List<String> lines) {
        File tmp = new File(file.getParentFile(), file.getName() + ".tmp");
        try (FileWriter writer = new FileWriter(tmp, false)) {
            for (String line : lines) {
                writer.write(line);
                writer.write("\n");
            }
        } catch (Exception error) {
            Log.w(TAG, "rewrite temp write failed", error);
            tmp.delete();
            return;
        }
        // 같은 디렉터리 내 rename — POSIX/Android 에서 atomic. 도중 종료돼도 원본 보존.
        if (tmp.renameTo(file)) return;
        // 대상이 이미 존재할 때 renameTo 가 실패하는 플랫폼(Windows 등) 대비 폴백 —
        // 원본을 지운 뒤 재시도. POSIX/Android 에서는 위 atomic 경로가 먼저 성공한다.
        if (file.delete() && tmp.renameTo(file)) return;
        Log.w(TAG, "rewrite rename failed — original buffer preserved");
        tmp.delete();
    }
}
