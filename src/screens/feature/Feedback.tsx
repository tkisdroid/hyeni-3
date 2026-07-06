import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useSendFeedback } from "@/queries/useFeedback";
import "./Feedback.css";

/** 별점(하트) — 1~5. */
const STARS = [1, 2, 3, 4, 5] as const;

/** 피드백 카테고리(단일 선택 토글). */
const CATEGORIES = [
  { id: "cal", label: "캘린더" },
  { id: "safe", label: "위치·안전" },
  { id: "design", label: "디자인" },
  { id: "etc", label: "기타" },
] as const;

/** 카테고리 id → 라벨(전송 content 에 함께 실어 보낸다). */
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.label] as const),
);

/** user_metadata 에서 표시 이름을 안전하게 추출(없으면 빈 문자열). */
function readName(meta: Record<string, unknown> | undefined): string {
  const name = meta?.name;
  return typeof name === "string" ? name : "";
}

/** 기능 투표 후보(추천 많은 순). */
const IDEAS = [
  { id: "grocery", label: "가족 공유 장보기 리스트", votes: 128 },
  { id: "sibling", label: "형제자매 일정 한눈에 보기", votes: 94 },
  { id: "shuttle", label: "학원 차량 도착 알림", votes: 67 },
] as const;

export function Feedback() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { user, userId, role, familyId } = useAuth();
  const sendFeedback = useSendFeedback();

  const [rating, setRating] = useState(0);
  const [cat, setCat] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [voted, setVoted] = useState<Record<string, boolean>>({});

  // 투표 저장 API 미연동 → 로컬 선택만 반영하고, 집계 반영은 정직하게 안내(오인 방지).
  const toggleVote = (id: string) => {
    const turningOn = !voted[id];
    setVoted((v) => ({ ...v, [id]: !v[id] }));
    if (turningOn) show("베타 기간이라 투표는 아직 집계되지 않아요", "🚧");
  };

  // 실 전송(POST /api/feedback). 별점·카테고리는 content 에 함께 실어 보낸다.
  const submit = () => {
    if (sendFeedback.isPending) return;
    if (rating === 0) {
      show("별점을 먼저 선택해 주세요", "⭐");
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      show("의견 내용을 적어주세요", "✍️");
      return;
    }
    const catLabel = cat ? CATEGORY_LABEL[cat] : null;
    const header = `[만족도 ${rating}/5]${catLabel ? ` · ${catLabel}` : ""}`;
    const content = `${header}\n\n${trimmed}`;

    sendFeedback.mutate(
      {
        content,
        familyId: familyId ?? null,
        senderUserId: userId ?? null,
        senderRole: role ?? null,
        senderName: readName(user?.user_metadata),
        senderEmail: "",
        appOrigin: typeof window !== "undefined" ? window.location.origin : "",
      },
      {
        onSuccess: () => {
          show("소중한 의견 잘 전달했어요. 고마워요!", "💌");
          navigate(-1);
        },
        onError: (error) => {
          show(error.message || "전송에 실패했어요. 잠시 후 다시 시도해 주세요", "⚠️");
        },
      },
    );
  };

  return (
    <div className="fb-screen">
      {/* 헤더 (sticky · 뒤로가기) */}
      <div className="fb-header">
        <button
          type="button"
          className="fb-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--fg-secondary)" />
        </button>
        <span className="fb-header__title">피드백 보내기</span>
      </div>

      <div className="fb-body">
        {/* 인트로 */}
        <div className="fb-intro">
          <img className="fb-intro__mascot" src={asset("mascot/wave.webp")} alt="" />
          <div>
            <div className="fb-intro__title">혜니를 더 좋게</div>
            <div className="fb-intro__sub">여러분의 의견이 다음 업데이트를 만들어요</div>
          </div>
        </div>

        {/* 만족도 별점 */}
        <div className="fb-satis">
          <div className="fb-satis__title">얼마나 만족하세요?</div>
          <div className="fb-stars">
            {STARS.map((n) => (
              <button
                key={n}
                type="button"
                className="fb-star hy-press"
                aria-label={`별점 ${n}점`}
                aria-pressed={rating === n}
                onClick={() => setRating(n)}
              >
                <svg width="40" height="40" viewBox="0 0 24 24" style={{ opacity: rating >= n ? 1 : 0.22 }}>
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
              </button>
            ))}
          </div>
        </div>

        {/* 카테고리 */}
        <div className="fb-cats">
          <div className="fb-cats__label">무엇에 대한 의견인가요?</div>
          <div className="fb-cats__row">
            {CATEGORIES.map((c) => {
              const on = cat === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  className="fb-cat hy-press"
                  style={{
                    background: on ? "var(--hy-accent-soft)" : "#F3EDF0",
                    color: on ? "var(--hy-accent-text)" : "var(--fg-muted)",
                  }}
                  onClick={() => setCat((prev) => (prev === c.id ? null : c.id))}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 자유 입력 */}
        <div className="fb-textwrap">
          <textarea
            className="fb-textarea"
            placeholder="자유롭게 알려주세요. 필요한 기능도 제안해 주세요!"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        {/* 기능 투표 */}
        <div className="fb-ideas">
          <div className="fb-ideas__head">
            <span className="fb-ideas__title">이런 기능은 어때요?</span>
            <span className="fb-ideas__sort">추천 많은 순</span>
          </div>
          <div className="fb-ideas__card">
            {IDEAS.map((i) => {
              const on = !!voted[i.id];
              return (
                <div key={i.id} className="fb-idea">
                  <span className="fb-idea__main">
                    <span className="fb-idea__label">{i.label}</span>
                    <span className="fb-idea__votes">👍 {i.votes}명이 원해요</span>
                  </span>
                  <button
                    type="button"
                    className="fb-vote hy-press"
                    style={{
                      background: on ? "var(--hy-accent)" : "var(--hy-accent-soft)",
                      color: on ? "#fff" : "var(--hy-accent-text)",
                    }}
                    onClick={() => toggleVote(i.id)}
                  >
                    {on ? "추천함" : "추천"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* 전송 */}
        <button
          type="button"
          className="fb-submit hy-press"
          onClick={submit}
          disabled={sendFeedback.isPending}
        >
          <img className="fb-submit__icon" src={asset("ui/chat-heart.webp")} alt="" />
          {sendFeedback.isPending ? "보내는 중…" : "피드백 보내기"}
        </button>
      </div>
    </div>
  );
}
