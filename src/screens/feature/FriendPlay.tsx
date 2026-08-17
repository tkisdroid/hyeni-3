import { ChevronLeft, MapPin, PartyPopper } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import {
  usePlaydateCandidates,
  usePendingPlaydateInvites,
  useActivePlaydateSession,
  useCreatePlaydateInvite,
  useEndPlaydate,
  usePlaydateEnabled,
  useSetPlaydateEnabled,
} from "@/queries/usePlaydate";
import type { PlaydateCandidate } from "@/lib/api/endpoints/playdate";
import { playdateCandidateNotice } from "@/transform/playdateNotice";
import { hasJongseong } from "@/transform/adventureMap";
import { useSafeBack } from "@/app/useSafeBack";
import { Loading } from "@/components/ui/Loading";
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

function ParentPlaydateQueryState({
  loading,
  onBack,
  onRetry,
}: {
  loading: boolean;
  onBack: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="fp-screen">
      <div className="fp-header">
        <button type="button" className="fp-back hy-press" aria-label="뒤로" onClick={onBack}>
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="fp-header__title">친구놀이 설정</span>
      </div>
      <div className="fp-content">
        <div className="fp-empty" role={loading ? "status" : "alert"}>
          {loading
            ? <Loading label="친구놀이 설정을 불러오는 중" />
            : <span>친구놀이 설정을 불러오지 못했어요</span>}
          {!loading && (
            <button type="button" className="fp-cta hy-press" onClick={onRetry}>
              다시 시도
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 후보 soft error → 아이 눈높이 안내(반말). */

export function FriendPlay() {
  const { show } = useToast();
  const { role } = useAuth();

  const isParent = role === "parent";
  const goBack = useSafeBack(isParent ? "/parent/home" : "/child/home");
  const candidatesQ = usePlaydateCandidates(!isParent);
  const pendingQ = usePendingPlaydateInvites();
  const activeQ = useActivePlaydateSession();
  const createInvite = useCreatePlaydateInvite();
  const endPlaydate = useEndPlaydate();
  const enabledQ = usePlaydateEnabled();
  const setEnabled = useSetPlaydateEnabled();

  const active = activeQ.data ?? null;
  const candidates = candidatesQ.data?.candidates ?? [];
  const softError = candidatesQ.data?.error;
  const outgoing = (pendingQ.data ?? []).filter(
    (i) => i.direction === "outgoing" && i.status === "pending",
  );

  const canSend = role === "child";
  const sending = createInvite.isPending;

  const playdateEnabled = enabledQ.data?.playdate_enabled === true;
  const parentPlaydateReady = enabledQ.isSuccess && activeQ.isSuccess && pendingQ.isSuccess;
  const parentPlaydateLoading = enabledQ.isLoading || activeQ.isLoading || pendingQ.isLoading;
  const parentPlaydateError = enabledQ.isError
    || activeQ.isError
    || pendingQ.isError
    || (!parentPlaydateLoading && !parentPlaydateReady);
  const retryParentPlaydate = async () => {
    await Promise.all([
      enabledQ.refetch(),
      activeQ.refetch(),
      pendingQ.refetch(),
    ]);
  };

  const togglePlaydateEnabled = () => {
    if (!isParent || parentPlaydateLoading || parentPlaydateError || !enabledQ.data || setEnabled.isPending) return;
    const next = !playdateEnabled;
    setEnabled.mutate(next, {
      onSuccess: () => show(next ? "친구놀이를 허용했어요" : "친구놀이를 껐어요", "🎈"),
      onError: () => show("친구놀이 설정 저장에 실패했어요", "⚠️"),
    });
  };

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
        show(errMsg(first?.reason) || "보내기에 실패했어. 다시 해 볼까?", "😢");
      }
    } catch (e) {
      show(errMsg(e) || "보내기에 실패했어. 다시 해 볼까?", "😢");
    }
  };

  const onEnd = async () => {
    if (!active) return;
    try {
      await endPlaydate.mutateAsync({
        sessionId: active.id,
        reason: role === "child" ? "child_end" : "parent_end",
      });
      show(isParent ? "친구놀이를 종료했어요" : "친구랑 그만 놀았어. 재밌었지?", "👋");
    } catch (e) {
      show(
        isParent
          ? "친구놀이를 종료하지 못했어요. 다시 시도해 주세요"
          : errMsg(e) || "종료에 실패했어.",
        "😢",
      );
    }
  };

  const notice = playdateCandidateNotice(softError, candidates.length === 0, candidatesQ.isError);

  if (role === "parent") {
    if (parentPlaydateLoading) {
      return <ParentPlaydateQueryState loading onBack={goBack} onRetry={() => undefined} />;
    }
    if (parentPlaydateError) {
      return (
        <ParentPlaydateQueryState
          loading={false}
          onBack={goBack}
          onRetry={() => void retryParentPlaydate()}
        />
      );
    }
    return (
      <div className="fp-screen">
        <div className="fp-header">
          <button
            type="button"
            className="fp-back hy-press"
            aria-label="뒤로"
            onClick={goBack}
          >
            <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
          </button>
          <span className="fp-header__title">친구놀이 설정</span>
        </div>

        <div className="fp-content">
          <div className="fp-hero fp-hero--parent">
            <img className="fp-hero__mascot" src={asset("ui/menu-friend-playdate.webp")} alt="" />
            <div className="fp-hero__title">친구놀이 설정</div>
            <div className="fp-hero__sub">
              아이 기기에서 친구놀이 요청을 보낼 수 있어요.
              <br />
              허용 조건을 정해 주세요.
            </div>
          </div>

          <button
            type="button"
            className="fp-setting hy-press"
            aria-pressed={playdateEnabled}
            onClick={togglePlaydateEnabled}
            disabled={enabledQ.isLoading || setEnabled.isPending} aria-busy={enabledQ.isLoading || setEnabled.isPending}
          >
            <span className="fp-setting__icon" aria-hidden="true">
              <PartyPopper size={22} strokeWidth={2.2} />
            </span>
            <span className="fp-setting__main">
              <span className="fp-setting__title">친구놀이 허용</span>
              <span className="fp-setting__sub">
                {playdateEnabled
                  ? "안전한 곳에서 근처 친구에게 요청해요"
                  : "아이 화면의 친구찾기와 요청이 꺼져요"}
              </span>
            </span>
            <span className="fp-setting__switch" data-on={playdateEnabled}>
              <span className="fp-setting__knob" />
            </span>
          </button>

          <div className="fp-parent-card">
            <div className="fp-parent-card__title">이렇게 동작해요</div>
            <div className="fp-parent-rule">
              <span>1</span>
              양쪽 가족이 모두 켠 경우에만 보여요.
            </div>
            <div className="fp-parent-rule">
              <span>2</span>
              위험구역 밖이고 위치가 확인될 때만 요청할 수 있어요.
            </div>
            <div className="fp-parent-rule">
              <span>3</span>
              진행 중인 친구놀이는 언제든 종료할 수 있어요.
            </div>
          </div>

          {active ? (
            <div className="fp-connected fp-connected--parent">
              <div className="fp-connected__badge">진행 중</div>
              <div className="fp-connected__friend">{active.friend_child_name ?? "친구"}</div>
              {active.place_name ? (
                <div className="fp-connected__place">
                  <MapPin size={16} strokeWidth={2.2} color="var(--mint-text)" />
                  {active.place_name}
                </div>
              ) : null}
              <button
                type="button"
                className="fp-end hy-press"
                onClick={onEnd}
                disabled={endPlaydate.isPending} aria-busy={endPlaydate.isPending}
              >
                친구놀이 종료
              </button>
            </div>
          ) : (
            <div className="fp-note fp-note--parent">
              현재 진행 중인 친구놀이가 없어요.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fp-screen">
      <div className="fp-header">
        <button
          type="button"
          className="fp-back hy-press"
          aria-label="뒤로"
          onClick={goBack}
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
                {active.friend_child_name ?? "친구"}
                {hasJongseong(active.friend_child_name ?? "친구") ? "이랑" : "랑"} 만났어.
                <br />
                다 놀았으면 아래에서 알려줘!
              </>
            ) : (
              <>
                가까이 있는 친구에게
                <br />
                같이 놀자고 살짝 보내 볼까?
              </>
            )}
          </div>
        </div>

        {active ? (
          /* ── 연결됨 상태 ─────────────────────────────── */
          <div className="fp-connected">
            <div className="fp-connected__badge">
              <PartyPopper size={16} strokeWidth={2.2} aria-hidden="true" />
              놀이 연결됨
            </div>
            <div className="fp-connected__friend">{active.friend_child_name ?? "친구"}</div>
            {active.place_name ? (
              <div className="fp-connected__place">
                <MapPin size={16} strokeWidth={2.2} color="var(--mint-text)" />
                {active.place_name}
              </div>
            ) : null}
            <button
              type="button"
              className="fp-end hy-press"
              onClick={onEnd}
              disabled={endPlaydate.isPending} aria-busy={endPlaydate.isPending}
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
              {candidatesQ.isLoading ? (
                <div className="fp-empty">근처 친구를 찾는 중…</div>
              ) : candidatesQ.isError ? (
                <div className="fp-empty" role="alert">
                  <span>{notice ?? "근처 친구를 찾지 못했어요."}</span>
                  <button type="button" className="fp-cta hy-press" onClick={() => void candidatesQ.refetch()}>
                    다시 시도
                  </button>
                </div>
              ) : candidates.length > 0 ? (
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
                <PartyPopper size={20} strokeWidth={2.2} aria-hidden="true" />
                친구에게 보냈어! 친구의 답을 기다리는 중…
              </div>
            ) : !canSend ? (
              <div className="fp-note">아이가 아이 기기에서 친구에게 보낼 수 있어요.</div>
            ) : (
              <button
                type="button"
                className="fp-cta hy-press"
                onClick={onSend}
                disabled={sending || candidates.length === 0} aria-busy={sending}
              >
                <PartyPopper size={20} strokeWidth={2.2} aria-hidden="true" />
                {sending ? "보내는 중…" : "같이 놀자고 보내기"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
