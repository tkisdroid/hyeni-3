/**
 * QR 카메라 스캐너 오버레이(hyeni-1 QrPairScanner 이관).
 * BarcodeDetector(Android WebView/Chrome 내장) + getUserMedia(후면 카메라).
 * 권한 흐름: 네이티브 CameraPermissionPlugin > 브라우저 permissions > getUserMedia 오류.
 * 미지원 기기(BarcodeDetector 없음)는 정직하게 안내 → 코드 직접 입력으로 유도.
 * 아이 연결 단계는 페어링 안내 규칙에 맞춰 존댓말을 사용한다.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import { ensureQrCameraPermission, openCameraPermissionSettings } from "@/lib/native/cameraPermission";
import "./QrScanner.css";

// BarcodeDetector 는 TS lib 에 없어 최소 형태만 선언(Shape Detection API).
interface DetectedBarcode {
  rawValue?: string;
}
interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

const PERMISSION_MSG = "카메라를 사용하려면 권한이 필요해요. 허용한 뒤 다시 시도해 주세요.";

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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef(0);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const handledRef = useRef(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingLabel, setLoadingLabel] = useState("카메라 허용 확인 중…");
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
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

    const scanFrame = async () => {
      if (!active || handledRef.current || !videoRef.current || !detectorRef.current) return;
      try {
        const codes = await detectorRef.current.detect(videoRef.current);
        const rawValue = codes.find((c) => typeof c.rawValue === "string")?.rawValue;
        if (rawValue) {
          handledRef.current = true;
          await onDetected(rawValue);
          stopScanner();
          return;
        }
      } catch {
        // 간헐적 detect 실패는 무시하고 다음 프레임
      }
      frameRef.current = requestAnimationFrame(() => void scanFrame());
    };

    const startScanner = async () => {
      handledRef.current = false;
      setError("");
      setPermissionDenied(false);
      setLoading(true);
      setLoadingLabel("카메라 허용 확인 중…");

      const permission = await ensureQrCameraPermission();
      if (!active) return;
      if (!permission.granted) {
        setPermissionDenied(true);
        setError(PERMISSION_MSG);
        setLoading(false);
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setError("이 기기에서는 카메라를 사용할 수 없어요. 코드를 직접 입력해 주세요.");
        setLoading(false);
        return;
      }
      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (typeof Detector !== "function") {
        setError("이 기기에서는 QR 스캔을 할 수 없어요. 코드를 직접 입력해 주세요.");
        setLoading(false);
        return;
      }

      try {
        setLoadingLabel("QR 스캔 시작 중…");
        detectorRef.current = new Detector({ formats: ["qr_code"] });
        setLoadingLabel("카메라 여는 중…");
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
        setError(denied ? PERMISSION_MSG : "카메라를 열 수 없어요. 잠시 후 다시 시도해 주세요.");
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
          ← 닫기
        </button>
        <span id={titleId} className="qrs-title"><Camera size={16} strokeWidth={2.4} /> QR 코드 스캔</span>
      </div>

      <div className="qrs-body">
        <div className="qrs-cam">
          <video ref={videoRef} muted playsInline className="qrs-video" />
          <div className="qrs-frame" aria-hidden="true" />
          {loading && <div className="qrs-loading">{loadingLabel}</div>}
        </div>
        <div className="qrs-guide">
          <div className="qrs-guide-title">부모님 화면의 QR 코드를 비춰 주세요</div>
          <div id={descriptionId} className="qrs-guide-sub">QR을 인식하면 코드를 입력하지 않아도 바로 연결돼요</div>
          {error && <div className="qrs-error">{error}</div>}
          {permissionDenied && (
            <div className="qrs-actions">
              <button
                type="button"
                className="qrs-retry hy-press"
                onClick={() => setRetryKey((v) => v + 1)}
              >
                허용 다시 확인
              </button>
              <button
                type="button"
                className="qrs-settings hy-press"
                onClick={() => void openCameraPermissionSettings()}
              >
                앱 설정 열기
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
