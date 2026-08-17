import { useState } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, RefreshCw, Download, Trash2, Users } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/app/toast";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { useAccount, useExportFamilyData } from "@/queries/useAccount";
import { useMyFamily } from "@/queries/useFamily";
import { serializeDataExport } from "@/lib/api/endpoints/account";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import "./DataSync.css";

function nowLabel(): string {
  return new Date().toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** P-32 데이터 · 동기화 — 동기화 상태·데이터 내보내기(JSON)·캐시 비우기. */
export function DataSync() {
  const navigate = useNavigate();
  const { show } = useToast();
  const qc = useQueryClient();
  const accountQuery = useAccount();
  const { account } = accountQuery;
  const familyQuery = useMyFamily();
  const family = familyQuery.data;
  const exportData = useExportFamilyData();

  const [syncedAt, setSyncedAt] = useState<string>(nowLabel());

  const members = family?.members ?? [];
  const parentCount = members.filter((m) => m.role === "parent").length;
  const childCount = members.filter((m) => m.role === "child").length;
  const memberCount = parentCount + childCount;
  const dataSyncQueryState = resolveQueryTruthState([
    { isLoading: accountQuery.isLoading, isError: accountQuery.isError },
    { isLoading: familyQuery.isLoading, isError: familyQuery.isError },
  ]);
  const dataSyncEmpty = dataSyncQueryState === "ready" && (!account || !family || members.length === 0);
  const dataSyncRefetching = accountQuery.isFetching || familyQuery.isFetching;
  const retryDataSync = async (): Promise<void> => {
    await Promise.all([accountQuery.refetch(), familyQuery.refetch()]);
  };
  const countReady = !!family;
  const formatCount = (count: number) => (countReady ? `${count}명` : familyQuery.isLoading ? "불러오는 중" : "확인 안 됨");

  // 지금 동기화 — 전 쿼리 무효화(서버 최신값 재요청). 실제 리페치 트리거.
  const resync = () => {
    void qc.invalidateQueries();
    setSyncedAt(nowLabel());
    show("최신 데이터를 다시 불러오고 있어요", "🔄");
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
            errCount > 0 ? `내보내기 완료 · 일부 항목 제외(${errCount})` : "데이터를 내려받았어요",
            "📦",
          );
        } catch (e) {
          console.error("데이터 파일 저장 실패:", e);
          show("파일 저장에 실패했어요", "⚠️");
        }
      },
      onError: (e) => {
        console.error("데이터 내보내기 실패:", e);
        show("데이터를 모으지 못했어요. 잠시 후 다시 시도해 주세요", "⚠️");
      },
    });
  };

  // 캐시 비우기 — 로컬 쿼리 캐시 전체 제거(다음 조회 시 서버에서 새로 받음).
  const clearCache = () => {
    qc.clear();
    setSyncedAt(nowLabel());
    show("임시 데이터를 비웠어요", "🧹");
  };

  if (dataSyncQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle="데이터 · 동기화"
        state="loading"
        heading="가족 데이터를 확인하고 있어요"
        description="계정과 가족 범위를 불러오고 있어요."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (dataSyncQueryState === "error") {
    return (
      <ScreenQueryState
        screenTitle="데이터 · 동기화"
        state="error"
        heading="동기화 정보를 불러오지 못했어요"
        description="잘못된 파일을 만들지 않으려고 내보내기를 닫았어요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryDataSync()}
        retrying={dataSyncRefetching}
      />
    );
  }

  if (dataSyncEmpty) {
    return (
      <ScreenQueryState
        screenTitle="데이터 · 동기화"
        state="empty"
        heading="내보낼 가족 정보가 없어요"
        description="계정과 가족 연결 상태를 다시 확인해 주세요."
        onBack={() => navigate(-1)}
        onRetry={() => void retryDataSync()}
        retrying={dataSyncRefetching}
        retryLabel="연결 상태 다시 확인"
      />
    );
  }

  return (
    <div className="ds-root hy-rise-in">
      <header className="ds-head">
        <button
          type="button"
          className="ds-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="ds-head-title">데이터 · 동기화</span>
      </header>

      <div className="ds-content">
        {/* 동기화 상태 */}
        <div className="ds-sync">
          <div className="ds-sync__top">
            <span className="ds-sync__dot" />
            <span className="ds-sync__state">실시간 동기화 켜짐</span>
          </div>
          <div className="ds-sync__rows">
            <div className="ds-sync__row">
              <span className="ds-sync__k">
                <Users size={14} strokeWidth={2.3} /> 가족 구성원
              </span>
              <span className="ds-sync__v">{formatCount(memberCount)}</span>
            </div>
            <div className="ds-sync__row">
              <span className="ds-sync__k">부모</span>
              <span className="ds-sync__v">{formatCount(parentCount)}</span>
            </div>
            <div className="ds-sync__row">
              <span className="ds-sync__k">관리 중인 아이</span>
              <span className="ds-sync__v">{formatCount(childCount)}</span>
            </div>
            <div className="ds-sync__row">
              <span className="ds-sync__k">마지막 동기화</span>
              <span className="ds-sync__v">{syncedAt}</span>
            </div>
          </div>
          <button type="button" className="ds-sync__btn hy-press" onClick={resync}>
            <RefreshCw size={16} strokeWidth={2.4} />
            지금 동기화
          </button>
        </div>

        {/* 내 데이터 다운로드 */}
        <div className="ds-card">
          <div className="ds-card__icon ds-card__icon--blue">
            <Download size={20} strokeWidth={2.2} />
          </div>
          <div className="ds-card__main">
            <div className="ds-card__title">내 데이터 다운로드</div>
            <div className="ds-card__desc">
              일정·장소·학원 정보를 파일로 저장해요.
            </div>
          </div>
          <button
            type="button"
            className="ds-card__cta hy-press"
            onClick={exportJson}
            disabled={exportData.isPending || !account} aria-busy={exportData.isPending}
          >
            {exportData.isPending ? "모으는 중…" : "내보내기"}
          </button>
        </div>
        <div className="ds-note hy-explain">위치 이력과 대화는 이 파일에 들어가지 않아요.</div>

        {/* 캐시 비우기 */}
        <div className="ds-card">
          <div className="ds-card__icon ds-card__icon--rose">
            <Trash2 size={20} strokeWidth={2.2} />
          </div>
          <div className="ds-card__main">
            <div className="ds-card__title">임시 데이터 비우기</div>
            <div className="ds-card__desc">
              임시 저장만 지워요. 계정·가족 데이터는 그대로예요.
            </div>
          </div>
          <button type="button" className="ds-card__cta ds-card__cta--ghost hy-press" onClick={clearCache}>
            비우기
          </button>
        </div>
      </div>
    </div>
  );
}
