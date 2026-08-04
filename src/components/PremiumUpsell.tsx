import { useEffect, useId, useRef, useState } from "react";
import { Check, Crown, X } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import { fetchWebBillingCatalog } from "@/lib/api/endpoints/webBilling";
import { getPlatform } from "@/lib/native/plugins";
import {
  recordPremiumFunnelEvent,
  type PremiumFunnelTier,
} from "@/lib/premiumFunnel";
import { TIERS, type Tier } from "@/transform/tierPolicy";
import {
  resolvePremiumUpsell,
  type PremiumUpsellSource,
  type PremiumUpsellUsage,
} from "@/transform/premiumUpsell";
import { validateWebBillingCatalog } from "@/transform/webBilling";
import "./PremiumUpsell.css";

interface PremiumUpsellProps {
  open: boolean;
  source: PremiumUpsellSource;
  tier: Tier;
  returnTo?: string;
  busy?: boolean;
  usage?: PremiumUpsellUsage;
  onClose: () => void;
  onUpgrade: (context: { source: PremiumUpsellSource; feature: string; returnTo?: string }) => void | Promise<void>;
}

export function PremiumUpsell({
  open,
  source,
  tier,
  returnTo,
  busy: externallyBusy = false,
  usage,
  onClose,
  onUpgrade,
}: PremiumUpsellProps) {
  const { familyId } = useAuth();
  const titleId = useId();
  const descriptionId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(false);
  const impressionSourceRef = useRef<PremiumUpsellSource | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [trialEligible, setTrialEligible] = useState(false);
  const content = resolvePremiumUpsell(source, usage);
  const busy = externallyBusy || submitting;
  const funnelTier: PremiumFunnelTier = tier === TIERS.PREMIUM
    ? "premium"
    : tier === TIERS.UNKNOWN
      ? "unknown"
      : "free";
  onCloseRef.current = onClose;
  busyRef.current = busy;

  const dialogRef = useDialogFocusLifecycle<HTMLElement>({
    open,
    onClose,
    initialFocusRef: titleRef,
    canClose: () => !busyRef.current,
  });

  useEffect(() => {
    if (!open) {
      impressionSourceRef.current = null;
      return;
    }
    setError("");
    if (impressionSourceRef.current === source) return;
    impressionSourceRef.current = source;
    recordPremiumFunnelEvent({
      event: "paywall_impression",
      source,
      tier: funnelTier,
    });
  }, [funnelTier, open, source]);

  useEffect(() => {
    setTrialEligible(false);
    if (!open || !familyId || tier === TIERS.PREMIUM || getPlatform() !== "web") return;
    let disposed = false;
    void fetchWebBillingCatalog(familyId)
      .then((value) => {
        const catalog = validateWebBillingCatalog(value);
        if (!disposed) {
          setTrialEligible(catalog.trialEligible === true && catalog.trialDays === 7);
        }
      })
      .catch(() => {
        if (!disposed) setTrialEligible(false);
      });
    return () => {
      disposed = true;
    };
  }, [familyId, open, tier]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let removeListener: (() => void) | null = null;
    void import("@capacitor/app")
      .then(async ({ App }) => {
        const handle = await App.addListener("backButton", () => {
          if (!busyRef.current) onCloseRef.current();
        });
        if (disposed) {
          await handle.remove();
          return;
        }
        removeListener = () => {
          void handle.remove();
        };
      })
      .catch(() => {
        // PWA에서는 브라우저 기본 뒤로가기를 유지하고 Escape/닫기 버튼을 사용한다.
      });
    return () => {
      disposed = true;
      removeListener?.();
    };
  }, [open]);

  if (!open) return null;

  const startUpgrade = async () => {
    if (busy) return;
    recordPremiumFunnelEvent({
      event: "paywall_cta",
      source,
      tier: funnelTier,
    });
    setSubmitting(true);
    setError("");
    try {
      await onUpgrade({ source, feature: content.feature, ...(returnTo ? { returnTo } : {}) });
    } catch (upgradeError) {
      setError(
        upgradeError instanceof Error && upgradeError.message.trim()
          ? upgradeError.message
          : "프리미엄 화면을 열지 못했어요. 다시 시도해 주세요.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const ctaLabel = trialEligible ? `7일 무료로 ${content.ctaLabel}` : content.ctaLabel;

  return (
    <div
      className="pu-layer"
      data-upsell-source={source}
      data-upsell-feature={content.feature}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="pu-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <button
          type="button"
          className="pu-close hy-press"
          aria-label="프리미엄 안내 닫기"
          onClick={onClose}
          disabled={busy}
        >
          <X size={21} strokeWidth={2.3} aria-hidden="true" />
        </button>

        <div className="pu-icon" aria-hidden="true">
          <Crown size={26} strokeWidth={2.3} />
        </div>
        <h2 ref={titleRef} tabIndex={-1} id={titleId}>{content.title}</h2>
        <div id={descriptionId} className="pu-copy">
          {content.usageLabel && <strong>{content.usageLabel}</strong>}
          <p>{content.description}</p>
          <p className="pu-value"><Check size={17} strokeWidth={2.5} aria-hidden="true" /> {content.premiumValue}</p>
        </div>

        {error && <p className="pu-error" role="alert">{error}</p>}

        <button
          type="button"
          className="pu-upgrade hy-press"
          onClick={() => void startUpgrade()}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? "프리미엄 화면 여는 중…" : ctaLabel}
        </button>
        <button
          type="button"
          className="pu-continue hy-press"
          aria-label="무료로 계속 쓰기"
          onClick={() => {
            recordPremiumFunnelEvent({
              event: "paywall_continue_free",
              source,
              tier: funnelTier,
            });
            onClose();
          }}
          disabled={busy}
        >
          {content.continueLabel}
        </button>
      </section>
    </div>
  );
}
