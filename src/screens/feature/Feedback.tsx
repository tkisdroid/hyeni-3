import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft, Heart } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { createFeedbackRequestId } from "@/lib/api/endpoints/feedback";
import { useSendFeedback } from "@/queries/useFeedback";
import "./Feedback.css";

/** 별점(하트) — 1~5. */
const STARS = [1, 2, 3, 4, 5] as const;
/** 만족도 척도 라벨(1~5). 하트만 있으면 무엇을 고르는지 알 수 없다. */
const FORMAL_RATING_LABELS = ["별로예요", "아쉬워요", "보통이에요", "좋아요", "아주 좋아요"] as const;
const CHILD_RATING_LABELS = ["별로야", "아쉬워", "보통이야", "좋아", "아주 좋아"] as const;

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

/** 화면에서 선택해 실제 피드백 본문에 포함할 관심 기능 후보. */
const IDEAS = [
  { id: "grocery", label: "가족 공유 장보기 리스트" },
  { id: "sibling", label: "형제자매 일정 한눈에 보기" },
  { id: "shuttle", label: "학원 차량 도착 알림" },
] as const;

export function Feedback() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { familyId, role } = useAuth();
  const childTone = role === "child";
  const ratingLabels = childTone ? CHILD_RATING_LABELS : FORMAL_RATING_LABELS;
  const sendFeedback = useSendFeedback();
  const [requestId] = useState(createFeedbackRequestId);

  const [rating, setRating] = useState(0);
  const [cat, setCat] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [selectedIdeas, setSelectedIdeas] = useState<Record<string, boolean>>({});

  const toggleIdea = (id: string) => {
    const turningOn = !selectedIdeas[id];
    setSelectedIdeas((current) => ({ ...current, [id]: !current[id] }));
    show(
      turningOn
        ? childTone ? "선택한 기능을 의견에 함께 담았어" : "선택한 기능을 의견에 함께 담았어요"
        : childTone ? "관심 기능 선택을 취소했어" : "관심 기능 선택을 취소했어요",
      "💡",
    );
  };

  // 실 전송(POST /api/feedback). 별점·카테고리는 content 에 함께 실어 보낸다.
  const submit = () => {
    if (sendFeedback.isPending) return;
    if (rating === 0) {
      show(childTone ? "만족도를 먼저 골라 줘" : "만족도를 먼저 선택해 주세요", "⭐");
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      show(childTone ? "의견을 적어 줘" : "의견 내용을 적어 주세요", "✍️");
      return;
    }
    const catLabel = cat ? CATEGORY_LABEL[cat] : null;
    const header = `[만족도 ${rating}/5]${catLabel ? ` · ${catLabel}` : ""}`;
    const selectedIdeaLabels = IDEAS.filter((idea) => selectedIdeas[idea.id]).map(
      (idea) => idea.label,
    );
    const ideaSection = selectedIdeaLabels.length > 0
      ? `\n\n[관심 기능]\n- ${selectedIdeaLabels.join("\n- ")}`
      : "";
    const content = `${header}\n\n${trimmed}${ideaSection}`;

    sendFeedback.mutate(
      {
        requestId,
        content,
        familyId: familyId ?? null,
        appOrigin: typeof window !== "undefined" ? window.location.origin : "",
      },
      {
        onSuccess: (result) => {
          show(
            result.status === "sent"
              ? childTone ? "소중한 의견을 전달했어. 고마워!" : "소중한 의견을 전달했어요. 고마워요!"
              : childTone
                ? "의견을 안전하게 접수했어. 운영 대기열에 보관했어."
                : "의견을 안전하게 접수했어요. 운영 대기열에 보관했어요.",
            "💌",
          );
          navigate(-1);
        },
        onError: (error) => {
          show(
            error.message === "feedback_rate_limited"
              ? childTone
                ? "짧은 시간에 의견을 많이 보냈어. 한 시간 뒤 다시 해 줘."
                : "짧은 시간에 의견을 많이 보내셨어요. 한 시간 뒤 다시 시도해 주세요."
              : childTone
                ? "접수하지 못했어. 잠시 후 다시 해 줘."
                : "접수하지 못했어요. 잠시 후 다시 시도해 주세요.",
            "⚠️",
          );
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
            <div className="fb-intro__sub">
              {childTone ? "네 의견이 다음 업데이트를 만들어" : "여러분의 의견이 다음 업데이트를 만들어요"}
            </div>
          </div>
        </div>

        {/* 만족도 */}
        <div className="fb-satis">
          <div className="fb-satis__title">{childTone ? "얼마나 마음에 들어?" : "얼마나 만족하세요?"}</div>
          <div className="fb-stars">
            {STARS.map((n) => {
              const on = rating >= n;
              return (
                <button
                  key={n}
                  type="button"
                  className="fb-star hy-press"
                  aria-label={`${n}점 · ${ratingLabels[n - 1]}`}
                  aria-pressed={rating === n}
                  onClick={() => setRating(n)}
                >
                  <Heart
                    size={30}
                    strokeWidth={2.2}
                    color={on ? "var(--hy-accent-cta)" : "var(--line-strong)"}
                    fill={on ? "var(--hy-accent-cta)" : "none"}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
          {/* 척도를 말로 알려준다 — 하트만 있으면 무엇을 고르는지 첫 사용자가 모른다. */}
          <div className="fb-satis__scale" aria-hidden="true">
            <span>{ratingLabels[0]}</span>
            <span className="fb-satis__picked">{rating > 0 ? ratingLabels[rating - 1] : ""}</span>
            <span>{ratingLabels[ratingLabels.length - 1]}</span>
          </div>
        </div>

        {/* 카테고리 */}
        <div className="fb-cats">
          <div className="fb-cats__label">{childTone ? "어떤 기능에 대한 의견이야?" : "무엇에 대한 의견인가요?"}</div>
          <div className="fb-cats__row">
            {CATEGORIES.map((c) => {
              const on = cat === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  className="fb-cat hy-press"
                  style={{
                    background: on ? "var(--hy-accent-soft)" : "var(--bg-chip-idle)",
                    color: on ? "var(--hy-accent-text)" : "var(--fg-tertiary)",
                    boxShadow: on ? "inset 0 0 0 1.5px var(--hy-accent)" : "none",
                  }}
                  aria-pressed={on}
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
            aria-label="피드백 내용"
            placeholder={childTone
              ? "자유롭게 알려 줘. 필요한 기능도 말해 줘!"
              : "자유롭게 알려 주세요. 필요한 기능도 제안해 주세요!"}
            value={text}
            maxLength={3000}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        {/* 관심 기능 선택 — 집계 수를 만들지 않고 실제 피드백 본문에 포함한다. */}
        <div className="fb-ideas">
          <div className="fb-ideas__head">
            <span className="fb-ideas__title">관심 있는 기능</span>
            <span className="fb-ideas__sort">선택 사항</span>
          </div>
          <div className="fb-ideas__sort">
            {childTone
              ? "관심 있는 기능을 고르면 의견에 함께 적어 보내"
              : "관심 있는 기능을 선택하면 의견에 함께 적어 보내요"}
          </div>
          <div className="fb-ideas__card">
            {IDEAS.map((i) => {
              const on = !!selectedIdeas[i.id];
              return (
                <div key={i.id} className="fb-idea">
                  <span className="fb-idea__main">
                    <span className="fb-idea__label">{i.label}</span>
                  </span>
                  <button
                    type="button"
                    className="fb-vote hy-press"
                    aria-pressed={on}
                    style={
                      on
                        ? {
                            // 파스텔 채움 위 흰 글자는 2.76:1 이라 쓰지 않는다 — soft 채움 + 진한 라벨(4.6:1).
                            background: "var(--hy-accent-soft)",
                            color: "var(--hy-accent-text)",
                            border: "1.5px solid var(--hy-accent)",
                          }
                        : {
                            background: "transparent",
                            color: "var(--hy-accent-text)",
                            border: "1.5px solid var(--line-strong)",
                          }
                    }
                    onClick={() => toggleIdea(i.id)}
                  >
                    {on && <Check size={16} strokeWidth={2.4} aria-hidden="true" />}
                    {on ? (childTone ? "골랐어" : "선택됨") : (childTone ? "관심 있어" : "관심 있어요")}
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
          disabled={sendFeedback.isPending} aria-busy={sendFeedback.isPending}
        >
          <img className="fb-submit__icon" src={asset("ui/chat-heart.webp")} alt="" />
          {sendFeedback.isPending ? "보내는 중…" : "피드백 보내기"}
        </button>
      </div>
    </div>
  );
}
