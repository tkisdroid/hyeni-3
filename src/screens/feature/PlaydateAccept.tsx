import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, MapPin, Check } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import {
  usePendingPlaydateInvites,
  useActivePlaydateSession,
  useAcceptPlaydateInvite,
  useDeclinePlaydateInvite,
} from "@/queries/usePlaydate";
import type { PlaydateInvite } from "@/lib/api/endpoints/playdate";
import "./PlaydateAccept.css";

/** 친구 아바타(도메인엔 이름만 있어 index 파생). */
const FRIEND_ANIMALS = ["animal/bear.webp", "animal/fox.webp", "animal/cat.webp", "animal/rabbit.webp"];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "";
}

/** 서버 에러코드 → 부모 눈높이 안내(존댓말). */
function friendlyError(e: unknown): string {
  const m = errMsg(e);
  if (m === "forbidden") return "수락·거절은 아이가 아이 기기에서 할 수 있어요.";
  if (m === "invite_expired") return "요청이 만료됐어요.";
  if (m === "invite_not_pending") return "이미 처리된 요청이에요.";
  if (m === "already_active") return "이미 놀이 중인 친구예요.";
  return m || "잠시 후 다시 시도해주세요.";
}

/** expires_at(ISO) → "N분 후 만료" 라벨(만료면 null). */
function expiresLabel(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return null;
  const mins = Math.max(1, Math.round(ms / 60000));
  return `${mins}분 후 만료`;
}

export function PlaydateAccept() {
  const navigate = useNavigate();
  const { show } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const pendingQ = usePendingPlaydateInvites();
  const activeQ = useActivePlaydateSession();
  const accept = useAcceptPlaydateInvite();
  const decline = useDeclinePlaydateInvite();

  const active = activeQ.data ?? null;
  const incoming = (pendingQ.data ?? []).filter(
    (i) => i.direction === "incoming" && i.status === "pending",
  );

  const onAccept = async (invite: PlaydateInvite) => {
    setBusyId(invite.id);
    try {
      await accept.mutateAsync(invite.id);
      show("놀이 약속이 연결됐어요!", "🎈");
      await Promise.all([pendingQ.refetch(), activeQ.refetch()]);
    } catch (e) {
      show(friendlyError(e), "🎈");
    } finally {
      setBusyId(null);
    }
  };

  const onDecline = async (invite: PlaydateInvite) => {
    setBusyId(invite.id);
    try {
      await decline.mutateAsync(invite.id);
      show("요청을 거절했어요.", "🎈");
      await pendingQ.refetch();
    } catch (e) {
      show(friendlyError(e), "🎈");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="pa-screen">
      <div className="pa-header">
        <button
          type="button"
          className="pa-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="pa-header__title">놀이 요청</span>
      </div>

      <div className="pa-content">
        <p className="pa-intro">
          근처 친구가 보낸 놀이 요청이에요. 확인하고 <b>수락</b>하면 함께 놀이가 시작돼요.
        </p>

        {/* 진행 중 세션(연결됨) */}
        {active ? (
          <div className="pa-active">
            <span className="pa-active__badge">
              <Check size={14} strokeWidth={2.6} color="var(--mint-text)" />
              놀이 연결됨
            </span>
            <span className="pa-active__text">
              {active.friend_child_name ?? "친구"}
              {active.place_name ? ` · ${active.place_name}` : ""} 에서 놀이 중이에요.
            </span>
          </div>
        ) : null}

        {incoming.length === 0 ? (
          <div className="pa-empty">
            <img className="pa-empty__img" src={asset("ui/menu-friend-playdate.webp")} alt="" />
            <div className="pa-empty__title">받은 놀이 요청이 없어요</div>
            <div className="pa-empty__sub">
              근처 친구가 “같이 놀자”를 보내면 여기에 표시돼요.
            </div>
          </div>
        ) : (
          incoming.map((r, i) => {
            const expires = expiresLabel(r.expires_at);
            const busy = busyId === r.id;
            return (
              <div key={r.id} className="hy-card pa-card">
                <div className="pa-card__head">
                  <span className="pa-avatars">
                    <span className="pa-avatar">
                      <img
                        src={asset(FRIEND_ANIMALS[i % FRIEND_ANIMALS.length])}
                        alt=""
                      />
                    </span>
                  </span>
                  <span className="pa-who">
                    <span className="pa-who__name">
                      {r.friend_child_name ?? "친구"} 친구
                    </span>
                    <span className="pa-who__when">
                      지금 · 근처 친구{expires ? ` · ${expires}` : ""}
                    </span>
                  </span>
                </div>

                <div className="pa-place">
                  <MapPin size={14} strokeWidth={2} color="var(--fg-muted)" />
                  {r.place_name ?? "현재 장소"}
                </div>

                <div className="pa-note">“{r.friend_child_name ?? "친구"}(이)랑 같이 놀고 싶어요!”</div>

                <div className="pa-actions">
                  <button
                    type="button"
                    className="pa-btn-decline hy-press"
                    onClick={() => onDecline(r)}
                    disabled={busy}
                  >
                    거절
                  </button>
                  <button
                    type="button"
                    className="pa-btn-accept hy-press"
                    onClick={() => onAccept(r)}
                    disabled={busy}
                  >
                    🎈 {busy ? "처리 중…" : "수락하기"}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
