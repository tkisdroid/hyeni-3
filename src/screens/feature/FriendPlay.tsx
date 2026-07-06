import { useNavigate } from "react-router-dom";
import { ChevronLeft, MapPin } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import {
  usePlaydateCandidates,
  usePendingPlaydateInvites,
  useActivePlaydateSession,
  useCreatePlaydateInvite,
  useEndPlaydate,
} from "@/queries/usePlaydate";
import type { PlaydateCandidate } from "@/lib/api/endpoints/playdate";
import "./FriendPlay.css";

/** 친구 놀이요청 진행 단계 안내. */
const STEPS = [
  { n: 1, text: "“놀고 싶어요” 요청을 보내요" },
  { n: 2, text: "근처 친구한테 초대가 전달돼요" },
  { n: 3, text: "친구가 수락하면 같이 놀아요!" },
];

/** 후보에 캐릭터/배경색 부여(도메인엔 이름만 있어 표현은 index 파생). */
const FRIEND_ANIMALS = ["animal/rabbit.webp", "animal/bear.webp", "animal/fox.webp", "animal/cat.webp"];
const FRIEND_SOFTS = ["#FDE7F1", "#E7F8F0", "#FFF3D6", "#E6F2FB"];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "";
}

/** 후보 soft error → 아이 눈높이 안내(반말). */
function candidateNotice(error: string | undefined, empty: boolean): string | null {
  switch (error) {
    case "playdate_not_enabled":
      return "지금은 친구놀이가 꺼져 있어. 부모님한테 켜달라고 하자!";
    case "current_location_unavailable":
      return "아직 네 위치를 못 찾았어. 잠깐 있다가 다시 해볼까?";
    case "in_danger_zone":
      return "지금 있는 곳에선 친구를 찾을 수 없어.";
    case "forbidden":
      return "지금은 친구를 찾을 수 없어.";
    default:
      return empty ? "근처에 놀 수 있는 친구가 아직 없어. 조금 있다 다시 볼까?" : null;
  }
}

export function FriendPlay() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { role } = useAuth();

  const candidatesQ = usePlaydateCandidates();
  const pendingQ = usePendingPlaydateInvites();
  const activeQ = useActivePlaydateSession();
  const createInvite = useCreatePlaydateInvite();
  const endPlaydate = useEndPlaydate();

  const active = activeQ.data ?? null;
  const candidates = candidatesQ.data?.candidates ?? [];
  const softError = candidatesQ.data?.error;
  const outgoing = (pendingQ.data ?? []).filter(
    (i) => i.direction === "outgoing" && i.status === "pending",
  );

  const canSend = role === "child";
  const sending = createInvite.isPending;

  const onSend = async () => {
    if (candidates.length === 0) return;
    try {
      const results = await Promise.allSettled(
        candidates.map((c: PlaydateCandidate) => createInvite.mutateAsync(c)),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      if (ok > 0) {
        show(`근처 친구 ${ok}명에게 같이 놀자고 보냈어!`, "🎈");
        await pendingQ.refetch();
      } else {
        const first = results.find((r) => r.status === "rejected") as
          | PromiseRejectedResult
          | undefined;
        show(errMsg(first?.reason) || "보내기에 실패했어. 다시 해볼까?", "😢");
      }
    } catch (e) {
      show(errMsg(e) || "보내기에 실패했어. 다시 해볼까?", "😢");
    }
  };

  const onEnd = async () => {
    if (!active) return;
    try {
      await endPlaydate.mutateAsync({
        sessionId: active.id,
        reason: role === "child" ? "child_end" : "parent_end",
      });
      show("친구랑 그만 놀았어. 재밌었지?", "👋");
    } catch (e) {
      show(errMsg(e) || "종료에 실패했어.", "😢");
    }
  };

  const notice = candidateNotice(softError, candidates.length === 0);

  return (
    <div className="fp-screen">
      <div className="fp-header">
        <button
          type="button"
          className="fp-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="fp-header__title">친구 놀이</span>
      </div>

      <div className="fp-content">
        {/* 히어로 */}
        <div className="fp-hero">
          <img className="fp-hero__mascot" src={asset("ui/menu-friend-playdate.webp")} alt="" />
          <div className="fp-hero__title">
            {active ? "지금 친구랑 놀고 있어!" : "친구랑 놀고 싶어?"}
          </div>
          <div className="fp-hero__sub">
            {active ? (
              <>
                {active.friend_child_name ?? "친구"}(이)랑 만났어.
                <br />
                다 놀았으면 아래에서 알려줘!
              </>
            ) : (
              <>
                가까이 있는 친구에게
                <br />
                같이 놀자고 살짝 보내볼까?
              </>
            )}
          </div>
        </div>

        {active ? (
          /* ── 연결됨 상태 ─────────────────────────────── */
          <div className="fp-connected">
            <div className="fp-connected__badge">🎈 놀이 연결됨</div>
            <div className="fp-connected__friend">{active.friend_child_name ?? "친구"}</div>
            {active.place_name ? (
              <div className="fp-connected__place">
                <MapPin size={14} strokeWidth={2} color="var(--mint-text)" />
                {active.place_name}
              </div>
            ) : null}
            <button
              type="button"
              className="fp-end hy-press"
              onClick={onEnd}
              disabled={endPlaydate.isPending}
            >
              그만 놀래요
            </button>
          </div>
        ) : (
          <>
            {/* 근처 친구 */}
            <div className="fp-card">
              <div className="fp-card__title">
                근처에 있는 친구 <span>{candidates.length}명</span>
              </div>
              {candidates.length > 0 ? (
                <div className="fp-friends">
                  {candidates.map((f, i) => (
                    <div key={f.child_user_id} className="fp-friend">
                      <div
                        className="fp-friend__avatar"
                        style={{ background: FRIEND_SOFTS[i % FRIEND_SOFTS.length] }}
                      >
                        <img src={asset(FRIEND_ANIMALS[i % FRIEND_ANIMALS.length])} alt="" />
                      </div>
                      <div className="fp-friend__name">{f.child_name}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="fp-empty">{notice ?? "친구를 찾고 있어…"}</div>
              )}
            </div>

            {/* 진행 안내 */}
            <div className="fp-steps">
              {STEPS.map((s) => (
                <div key={s.n} className="fp-step">
                  <span className="fp-step__num">{s.n}</span>
                  <span className="fp-step__text">{s.text}</span>
                </div>
              ))}
            </div>

            {/* 발신 상태 / 보내기 */}
            {outgoing.length > 0 ? (
              <div className="fp-waiting">
                🎈 친구에게 보냈어! 친구의 답을 기다리는 중…
              </div>
            ) : !canSend ? (
              <div className="fp-note">아이가 아이 기기에서 친구에게 보낼 수 있어요.</div>
            ) : (
              <button
                type="button"
                className="fp-cta hy-press"
                onClick={onSend}
                disabled={sending || candidates.length === 0}
              >
                🎈 {sending ? "보내는 중…" : "같이 놀자고 보내기"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
