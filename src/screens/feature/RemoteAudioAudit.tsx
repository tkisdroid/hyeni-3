import { AlertTriangle, ChevronLeft, FileClock, RefreshCw, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router";
import { useIntl, type IntlShape } from "react-intl";
import { useRemoteListenAudit } from "@/queries/useRemoteAudit";
import type { RemoteListenAuditRecord } from "@/lib/api/endpoints/remoteAudit";
import type { SupportedLocale } from "@/i18n/locale";
import { useLocale } from "@/i18n/useLocale";
import {
  formatDateTime,
  LEGACY_FAMILY_TIME_ZONE,
} from "@/i18n/format";
import "./RemoteAudioAudit.css";

function parseServerDate(value: string): Date | null {
  const normalized = value.trim().replace(" ", "T").replace(/\+00(?::?00)?$/, "Z");
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

function auditDateTime(value: string, locale: SupportedLocale, intl: IntlShape): string {
  const date = parseServerDate(value);
  if (!date) return intl.formatMessage({ id: "notifications.remoteAudio.audit.timeUnavailable" });
  return formatDateTime(date, {
    locale,
    timeZone: LEGACY_FAMILY_TIME_ZONE,
    dateStyle: "short",
    timeStyle: "short",
  });
}

function statusFor(item: RemoteListenAuditRecord, intl: IntlShape): { label: string; tone: "safe" | "warning" | "info" } {
  if (item.endedAt) {
    const durationSec = item.durationMs == null ? null : Math.max(0, Math.round(item.durationMs / 1000));
    if (durationSec == null) return { label: intl.formatMessage({ id: "notifications.remoteAudio.audit.status" }, { state: "ended" }), tone: "safe" };
    // 0초 세션은 실제로 듣지 못한 상태로 별도 표시한다.
    if (durationSec === 0) return { label: intl.formatMessage({ id: "notifications.remoteAudio.audit.status" }, { state: "noListening" }), tone: "safe" };
    return { label: intl.formatMessage({ id: "notifications.remoteAudio.audit.listened" }, { duration: durationSec }), tone: "safe" };
  }
  const started = parseServerDate(item.startedAt)?.getTime() ?? 0;
  const recent = started > 0 && Date.now() - started <= 2 * 60_000;
  return recent
    ? { label: intl.formatMessage({ id: "notifications.remoteAudio.audit.status" }, { state: "checking" }), tone: "info" }
    : { label: intl.formatMessage({ id: "notifications.remoteAudio.audit.status" }, { state: "needsReview" }), tone: "warning" };
}

function reasonLabel(reason: string | null, intl: IntlShape): string | null {
  if (!reason) return null;
  const state = reason.startsWith("command_http_") ? "commandFailed" : reason;
  return intl.formatMessage({ id: "notifications.remoteAudio.audit.reason" }, { state });
}

export function RemoteAudioAudit() {
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const audit = useRemoteListenAudit();
  const items = audit.data ?? [];

  return (
    <div className="raa-root">
      <header className="raa-header">
        <button type="button" className="raa-back hy-press" aria-label={intl.formatMessage({ id: "core.action.back" })} onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <div className="raa-head-main">
          <div className="raa-title">{intl.formatMessage({ id: "notifications.remoteAudio.audit.title" })}</div>
          <div className="raa-subtitle">{intl.formatMessage({ id: "notifications.remoteAudio.audit.subtitle" })}</div>
        </div>
        <button
          type="button"
          className="raa-refresh hy-press"
          aria-label={intl.formatMessage({ id: "notifications.remoteAudio.audit.refresh" })}
          onClick={() => void audit.refetch()}
          disabled={audit.isFetching} aria-busy={audit.isFetching}
        >
          <RefreshCw size={18} strokeWidth={2.3} aria-hidden="true" />
        </button>
      </header>

      <div className="raa-content">
        <section className="raa-hero">
          <div className="raa-hero__icon">
            <ShieldCheck size={30} strokeWidth={2.2} />
          </div>
          <div>
            <b>{intl.formatMessage({ id: "notifications.remoteAudio.audit.heroTitle" })}</b>
            <p>{intl.formatMessage({ id: "notifications.remoteAudio.audit.contentNotStored" })}</p>
          </div>
        </section>

        <section className="hy-card raa-section" aria-busy={audit.isLoading || audit.isFetching}>
          <div className="raa-section__head">
            <FileClock size={20} strokeWidth={2.2} />
            <b>{intl.formatMessage({ id: "notifications.remoteAudio.audit.listTitle" })}</b>
          </div>
          {audit.isLoading ? (
            <div className="raa-empty" role="status">
              <RefreshCw className="raa-spin" size={30} strokeWidth={2.1} />
              <b>{intl.formatMessage({ id: "notifications.remoteAudio.audit.loading" })}</b>
            </div>
          ) : audit.isError ? (
            <div className="raa-empty raa-empty--error" role="alert">
              <AlertTriangle size={32} strokeWidth={2.1} />
              <b>{intl.formatMessage({ id: "notifications.remoteAudio.audit.loadFailed" })}</b>
              <p>{intl.formatMessage({ id: "notifications.remoteAudio.audit.retryDescription" })}</p>
              <button type="button" className="raa-retry hy-press" onClick={() => void audit.refetch()}>
                {intl.formatMessage({ id: "core.action.reload" })}
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="raa-empty">
              <FileClock size={34} strokeWidth={2.1} />
              <b>{intl.formatMessage({ id: "notifications.remoteAudio.audit.emptyTitle" })}</b>
              <p>{intl.formatMessage({ id: "notifications.remoteAudio.audit.emptyDescription" })}</p>
            </div>
          ) : (
            <div className="raa-list">
              {items.map((item) => {
                const status = statusFor(item, intl);
                const reason = reasonLabel(item.endReason, intl);
                return (
                  <article key={item.id} className="raa-item">
                    <div className="raa-item__main">
                      <b>{intl.formatMessage({ id: "notifications.remoteAudio.audit.itemTitle" }, { child: item.childName })}</b>
                      <span>{intl.formatMessage(
                        { id: "notifications.remoteAudio.audit.requestedBy" },
                        { initiator: item.initiatorName, time: auditDateTime(item.startedAt, locale, intl) },
                      )}</span>
                    </div>
                    <div className="raa-item__status">
                      <span className="raa-status" data-tone={status.tone}>{status.label}</span>
                      {reason && <small>{reason}</small>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="hy-card raa-section">
          <div className="raa-section__head">
            <ShieldCheck size={20} strokeWidth={2.2} />
            <b>{intl.formatMessage({ id: "notifications.remoteAudio.audit.privacyTitle" })}</b>
          </div>
          <div className="raa-note hy-explain">
            <span className="hy-explain__lines">
              <span className="hy-explain__line">{intl.formatMessage({ id: "notifications.remoteAudio.audit.viewOnly" })}</span>
              <span className="hy-explain__line">{intl.formatMessage({ id: "notifications.remoteAudio.audit.privacyDetail" })}</span>
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
