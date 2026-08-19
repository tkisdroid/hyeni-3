package com.hyeni.calendar;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

@CapacitorPlugin(
    name = "SpeechRecognition",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone")
    }
)
public class SpeechPlugin extends Plugin {

    private static final String TAG = "SpeechPlugin";
    private static final long TTS_START_TIMEOUT_MS = 10_000L;
    private SpeechRecognizer speechRecognizer;
    private TextToSpeech textToSpeech;
    private boolean ttsReady = false;
    private final SpeechPlaybackGeneration ttsGeneration = new SpeechPlaybackGeneration();
    private boolean ttsInitializing = false;
    private PendingTtsRequest pendingTtsRequest;
    private PendingTtsStart pendingTtsStart;
    private String activeTtsUtteranceId;
    private long activeTtsGeneration = -1L;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile boolean destroyed = false;

    private static final class PendingTtsRequest {
        final PluginCall call;
        final String text;
        final String language;
        final float rate;
        final long generation;

        PendingTtsRequest(PluginCall call, String text, String language, float rate, long generation) {
            this.call = call;
            this.text = text;
            this.language = language;
            this.rate = rate;
            this.generation = generation;
        }
    }

    private static final class PendingTtsStart {
        final PluginCall call;
        final long generation;
        final String utteranceId;
        Runnable timeout;

        PendingTtsStart(PluginCall call, long generation, String utteranceId) {
            this.call = call;
            this.generation = generation;
            this.utteranceId = utteranceId;
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        String language = call.getString("language", "ko-KR");

        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            bridge.saveCall(call);
            requestPermissionForAlias("microphone", call, "onMicPermissionResult");
            return;
        }

        doStart(call, language);
    }

