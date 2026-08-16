import { useState } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, RefreshCw, Download, Trash2, Users } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/app/toast";
import { useIntl } from "react-intl";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { useAccount, useExportFamilyData } from "@/queries/useAccount";
import { useMyFamily } from "@/queries/useFamily";
import { serializeDataExport } from "@/lib/api/endpoints/account";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import { useLocale } from "@/i18n/useLocale";
import {
  formatClockWithSeconds,
  LEGACY_FAMILY_TIME_ZONE,
} from "@/i18n/format";
import "./DataSync.css";

/** P-32 데이터 · 동기화 — 동기화 상태·데이터 내보내기(JSON)·캐시 비우기. */
export function DataSync() {
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const { show } = useToast();
  const qc = useQueryClient();
  const accountQuery = useAccount();
  const { account } = accountQuery;
  const familyQuery = useMyFamily();
  const family = familyQuery.data;
  const exportData = useExportFamilyData();

  const [syncedAt, setSyncedAt] = useState<Date | null>(() => new Date());
  const [resyncing, setResyncing] = useState(false);

  const members = family?.members ?? [];
  const parentCount = members.filter((m) => m.role === "parent").length;
  const childCount = members.filter((m) => m.role === "child").length;
  const memberCount = parentCount + childCount;
  const dataSyncQueryState = resolveQueryTruthState([
    { isLoading: accountQuery.isLoading, isError: accountQuery.isError },
    { isLoading: familyQuery.isLoading, isError: familyQuery.isError },
  ]);
  const dataSyncEmpty = dataSyncQueryState === "ready" && (!account || !family || members.length === 0);
  const dataSyncRefetching = accountQuery.isFetching || familyQuery.isFetching || resyncing;
  const retryDataSync = async (): Promise<void> => {
    await Promise.all([accountQuery.refetch(), familyQuery.refetch()]);
  };
  const countReady = !!family;
  const formatCount = (count: number) => (
    countReady
      ? intl.formatMessage({ id: "parent.dataSync.memberCount" }, { count })
      : familyQuery.isLoading
        ? intl.formatMessage({ id: "parent.dataSync.value.loading" })
        : intl.formatMessage({ id: "parent.dataSync.value.unavailable" })
  );
  const formattedSyncedAt = syncedAt
    ? formatClockWithSeconds(syncedAt, {
        locale,
        timeZone: LEGACY_FAMILY_TIME_ZONE,
      })
    : intl.formatMessage({ id: "parent.dataSync.value.unavailable" });

  // 지금 동기화 — 전 쿼리 무효화(서버 최신값 재요청). 실제 리페치 트리거.
  const resync = async (): Promise<void> => {
    if (resyncing) return;
    setResyncing(true);
    show(intl.formatMessage({ id: "parent.dataSync.resync.started" }), "🔄");
    try {
      await qc.invalidateQueries();
      const [accountResult, familyResult] = await Promise.all([
        accountQuery.refetch(),
        familyQuery.refetch(),
      ]);
      if (accountResult.isError || familyResult.isError) {
        show(intl.formatMessage({ id: "parent.dataSync.resync.failed" }), "⚠️");
        return;
      }
      setSyncedAt(new Date());
      show(intl.formatMessage({ id: "parent.dataSync.resync.success" }), "✅");
    } catch (error) {
      console.error("data_sync_failed", error);
      show(intl.formatMessage({ id: "parent.dataSync.resync.failed" }), "⚠️");
    } finally {
      setResyncing(false);
    }
  };

  // 내 데이터 다운로드 — 실 가족 데이터를 집계해 JSON 파일로 저장(데이터 이동권).
  const exportJson = () => {
    exportData.mutate(undefined, {
      onSuccess: (result) => {
        try {
          const json = serializeDataExport(result);
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const stamp = new Date().toISOString().slice(0, 10);
          a.href = url;
          a.download = `hyeni-data-${stamp}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          const errCount = result.meta.errors.length;
          show(
            errCount > 0
              ? intl.formatMessage(
                  { id: "parent.dataSync.export.partial" },
                  { errorCount: errCount },
                )
              : intl.formatMessage({ id: "parent.dataSync.export.success" }),
            "📦",
          );
        } catch (e) {
          console.error("data_export_file_save_failed", e);
          show(intl.formatMessage({ id: "parent.dataSync.export.fileFailure" }), "⚠️");
        }
      },
      onError: (e) => {
        console.error("data_export_failed", e);
        show(intl.formatMessage({ id: "parent.dataSync.export.failure" }), "⚠️");
      },
    });
  };

  // 캐시 비우기 — 로컬 쿼리 캐시 전체 제거(다음 조회 시 서버에서 새로 받음).
  const clearCache = () => {
    qc.clear();
    setSyncedAt(null);
    show(intl.formatMessage({ id: "parent.dataSync.cache.cleared" }), "🧹");
  };

  if (dataSyncQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "parent.dataSync.title" })}
        state="loading"
        heading={intl.formatMessage({ id: "parent.dataSync.loading.heading" })}
        description={intl.formatMessage({ id: "parent.dataSync.loading.description" })}
        onBack={() => navigate(-1)}
      />
    );
  }

  if (dataSyncQueryState === "error") {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "parent.dataSync.title" })}
        state="error"
        heading={intl.formatMessage({ id: "parent.dataSync.error.heading" })}
        description={intl.formatMessage({ id: "parent.dataSync.error.description" })}
        onBack={() => navigate(-1)}
        onRetry={() => void retryDataSync()}
        retrying={dataSyncRefetching}
      />
    );
  }

  if (dataSyncEmpty) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "parent.dataSync.title" })}
        state="empty"
        heading={intl.formatMessage({ id: "parent.dataSync.empty.heading" })}
        description={intl.formatMessage({ id: "parent.dataSync.empty.description" })}
        onBack={() => navigate(-1)}
        onRetry={() => void retryDataSync()}
        retrying={dataSyncRefetching}
        retryLabel={intl.formatMessage({ id: "parent.dataSync.empty.retry" })}
      />
    );
  }

  return (
    <div className="ds-root hy-rise-in">
      <header className="ds-head">
        <button
          type="button"
          className="ds-back hy-press"
          aria-label={intl.formatMessage({ id: "core.action.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="ds-head-title">{intl.formatMessage({ id: "parent.dataSync.title" })}</span>
      </header>

      <div className="ds-content">
        {/* 동기화 상태 */}
        <div className="ds-sync">
          <div className="ds-sync__top">
            <span className="ds-sync__dot" />
            <span className="ds-sync__state">
              {resyncing
                ? intl.formatMessage({ id: "parent.dataSync.sync.refreshing" })
                : intl.formatMessage({ id: "parent.dataSync.sync.ready" })}
            </span>
          </div>
          <div className="ds-sync__rows">
            <div className="ds-sync__row">
              <span className="ds-sync__k">
                <Users size={14} strokeWidth={2.3} />
                {intl.formatMessage({ id: "parent.dataSync.familyMembers" })}
              </span>
              <span className="ds-sync__v">{formatCount(memberCount)}</span>
            </div>
            <div className="ds-sync__row">
              <span className="ds-sync__k">{intl.formatMessage({ id: "parent.dataSync.parents" })}</span>
              <span className="ds-sync__v">{formatCount(parentCount)}</span>
            </div>
            <div className="ds-sync__row">
              <span className="ds-sync__k">{intl.formatMessage({ id: "parent.dataSync.children" })}</span>
              <span className="ds-sync__v">{formatCount(childCount)}</span>
            </div>
            <div className="ds-sync__row">
              <span className="ds-sync__k">{intl.formatMessage({ id: "parent.dataSync.lastChecked" })}</span>
              <span className="ds-sync__v">
                {intl.formatMessage(
                  { id: "parent.dataSync.lastCheckedValue" },
                  { time: formattedSyncedAt },
                )}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="ds-sync__btn hy-press"
            onClick={() => void resync()}
            disabled={resyncing}
            aria-busy={resyncing}
          >
            <RefreshCw size={16} strokeWidth={2.4} />
            {resyncing
              ? intl.formatMessage({ id: "parent.dataSync.resync.buttonPending" })
              : intl.formatMessage({ id: "parent.dataSync.resync.button" })}
          </button>
        </div>

        {/* 내 데이터 다운로드 */}
        <div className="ds-card">
          <div className="ds-card__icon ds-card__icon--blue">
            <Download size={20} strokeWidth={2.2} />
          </div>
          <div className="ds-card__main">
            <div className="ds-card__title">{intl.formatMessage({ id: "parent.dataSync.export.title" })}</div>
            <div className="ds-card__desc">
              {intl.formatMessage({ id: "parent.dataSync.export.description" })}
            </div>
          </div>
          <button
            type="button"
            className="ds-card__cta hy-press"
            onClick={exportJson}
            disabled={exportData.isPending || !account} aria-busy={exportData.isPending}
          >
            {exportData.isPending
              ? intl.formatMessage({ id: "parent.dataSync.export.pending" })
              : intl.formatMessage({ id: "parent.dataSync.export.button" })}
          </button>
        </div>
        <div className="ds-note hy-explain">
          {intl.formatMessage({ id: "parent.dataSync.export.excluded" })}
        </div>

        {/* 캐시 비우기 */}
        <div className="ds-card">
          <div className="ds-card__icon ds-card__icon--rose">
            <Trash2 size={20} strokeWidth={2.2} />
          </div>
          <div className="ds-card__main">
            <div className="ds-card__title">{intl.formatMessage({ id: "parent.dataSync.cache.title" })}</div>
            <div className="ds-card__desc">
              {intl.formatMessage({ id: "parent.dataSync.cache.description" })}
            </div>
          </div>
          <button type="button" className="ds-card__cta ds-card__cta--ghost hy-press" onClick={clearCache}>
            {intl.formatMessage({ id: "parent.dataSync.cache.button" })}
          </button>
        </div>
      </div>
    </div>
  );
}
