import { ChevronLeft, FileClock, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import "./RemoteAudioAudit.css";

export interface RemoteAudioAuditItem {
  id: string;
  childName: string;
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  status: "started" | "ended" | "failed";
  reason?: string;
}

const auditItems: readonly RemoteAudioAuditItem[] = [];

export function RemoteAudioAudit() {
  const navigate = useNavigate();

  return (
    <div className="raa-root">
      <header className="raa-header">
        <button type="button" className="raa-back hy-press" aria-label="뒤로" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        <div className="raa-head-main">
          <div className="raa-title">주변 소리 듣기 기록</div>
          <div className="raa-subtitle">안전 확인 기록을 투명하게 관리해요</div>
        </div>
      </header>

      <div className="raa-content">
        <section className="raa-hero">
          <div className="raa-hero__icon">
            <ShieldCheck size={30} strokeWidth={2.2} />
          </div>
          <div>
            <b>가족의 안전과 투명성을 위해 기록을 남깁니다</b>
            <p>주변 소리 듣기 시작, 종료, 실패 이력을 확인할 수 있는 화면입니다.</p>
          </div>
        </section>

        <section className="hy-card raa-section">
          <div className="raa-section__head">
            <FileClock size={20} strokeWidth={2.2} />
            <b>기록 목록</b>
          </div>
          {auditItems.length === 0 ? (
            <div className="raa-empty">
              <FileClock size={34} strokeWidth={2.1} />
              <b>아직 표시할 청취 기록이 없어요</b>
              <p>청취 기록은 안전 확인을 위해 저장될 예정이에요.</p>
            </div>
          ) : (
            <div className="raa-list">
              {auditItems.map((item) => (
                <div key={item.id} className="raa-item">
                  <b>{item.childName}</b>
                  <span>{item.startedAt}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="hy-card raa-section">
          <div className="raa-section__head">
            <ShieldCheck size={20} strokeWidth={2.2} />
            <b>개인정보 · 안전 안내</b>
          </div>
          <div className="raa-note">
            이 화면은 조회와 안내 전용입니다. 실제 주변 소리 듣기 명령은 실행하지 않으며, 서버에 감사 로그
            endpoint가 연결되면 이 목록에 실제 기록만 표시합니다.
          </div>
        </section>
      </div>
    </div>
  );
}
