import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useIntl } from "react-intl";

interface QrCodeProps {
  /** QR 에 인코딩할 문자열(딥링크·코드 등). */
  value: string;
  /** 픽셀 크기(정사각). 기본 220. */
  size?: number;
  /** 어두운 모듈 색(기본 잉크). */
  dark?: string;
  /** 밝은 배경 색(기본 흰색). */
  light?: string;
  /** 스크린리더 라벨. */
  label?: string;
}

/**
 * 페어링 코드 등을 실제 QR 로 렌더(canvas).
 * qrcode 브라우저 빌드의 toCanvas 사용 — fs 의존 없음, 오프라인 동작.
 * 생성 실패 시 조용히 빈 상태 유지(상위에서 코드 텍스트로 대체 안내).
 */
export function QrCode({ value, size = 220, dark = "#2A2327", light = "#FFFFFF", label }: QrCodeProps) {
  const intl = useIntl();
  const accessibleLabel = label ?? intl.formatMessage({ id: "shared.qr.label" });
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !value) return;
    let alive = true;
    setFailed(false);
    QRCode.toCanvas(el, value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark, light },
    }).catch(() => {
      if (alive) setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [value, size, dark, light]);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={intl.formatMessage({ id: "shared.qr.failedLabel" }, { label: accessibleLabel })}
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "var(--type-caption)",
          fontWeight: 700,
          color: "var(--fg-muted, #999)",
          background: light,
          borderRadius: 12,
        }}
      >
        {intl.formatMessage({ id: "shared.qr.enterManually" })}
      </div>
    );
  }

  return <canvas ref={ref} width={size} height={size} role="img" aria-label={accessibleLabel} style={{ borderRadius: 12 }} />;
}