    @PermissionCallback
    private void onMicPermissionResult(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED) {
            String language = call.getString("language", "ko-KR");
            doStart(call, language);
        } else {
            call.reject("Microphone permission denied");
        }
    }

    private void doStart(PluginCall call, String language) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("Speech recognition not available on this device");
            return;
        }

        // Must run on main thread
        getActivity().runOnUiThread(() -> {
            try {
                if (speechRecognizer != null) {
                    speechRecognizer.destroy();
                }

                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());

                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);

                speechRecognizer.setRecognitionListener(new RecognitionListener() {
                    @Override
                    public void onResults(Bundle results) {
                        ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        if (matches != null && !matches.isEmpty()) {
                            JSObject ret = new JSObject();
                            ret.put("transcript", matches.get(0));
                            ret.put("success", true);
                            call.resolve(ret);
                        } else {
                            call.reject("No speech detected");
                        }
                        cleanup();
                    }

                    @Override
                    public void onError(int error) {
                        String msg;
                        switch (error) {
                            case SpeechRecognizer.ERROR_NO_MATCH:
                                msg = "음성을 인식하지 못했어요"; break;
                            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                                msg = "음성이 감지되지 않았어요"; break;
                            case SpeechRecognizer.ERROR_AUDIO:
                                msg = "오디오 오류"; break;
                            case SpeechRecognizer.ERROR_NETWORK:
                            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                                msg = "네트워크 오류 (인터넷 확인)"; break;
                            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                                msg = "마이크 권한이 필요해요"; break;
                            default:
                                msg = "음성 인식 오류 (" + error + ")"; break;
                        }
                        Log.e(TAG, "Speech error: " + error + " - " + msg);
                        call.reject(msg);
                        cleanup();
                    }

                    @Override public void onReadyForSpeech(Bundle params) {
                        Log.d(TAG, "Ready for speech");
                    }
                    @Override public void onBeginningOfSpeech() {}
                    @Override public void onRmsChanged(float rmsdB) {
                        // 아이 목소리 크기를 화면 파형에 그대로 싣는다(2026-08-19).
                        // 음성 자체는 보내지 않는다 — 크기(dB) 하나뿐이고 앱 밖으로 나가지 않는다.
                        notifySpeechRms(rmsdB);
                    }
                    @Override public void onBufferReceived(byte[] buffer) {}
                    @Override public void onEndOfSpeech() {
                        Log.d(TAG, "End of speech");
                    }
                    @Override public void onPartialResults(Bundle partialResults) {}
                    @Override public void onEvent(int eventType, Bundle params) {}
                });

                speechRecognizer.startListening(intent);
                Log.i(TAG, "Speech recognition started (lang=" + language + ")");

            } catch (Exception e) {
                Log.e(TAG, "Failed to start speech recognition", e);
                call.reject("Failed to start: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (speechRecognizer != null) {
                speechRecognizer.stopListening();
            }
            call.resolve(new JSObject().put("status", "stopped"));
        });
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        boolean available = SpeechRecognizer.isRecognitionAvailable(getContext());
        call.resolve(new JSObject().put("available", available));
    }

    // ── TTS — 아이 화면 "읽어줘" 버튼용. 시스템 TextToSpeech 사용(권한·의존성 0). ──

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) {
            call.reject("text required");
            return;
        }
        String language = call.getString(
            "language",
            SpeechLocalePolicy.DEFAULT_LANGUAGE_TAG
        );
        Float rateValue = call.getFloat("rate", 1.0f);
        float rate = rateValue != null ? rateValue : 1.0f;

        Activity activity = getActivity();
        if (destroyed || activity == null) {
            resolveNotStarted(call);
            return;
        }
        activity.runOnUiThread(() -> {
            if (destroyed) {
                resolveNotStarted(call);
                return;
            }
            long generation = ttsGeneration.next();
            clearActiveTtsUtterance();
            resolvePendingTtsStart(false);
            PendingTtsRequest request = new PendingTtsRequest(
                call,
                text,
                language,
                rate,
                generation
            );
            if (textToSpeech != null && ttsReady) {
                startUtterance(request);
                return;
            }

            if (ttsInitializing) {
                if (pendingTtsRequest != null) {
                    resolveNotStarted(pendingTtsRequest.call);
                }
                pendingTtsRequest = request;
                return;
            }

            if (pendingTtsRequest != null) {
                resolveNotStarted(pendingTtsRequest.call);
            }
            pendingTtsRequest = request;
            ttsInitializing = true;
            ttsReady = false;
            try {
                textToSpeech = new TextToSpeech(
                    getContext(),
                    status -> {
                        if (destroyed) {
                            return;
                        }
                        Activity callbackActivity = getActivity();
                        if (destroyed || callbackActivity == null) {
                            return;
                        }
                        callbackActivity.runOnUiThread(() -> {
                            if (destroyed) {
                                return;
                            }
                            finishTtsInitialization(status);
                        });
                    }
                );
            } catch (Exception error) {
                ttsInitializing = false;
                PendingTtsRequest failedRequest = pendingTtsRequest;
                pendingTtsRequest = null;
                disposeTextToSpeech();
                Log.e(TAG, "TTS init exception", error);
                if (failedRequest != null) {
                    if (ttsGeneration.isCurrent(failedRequest.generation)) {
                        failedRequest.call.reject("TTS not available on this device");
                    } else {
                        resolveNotStarted(failedRequest.call);
                    }
                }
            }
        });
    }

    private void disposeTextToSpeech() {
        TextToSpeech engine = textToSpeech;
        textToSpeech = null;
        ttsReady = false;
        if (engine == null) {
            return;
        }
        try {
            engine.stop();
        } catch (Exception error) {
            Log.e(TAG, "TTS stop during dispose failed", error);
        }
        try {
            engine.shutdown();
        } catch (Exception error) {
            Log.e(TAG, "TTS shutdown failed", error);
        }
    }

    private void finishTtsInitialization(int status) {
        if (destroyed) {
            return;
        }
        ttsInitializing = false;
        PendingTtsRequest request = pendingTtsRequest;
        pendingTtsRequest = null;

        if (status != TextToSpeech.SUCCESS) {
            Log.e(TAG, "TTS init failed: " + status);
            disposeTextToSpeech();
            if (request != null) {
                if (ttsGeneration.isCurrent(request.generation)) {
                    request.call.reject("TTS not available on this device");
                } else {
                    resolveNotStarted(request.call);
                }
            }
            return;
        }

        ttsReady = true;
        if (request == null) {
            return;
        }
        if (!ttsGeneration.isCurrent(request.generation)) {
            resolveNotStarted(request.call);
            return;
        }
        startUtterance(request);
    }

    private void resolveNotStarted(PluginCall call) {
        call.resolve(new JSObject().put("started", false));
    }

    private void resolvePendingTtsStart(boolean started) {
        PendingTtsStart pending = pendingTtsStart;
        if (pending == null) {
            return;
        }
        pendingTtsStart = null;
        if (pending.timeout != null) {
            mainHandler.removeCallbacks(pending.timeout);
        }
        if (!started) {
            resolveNotStarted(pending.call);
            return;
        }
        JSObject result = new JSObject();
        result.put("started", true);
        result.put("utteranceId", pending.utteranceId);
        pending.call.resolve(result);
    }

    private void handleTtsStarted(String utteranceId) {
        mainHandler.post(() -> {
            if (destroyed) {
                return;
            }
            PendingTtsStart pending = pendingTtsStart;
            if (
                pending == null ||
                !pending.utteranceId.equals(utteranceId) ||
                !ttsGeneration.isCurrent(pending.generation)
            ) {
                return;
            }
            activeTtsUtteranceId = utteranceId;
            activeTtsGeneration = pending.generation;
            notifyTtsState("started", utteranceId);
            resolvePendingTtsStart(true);
        });
    }

    private void handleTtsTerminalState(String state, String utteranceId) {
        mainHandler.post(() -> {
            if (destroyed) {
                return;
            }
            PendingTtsStart pending = pendingTtsStart;
            if (pending != null && pending.utteranceId.equals(utteranceId)) {
                if (ttsGeneration.isCurrent(pending.generation)) {
                    notifyTtsState(state, utteranceId);
                }
                resolvePendingTtsStart(false);
                return;
            }
            if (
                activeTtsUtteranceId == null ||
                !activeTtsUtteranceId.equals(utteranceId)
            ) {
                return;
            }
            if (
                !"stopped".equals(state) &&
                !ttsGeneration.isCurrent(activeTtsGeneration)
            ) {
                clearActiveTtsUtterance();
                return;
            }
            notifyTtsState(state, utteranceId);
            clearActiveTtsUtterance();
        });
    }

    private void clearActiveTtsUtterance() {
        activeTtsUtteranceId = null;
        activeTtsGeneration = -1L;
    }

    private void startUtterance(PendingTtsRequest request) {
        PendingTtsStart start = null;
        try {
            if (destroyed || !ttsGeneration.isCurrent(request.generation)) {
                resolveNotStarted(request.call);
                return;
            }
            if (!SpeechLocalePolicy.apply(request.language, textToSpeech::setLanguage)) {
                textToSpeech.stop();
                request.call.reject("TTS language not available");
                return;
            }
            textToSpeech.setSpeechRate(request.rate);
            final String utteranceId = "hyeni-tts-" + request.generation + "-" + System.currentTimeMillis();
            textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) {
                    handleTtsStarted(id);
                }
                @Override public void onDone(String id) {
                    handleTtsTerminalState("done", id);
                }
                @Override public void onError(String id) {
                    handleTtsTerminalState("error", id);
                }
                @Override public void onError(String id, int errorCode) {
                    handleTtsTerminalState("error", id);
                }
                @Override public void onStop(String id, boolean interrupted) {
                    handleTtsTerminalState("stopped", id);
                }
            });
            start = new PendingTtsStart(request.call, request.generation, utteranceId);
            pendingTtsStart = start;
            int result = textToSpeech.speak(
                request.text,
                TextToSpeech.QUEUE_FLUSH,
                null,
                utteranceId
            );
            if (result == TextToSpeech.SUCCESS) {
                PendingTtsStart scheduled = start;
                scheduled.timeout = () -> {
                    if (pendingTtsStart != scheduled) {
                        return;
                    }
                    if (textToSpeech != null) {
                        textToSpeech.stop();
                    }
                    resolvePendingTtsStart(false);
                };
                if (pendingTtsStart == scheduled) {
                    mainHandler.postDelayed(scheduled.timeout, TTS_START_TIMEOUT_MS);
                }
            } else {
                if (pendingTtsStart == start) {
                    pendingTtsStart = null;
                }
                request.call.reject("TTS speak failed");
            }
        } catch (Exception e) {
            if (start != null && pendingTtsStart == start) {
                pendingTtsStart = null;
                if (start.timeout != null) {
                    mainHandler.removeCallbacks(start.timeout);
                }
            }
            Log.e(TAG, "TTS speak exception", e);
            request.call.reject("TTS error: " + e.getMessage());
        }
    }

    /**
     * 음성 인식이 알려 주는 입력 크기(dB)를 JS 로 전한다.
     * 화면은 이 값으로 파형을 그리므로 "지어낸 파형"이 아니라 실제 목소리가 움직인다.
     * 값이 유한하지 않으면 보내지 않는다(화면이 0 으로 둔갑시키지 않도록).
     */
    private void notifySpeechRms(float rmsdB) {
        if (Float.isNaN(rmsdB) || Float.isInfinite(rmsdB)) {
            return;
        }
        JSObject data = new JSObject();
        data.put("rms", rmsdB);
        notifyListeners("speechRms", data);
    }

    private void notifyTtsState(String state, String utteranceId) {
        JSObject data = new JSObject();
        data.put("state", state);
        data.put("utteranceId", utteranceId);
        notifyListeners("ttsState", data);
    }

    @PluginMethod
    public void stopSpeak(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            ttsGeneration.cancel();
            resolvePendingTtsStart(false);
            if (pendingTtsRequest != null) {
                resolveNotStarted(pendingTtsRequest.call);
                pendingTtsRequest = null;
            }
            if (textToSpeech != null) {
                textToSpeech.stop();
            }
            call.resolve(new JSObject().put("status", "stopped"));
        });
    }

    private void cleanup() {
        getActivity().runOnUiThread(() -> {
            if (speechRecognizer != null) {
                speechRecognizer.destroy();
                speechRecognizer = null;
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        ttsGeneration.cancel();
        clearActiveTtsUtterance();
        resolvePendingTtsStart(false);
        if (pendingTtsRequest != null) {
            resolveNotStarted(pendingTtsRequest.call);
            pendingTtsRequest = null;
        }
        ttsInitializing = false;
        disposeTextToSpeech();
        cleanup();
        super.handleOnDestroy();
    }
}
