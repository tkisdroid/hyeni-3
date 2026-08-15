import { useState } from "react";
import { ChevronLeft, MapPin, Check, PartyPopper } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import {
  usePendingPlaydateInvites,
  useActivePlaydateSession,
  useAcceptPlaydateInvite,
  useDeclinePlaydateInvite,
} from "@/queries/usePlaydate";
import type { PlaydateInvite } from "@/lib/api/endpoints/playdate";
import { hasJongseong } from "@/transform/adventureMap";
import { useSafeBack } from "@/app/useSafeBack";
import { Loading } from "@/components/ui/Loading";
import { useLocale } from "@/i18n/useLocale";
import { formatRelativeMinutes } from "@/i18n/format";
import type { SupportedLocale } from "@/i18n/locale";
import "./PlaydateAccept.css";
import { isApiError } from "@/lib/api/errors";

/** 친구 아바타(도메인엔 이름만 있어 index 파생). */
const FRIEND_ANIMALS = ["animal/bear.webp", "animal/fox.webp", "animal/cat.webp", "animal/rabbit.webp"];

/** 서버 에러코드 → 아이 눈높이 안내(반말). */
function friendlyError(e: unknown): string {
  const m = isApiError(e) ? e.code : null;
  if (m === "forbidden") return "이 기기에서는 수락하거나 거절할 수 없어.";
  if (m === "invite_expired") return "요청이 만료됐어.";
  if (m === "invite_not_pending") return "이미 처리한 요청이야.";
  if (m === "already_active") return "이미 놀이 중인 친구야.";
  return "잠시 후 다시 시도해 줘.";
}

/** expires_at(ISO) → "N분 후 만료" 라벨(만료면 null). */
function expiresLabel(expiresAt: string | null, locale: SupportedLocale): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return null;
  const mins = Math.max(1, Math.round(ms / 60000));
  return `${formatRelativeMinutes(mins, "future", locale)} 만료`;
}

export function PlaydateAccept() {
  const { locale } = useLocale();
  const goBack = useSafeBack("/child/home");
  const { show } = useToast();
  const [busyAction, setBusyAction] = useState<{ inviteId: string; action: "accept" | "decline" } | null>(null);

  const pendingQ = usePendingPlaydateInvites();
  const activeQ = useActivePlaydateSession();
  const accept = useAcceptPlaydateInvite();
  const decline = useDeclinePlaydateInvite();

  const active = activeQ.data ?? null;
  const incoming = (pendingQ.data ?? []).filter(
    (i) => i.direction === "incoming" && i.status === "pending",
  );
  const playdateLoading = pendingQ.isLoading || activeQ.isLoading;
  const playdateError = pendingQ.isError || activeQ.isError;
  const retryPlaydates = async () => {
    await Promise.all([pendingQ.refetch(), activeQ.refetch()]);
  };

  const onAccept = async (invite: PlaydateInvite) => {
    setBusyAction({ inviteId: invite.id, action: "accept" });
    try {
      await accept.mutateAsync(invite.id);
      show("놀이 약속이 연결됐어!", "🎈");
      await Promise.all([pendingQ.refetch(), activeQ.refetch()]);
    } catch (e) {
      show(friendlyError(e), "🎈");
    } finally {
      setBusyAction(null);
    }
  };

  const onDecline = async (invite: PlaydateInvite) => {
    setBusyAction({ inviteId: invite.id, action: "decline" });
    try {
      await decline.mutateAsync(invite.id);
      show("요청을 거절했어.", "🎈");
      await pendingQ.refetch();
    } catch (e) {
      show(friendlyError(e), "🎈");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="pa-screen">
      <div className="pa-header">
        <button
          type="button"
          className="pa-back hy-press"
          aria-label="뒤로"
          onClick={goBack}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="pa-header__title">놀이 요청</span>
      </div>

      <div className="pa-content">
        <p className="pa-intro">
          근처 친구가 보낸 놀이 요청이야. 확인하고 <b>수락</b>하면 함께 놀이가 시작돼.
        </p>

        {/* 진행 중 세션(연결됨) */}
        {active ? (
          <div className="pa-active">
            <span className="pa-active__badge">
              <Check size={14} strokeWidth={2.6} color="var(--mint-text)" />
              놀이 연결됨
            </span>
            <span className="pa-active__text">
              {/* 장소를 모르면 "○○와 놀이 중이야.", 알면 "○○와 △△에서 놀이 중이야." */}
              {`${active.friend_child_name?.trim() || "친구"}${
                hasJongseong(active.friend_child_name?.trim() || "친구") ? "과" : "와"
              } `}
              {active.place_name?.trim() ? `${active.place_name.trim()}에서 ` : ""}
              놀이 중이야.
            </span>
          </div>
        ) : null}

        {playdateLoading ? (
          <div className="pa-empty" role="status">
            <div className="pa-empty__title"><Loading label="놀이 요청을 불러오는 중이야" /></div>
          </div>
        ) : playdateError ? (
          <div className="pa-empty" role="alert">
            <div className="pa-empty__title">놀이 요청을 못 불러왔어</div>
            <div className="pa-empty__sub">인터넷을 확인하고 다시 눌러줘.</div>
            <button type="button" className="pa-btn-accept hy-press" onClick={() => void retryPlaydates()}>
              다시 불러오기
            </button>
          </div>
        ) : incoming.length === 0 ? (
          <div className="pa-empty">
            <img className="pa-empty__img" src={asset("ui/menu-friend-playdate.webp")} alt="" />
            <div className="pa-empty__title">받은 놀이 요청이 없어</div>
            <div className="pa-empty__sub">
              근처 친구가 “같이 놀자”를 보내면 여기에 표시돼.
            </div>
          </div>
        ) : (
          incoming.map((r, i) => {
            const expires = expiresLabel(r.expires_at, locale);
            const friendName = r.friend_child_name?.trim() || "친구";
            const busy = busyAction?.inviteId === r.id;
            const accepting = busy && busyAction.action === "accept";
            const declining = busy && busyAction.action === "decline";
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
                      {friendName} 친구
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

                <div className="pa-note">
                  “{friendName}{hasJongseong(friendName) ? "이랑" : "랑"} 같이 놀고 싶어!”
                </div>

                <div className="pa-actions">
                  <button
                    type="button"
                    className="pa-btn-decline hy-press"
                    onClick={() => onDecline(r)}
                    disabled={busy}
                    aria-busy={declining}
                  >
                    거절하기
                  </button>
                  <button
                    type="button"
                    className="pa-btn-accept hy-press"
                    onClick={() => onAccept(r)}
                    disabled={busy}
                    aria-busy={accepting}
                  >
                    <PartyPopper size={18} strokeWidth={2.2} aria-hidden="true" />
                    {accepting ? "처리 중…" : "수락하기"}
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
