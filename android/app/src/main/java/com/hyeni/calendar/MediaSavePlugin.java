package com.hyeni.calendar;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * 대화에서 받은 사진을 기기 갤러리에 저장한다.
 *
 * WebView 가 이미 인증된 상태로 이미지를 받아 base64 로 넘겨주므로, 네이티브는 R2 토큰이나
 * URL 을 다루지 않는다(자격 증명이 네이티브 경계를 넘지 않는다).
 *
 * 저장 위치는 공용 Pictures/혜니캘린더. API 29+ 는 MediaStore scoped storage 라 권한이
 * 필요 없고, 24~28 만 WRITE_EXTERNAL_STORAGE 를 쓴다(매니페스트에서 maxSdkVersion=28 로 제한).
 */
@CapacitorPlugin(name = "MediaSave")
public class MediaSavePlugin extends Plugin {

    private static final String TAG = "MediaSave";
    private static final String ALBUM = "혜니캘린더";
    private static final long MAX_BYTES = 12L * 1024 * 1024;

    @PluginMethod
    public void saveImage(PluginCall call) {
        String base64 = call.getString("base64", "");
        String fileName = sanitizeFileName(call.getString("fileName", ""));
        String mimeType = call.getString("mimeType", "image/jpeg");
        if (base64 == null || base64.isEmpty()) {
            call.reject("missing_image_data");
            return;
        }

        byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("invalid_image_data");
            return;
        }
        if (bytes.length == 0 || bytes.length > MAX_BYTES) {
            call.reject("invalid_image_size");
            return;
        }
        if (mimeType == null || !mimeType.startsWith("image/")) mimeType = "image/jpeg";

        // API 28 이하에서만 저장소 쓰기 권한이 필요하다. 권한이 없으면 사용자가 설정에서
        // 허용하도록 안내할 수 있게 명시적 사유로 거절한다(자동 권한 팝업을 띄우지 않는다).
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && !hasLegacyWritePermission()) {
            call.reject("storage_permission_denied");
            return;
        }

        try {
            Uri saved = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? saveViaMediaStore(bytes, fileName, mimeType)
                : saveViaLegacyFile(bytes, fileName, mimeType);
            if (saved == null) {
                call.reject("save_failed");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("saved", true);
            ret.put("album", ALBUM);
            call.resolve(ret);
        } catch (SecurityException e) {
            Log.w(TAG, "save denied", e);
            call.reject("storage_permission_denied");
        } catch (Exception e) {
            Log.w(TAG, "save failed", e);
            call.reject("save_failed");
        }
    }

    private boolean hasLegacyWritePermission() {
        try {
            return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.WRITE_EXTERNAL_STORAGE)
                == PackageManager.PERMISSION_GRANTED;
        } catch (Exception e) {
            return false;
        }
    }

    private Uri saveViaMediaStore(byte[] bytes, String fileName, String mimeType) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
        values.put(MediaStore.Images.Media.MIME_TYPE, mimeType);
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + File.separator + ALBUM);
        values.put(MediaStore.Images.Media.IS_PENDING, 1);

        Uri item = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (item == null) return null;
        try {
            try (OutputStream out = resolver.openOutputStream(item)) {
                if (out == null) throw new IllegalStateException("no_output_stream");
                out.write(bytes);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(item, done, null, null);
            return item;
        } catch (Exception e) {
            // 부분 저장된 항목을 갤러리에 남기지 않는다.
            try { resolver.delete(item, null, null); } catch (Exception ignored) { }
            throw e;
        }
    }

    @SuppressWarnings("deprecation")
    private Uri saveViaLegacyFile(byte[] bytes, String fileName, String mimeType) throws Exception {
        File dir = new File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), ALBUM);
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("mkdir_failed");
        File target = new File(dir, fileName);
        try (FileOutputStream out = new FileOutputStream(target)) {
            out.write(bytes);
        }
        // 갤러리 색인에 등록해야 사용자가 바로 찾을 수 있다.
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
        values.put(MediaStore.Images.Media.MIME_TYPE, mimeType);
        values.put(MediaStore.Images.Media.DATA, target.getAbsolutePath());
        return getContext().getContentResolver()
            .insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
    }

    /** 경로 조작·확장자 누락을 막는 최소 정규화. 빈 값이면 시각 기반 이름을 만든다. */
    private String sanitizeFileName(String raw) {
        String name = raw == null ? "" : raw.trim();
        name = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (name.isEmpty()) name = "hyeni-photo-" + System.currentTimeMillis() + ".jpg";
        if (!name.matches("(?i).*\\.(jpg|jpeg|png|webp)$")) name = name + ".jpg";
        return name;
    }
}
