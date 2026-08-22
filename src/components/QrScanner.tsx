/**
 * QR 카메라 스캐너 오버레이(hyeni-1 QrPairScanner 이관).
 * BarcodeDetector(Android WebView/Chrome 내장) + getUserMedia(후면 카메라).
 * iOS Safari/WebKit에는 BarcodeDetector 가 없어 2026-08-22 TK iPhone 제보처럼
 * "QR코드 촬영이 안 된다"는 문제가 있었다 — 감지되지 않으면 jsQR 폴백으로
 * 비디오 프레임을 캔버스에 그려 직접 디코딩한다(iOS 포함 모든 브라우저 동작).
 * 권한 흐름: 네이티브 CameraPermissionPlugin > 브라우저 permissions > getUserMedia 오류.
 * 미지원 기기(카메라 자체 불가)는 정직하게 안내 → 코드 직접 입력으로 유도.
 * 아이 연결 단계는 페어링 안내 규칙에 맞춰 존댓말을 사용한다.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { useIntl } from "react-intl";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import type { MessageId } from "@/i18n/generated/messageIds";
import { ensureQrCameraPermission, openCameraPermissionSettings } from "@/lib/native/cameraPermission";
import type { CameraPermissionRecovery } from "@/transform/cameraPermissionState";
import "./QrScanner.css";

// BarcodeDetector 는 TS lib 에 없어 최소 형태만 선언(Shape Detection API).
interface DetectedBarcode {
  rawValue?: string;
}
interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

const PERMISSION_MESSAGE_ID: MessageId = "shared.qrScanner.permissionRequired";

// jsQR 폴백 프레임 처리 간격(ms) — requestAnimationFrame 매 프레임은 배터리를 낭비한다.
const JSQR_INTERVAL_MS = 120;
// 디코딩 다운스케일 목표 폭(px) — 원본 해상도는 CPU 비용만 늘리고 인식률은 비슷하다.
const JSQR_TARGET_WIDTH = 480;

function isPermissionDenied(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  const name = String(e?.name ?? "");
  const message = String(e?.message ?? "");
  return (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    name === "SecurityError" ||
    /permission|denied|not allowed/i.test(message)
  );
}

export function QrScanner({
  onDetected,
  onClose,
}: {
  /** QR rawValue 전달. 처리 후 스캐너는 정지 상태(닫기는 호출자가). */
  onDetected: (rawValue: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const intl = useIntl();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef(0);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  // BarcodeDetector 없는 환경(iOS Safari 등)에서 쓰는 jsQR 폴백 상태.
  const jsqrRef = useRef<typeof import("jsqr").default | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastJsqrAtRef = useRef(0);
  const handledRef = useRef(false);
  const [errorId, setErrorId] = useState<MessageId | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingLabelId, setLoadingLabelId] = useState<MessageId>(
    "shared.qrScanner.loading.permission",
  );
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [permissionRecovery, setPermissionRecovery] = useState<CameraPermissionRecovery>("none");
  const [retryKey, setRetryKey] = useState(0);
  const resumeRetryAtRef = useRef(0);
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open: true,
    onClose,
    initialFocusRef: closeRef,
  });

  useEffect(() => {
    let active = true;

    const stopScanner = () => {
      handledRef.current = true;
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };

    /** BarcodeDetector 없는 환경용 폴백 — 현재 프레임을 캔버스에 그려 jsQR 로 디코딩한다. */
    const decodeFrameWithJsqr = (): string | null => {
      const now = Date.now();
      if (now - lastJsqrAtRef.current < JSQR_INTERVAL_MS) return null;
      lastJsqrAtRef.current = now;

      const video = videoRef.current;
      const jsqr = jsqrRef.current;
      if (!video || !jsqr || !video.videoWidth || !video.videoHeight) return null;

      let canvas = canvasRef.current;
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvasRef.current = canvas;
      }
      const scale = Math.min(1, JSQR_TARGET_WIDTH / video.videoWidth);
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      const found = jsqr(image.data, width, height, { inversionAttempts: "dontInvert" });
      return found?.data ?? null;
    };

    const scanFrame = async () => {
      if (!active || handledRef.current || !videoRef.current) return;
      try {
        if (detectorRef.current) {
          const codes = await detectorRef.current.detect(videoRef.current);
          const rawValue = codes.find((c) => typeof c.rawValue === "string")?.rawValue;
          if (rawValue) {
            handledRef.current = true;
            await onDetected(rawValue);
            stopScanner();
            return;
          }
        } else if (jsqrRef.current) {
          const rawValue = decodeFrameWithJsqr();
          if (rawValue) {
            handledRef.current = true;
            await onDetected(rawValue);
            stopScanner();
            return;
          }
        }
      } catch {
        // 간헐적 detect 실패는 무시하고 다음 프레임
      }
      frameRef.current = requestAnimationFrame(() => void scanFrame());
    };

    const startScanner = async () => {
      handledRef.current = false;
      setErrorId(null);
      setPermissionDenied(false);
      setPermissionRecovery("none");
      setLoading(true);
      setLoadingLabelId("shared.qrScanner.loading.permission");

      // 스캔 엔진이 없는 기기에서는 카메라 권한을 먼저 요구하지 않는다.
      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorId("shared.qrScanner.cameraUnavailable");
        setLoading(false);
        return;
      }

      try {
        // 권한 팝업을 띄우기 전에 실제 디코딩 엔진부터 준비한다.
        const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
        if (typeof Detector === "function") {
          setLoadingLabelId("shared.qrScanner.loading.scanner");
          try {
            detectorRef.current = new Detector({ formats: ["qr_code"] });
          } catch {
            detectorRef.current = null;
          }
        }
        if (!detectorRef.current && !jsqrRef.current) {
          setLoadingLabelId("shared.qrScanner.loading.scanner");
          const module_ = await import("jsqr");
          if (!active) return;
          jsqrRef.current = module_.default;
        }
      } catch (error) {
        console.error("QR 스캔 엔진 준비 실패:", error);
        setErrorId("shared.qrScanner.openFailed");
        setLoading(false);
        return;
      }

      const permission = await ensureQrCameraPermission();
      if (!active) return;
      if (!permission.granted) {
        setPermissionDenied(true);
        setPermissionRecovery(permission.recovery);
        setErrorId(PERMISSION_MESSAGE_ID);
        setLoading(false);
        return;
      }

      try {
        setLoadingLabelId("shared.qrScanner.loading.camera");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setLoading(false);
        frameRef.current = requestAnimationFrame(() => void scanFrame());
      } catch (err) {
        console.error("QR 스캐너 시작 실패:", err);
        const denied = isPermissionDenied(err);
        setPermissionDenied(denied);
        setPermissionRecovery(denied ? "retry" : "none");
        setErrorId(denied ? PERMISSION_MESSAGE_ID : "shared.qrScanner.openFailed");
        setLoading(false);
      }
    };

    void startScanner();
    return () => {
      active = false;
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  // Android 앱 설정에서 카메라를 허용하고 돌아오면 사용자가 같은 버튼을 또 찾지 않게 자동 재확인한다.
  useEffect(() => {
    if (!permissionDenied || permissionRecovery !== "settings") return;
    const retryOnResume = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - resumeRetryAtRef.current < 500) return;
      resumeRetryAtRef.current = now;
      setRetryKey((value) => value + 1);
    };
    document.addEventListener("visibilitychange", retryOnResume);
    window.addEventListener("focus", retryOnResume);
    return () => {
      document.removeEventListener("visibilitychange", retryOnResume);
      window.removeEventListener("focus", retryOnResume);
    };
  }, [permissionDenied, permissionRecovery]);

  return (
    <div
      ref={dialogRef}
      className="qrs-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div className="qrs-top">
        <button ref={closeRef} type="button" className="qrs-close hy-press" onClick={onClose}>
          ← {intl.formatMessage({ id: "shared.qrScanner.close" })}
        </button>
        <span id={titleId} className="qrs-title">
          <Camera size={16} strokeWidth={2.4} />
          {intl.formatMessage({ id: "shared.qrScanner.title" })}
        </span>
      </div>

      <div className="qrs-body">
        <div className="qrs-cam">
          <video
            ref={videoRef}
            muted
            playsInline
            className="qrs-video"
            aria-label={intl.formatMessage({ id: "shared.qrScanner.cameraPreview" })}
          />
          <div className="qrs-frame" aria-hidden="true" />
          {loading && (
            <div className="qrs-loading">{intl.formatMessage({ id: loadingLabelId })}</div>
          )}
        </div>
        <div className="qrs-guide">
          <div className="qrs-guide-title">
            {intl.formatMessage({ id: "shared.qrScanner.guide.title" })}
          </div>
          <div id={descriptionId} className="qrs-guide-sub">
            {intl.formatMessage({ id: "shared.qrScanner.guide.description" })}
          </div>
          {errorId && <div className="qrs-error">{intl.formatMessage({ id: errorId })}</div>}
          {errorId && !loading && (
            <div className="qrs-actions">
              {permissionDenied && (
                <button
                  type="button"
                  className="qrs-retry hy-press"
                  onClick={() => setRetryKey((v) => v + 1)}
                >
                  {intl.formatMessage({ id: "shared.qrScanner.retryPermission" })}
                </button>
              )}
              {permissionRecovery === "settings" && (
                <button
                  type="button"
                  className="qrs-settings hy-press"
                  onClick={() => void openCameraPermissionSettings()}
                >
                  {intl.formatMessage({ id: "shared.qrScanner.openSettings" })}
                </button>
              )}
              <button type="button" className="qrs-manual hy-press" onClick={onClose}>
                {intl.formatMessage({ id: "shared.qr.enterManually" })}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
