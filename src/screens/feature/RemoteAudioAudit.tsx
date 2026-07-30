import { AlertTriangle, ChevronLeft, FileClock, RefreshCw, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useRemoteListenAudit } from "@/queries/useRemoteAudit";
import type { RemoteListenAuditRecord } from "@/lib/api/endpoints/remoteAudit";
import "./RemoteAudioAudit.css";

function parseServerDate(value: string): Date | null {
  const normalized = value.trim().replace(" ", "T").replace(/\+00(?::?00)?$/, "Z");
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDateTime(value: string): string {
  const date = parseServerDate(value);
  if (!date) return "시각 확인 불가";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function statusFor(item: RemoteListenAuditRecord): { label: string; tone: "safe" | "warning" | "info" } {
  if (item.endedAt) {
    const durationSec = item.durationMs == null ? null : Math.max(0, Math.round(item.durationMs / 1000));
    if (durationSec == null) return { label: "종료됨", tone: "safe" };
    // 0초는 "0초 후 종료"라고 쓰면 문장이 어색하고 실제로도 '듣지 못한' 세션이다.
    if (durationSec === 0) return { label: "청취 없이 종료", tone: "safe" };
    return { label: `${durationSec}초 청취`, tone: "safe" };
  }
  const started = parseServerDate(item.startedAt)?.getTime() ?? 0;
  const recent = started > 0 && Date.now() - started <= 2 * 60_000;
  return recent
    ? { label: "진행 상태 확인 중", tone: "info" }
    : { label: "종료 기록 확인 필요", tone: "warning" };
}

function reasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  const labels: Record<string, string> = {
    timeout: "1분 자동 종료",
    user_stop: "보호자가 종료",
    unmount: "화면 이탈로 종료",
    command_failed: "아이 기기 연결 실패",
    no_target_device: "대상 기기 없음",
  };
  if (labels[reason]) return labels[reason];
  if (reason.startsWith("command_http_")) return "청취 명령 실패";
  return "종료됨";
}

export function RemoteAudioAudit() {
  const navigate = useNavigate();
  const audit = useRemoteListenAudit();
  const items = audit.data ?? [];

  return (
    <div className="raa-root">
      <header className="raa-header">
        <button type="button" className="raa-back hy-press" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <div className="raa-head-main">
          <div className="raa-title">주변 소리 듣기 기록</div>
          <div className="raa-subtitle">누가 언제 요청했는지 투명하게 확인해요</div>
        </div>
        <button
          type="button"
          className="raa-refresh hy-press"
          aria-label="기록 새로고침"
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
            <b>청취 전에 기록부터 남깁니다</b>
            <p>요청자·대상 아이·시작·종료 정보만 저장하며, 들은 오디오 내용은 보관하지 않습니다.</p>
          </div>
        </section>

        <section className="hy-card raa-section" aria-busy={audit.isLoading || audit.isFetching}>
          <div className="raa-section__head">
            <FileClock size={20} strokeWidth={2.2} />
            <b>기록 목록</b>
          </div>
          {audit.isLoading ? (
            <div className="raa-empty" role="status">
              <RefreshCw className="raa-spin" size={30} strokeWidth={2.1} />
              <b>기록을 확인하고 있어요</b>
            </div>
          ) : audit.isError ? (
            <div className="raa-empty raa-empty--error" role="alert">
              <AlertTriangle size={32} strokeWidth={2.1} />
              <b>기록을 불러오지 못했어요</b>
              <p>네트워크를 확인한 뒤 다시 시도해 주세요.</p>
              <button type="button" className="raa-retry hy-press" onClick={() => void audit.refetch()}>
                다시 불러오기
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="raa-empty">
              <FileClock size={34} strokeWidth={2.1} />
              <b>아직 청취 기록이 없어요</b>
              <p>주변 소리 듣기를 실행하면 요청자와 시작·종료 정보가 여기에 표시됩니다.</p>
            </div>
          ) : (
            <div className="raa-list">
              {items.map((item) => {
                const status = statusFor(item);
                const reason = reasonLabel(item.endReason);
                return (
                  <article key={item.id} className="raa-item">
                    <div className="raa-item__main">
                      <b>{item.childName} 주변 소리</b>
                      <span>{item.initiatorName} 요청 · {formatDateTime(item.startedAt)}</span>
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
            <b>개인정보 · 안전 안내</b>
          </div>
          <div className="raa-note hy-explain">
            <span className="hy-explain__lines">
              <span className="hy-explain__line">이 화면은 감사 기록 조회 전용이며 청취를 시작하지 않습니다.</span>
              <span className="hy-explain__line">기록에는 요청자와 대상, 시작·종료 시각, 종료 사유만 포함되고 실시간 오디오 내용은 저장하지 않습니다.</span>
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
