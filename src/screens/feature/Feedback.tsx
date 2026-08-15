import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Bug,
  ChevronLeft,
  CircleHelp,
  Lightbulb,
  Paperclip,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import {
  createFeedbackRequestId,
  type FeedbackCategory,
  type FeedbackKind,
} from "@/lib/api/endpoints/feedback";
import {
  clearFeedbackDiagnostics,
  collectFeedbackDiagnostics,
} from "@/lib/feedbackDiagnostics";
import { useSendFeedback } from "@/queries/useFeedback";
import "./Feedback.css";
import { isApiError } from "@/lib/api/errors";

interface FeedbackTypeOption {
  id: FeedbackKind;
  Icon: LucideIcon;
  label: string;
  childLabel: string;
  detail: string;
  childDetail: string;
}

const FEEDBACK_TYPES: readonly FeedbackTypeOption[] = [
  {
    id: "problem",
    Icon: Bug,
    label: "문제가 있어요",
    childLabel: "문제가 있어",
    detail: "작동하지 않거나 불편한 점",
    childDetail: "안 되거나 불편한 점",
  },
  {
    id: "question",
    Icon: CircleHelp,
    label: "사용 방법 문의",
    childLabel: "사용 방법 질문",
    detail: "설정이나 기능 사용 방법",
    childDetail: "설정이나 기능 쓰는 방법",
  },
  {
    id: "suggestion",
    Icon: Lightbulb,
    label: "기능 제안",
    childLabel: "아이디어 보내기",
    detail: "새 기능이나 개선 아이디어",
    childDetail: "새 기능이나 개선 아이디어",
  },
] as const;

const CATEGORIES: ReadonlyArray<{ id: FeedbackCategory; label: string; childLabel: string }> = [
  { id: "location_safety", label: "위치·안전", childLabel: "위치·안전" },
  { id: "notification", label: "알림", childLabel: "알림" },
  { id: "calendar", label: "일정", childLabel: "일정" },
  { id: "chat_ai", label: "대화·AI", childLabel: "대화·AI" },
  { id: "account", label: "계정·결제", childLabel: "계정" },
  { id: "design", label: "화면·디자인", childLabel: "화면" },
  { id: "other", label: "기타", childLabel: "기타" },
];

const FORMAL_PLACEHOLDER: Record<FeedbackKind, string> = {
  problem: "무엇을 누른 뒤 어떤 일이 생겼는지 적어 주세요.\n예: 위치를 눌렀는데 최신 위치가 보이지 않았어요.",
  question: "궁금한 기능과 확인하고 싶은 내용을 적어 주세요.",
  suggestion: "있으면 좋을 기능이나 더 편해졌으면 하는 점을 적어 주세요.",
};

const CHILD_PLACEHOLDER: Record<FeedbackKind, string> = {
  problem: "무엇을 눌렀고 어떤 문제가 생겼는지 적어 줘.\n예: 알림을 눌렀는데 화면이 안 열렸어.",
  question: "궁금한 기능이나 알고 싶은 걸 적어 줘.",
  suggestion: "있으면 좋을 기능이나 더 편해졌으면 하는 걸 적어 줘.",
};

export function Feedback() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { familyId, role } = useAuth();
  const childTone = role === "child";
  const sendFeedback = useSendFeedback();
  const [requestId] = useState(createFeedbackRequestId);
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>("problem");
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [text, setText] = useState("");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const submitting = preparing || sendFeedback.isPending;
  const placeholder = childTone
    ? CHILD_PLACEHOLDER[feedbackKind]
    : FORMAL_PLACEHOLDER[feedbackKind];
  const returnRoute = role === "child"
    ? "/child/settings"
    : role === "teacher"
      ? "/teacher/settings"
      : "/parent/settings";

  const submit = async () => {
    if (submitting) return;
    const content = text.trim();
    if (!content) {
      show(
        childTone ? "어떤 일이 있었는지 적어 줘" : "어떤 일이 있었는지 적어 주세요",
        "✍️",
      );
      return;
    }

    setPreparing(true);
    try {
      const diagnostics = includeDiagnostics ? await collectFeedbackDiagnostics() : null;
      const result = await sendFeedback.mutateAsync({
        requestId,
        feedbackKind,
        category,
        content,
        familyId: familyId ?? null,
        appOrigin: typeof window !== "undefined" ? window.location.origin : "",
        diagnostics,
      });
      if (includeDiagnostics) clearFeedbackDiagnostics();
      show(
        result.status === "sent"
          ? childTone
            ? "내용을 전달했어. 확인하고 더 좋게 고칠게!"
            : "내용을 전달했어요. 확인하고 개선할게요."
          : childTone
            ? "내용을 안전하게 접수했어. 운영 대기열에 보관했어."
            : "내용을 안전하게 접수했어요. 운영 대기열에 보관했어요.",
        "💌",
      );
      navigate(returnRoute, { replace: true });
    } catch (error) {
      const code = isApiError(error) ? error.code : null;
      show(
        code === "feedback_rate_limited"
          ? childTone
            ? "짧은 시간에 여러 번 보냈어. 한 시간 뒤 다시 해 줘."
            : "짧은 시간에 여러 번 보내셨어요. 한 시간 뒤 다시 시도해 주세요."
          : childTone
            ? "접수하지 못했어. 내용을 남겨 두었으니 잠시 후 다시 보내 줘."
            : "접수하지 못했어요. 작성한 내용은 그대로 두었으니 잠시 후 다시 시도해 주세요.",
        "⚠️",
      );
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div className="fb-screen">
      <header className="fb-header">
        <button
          type="button"
          className="fb-back hy-press"
          aria-label={childTone ? "뒤로 가기" : "이전 화면으로 돌아가기"}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <h1 className="fb-header__title">
          {childTone ? "문제 알려주기" : "문제 신고 · 문의"}
        </h1>
      </header>

      <section className="fb-body">
        <div className="fb-intro">
          <img className="fb-intro__mascot" src={asset("mascot/thinking.webp")} alt="" />
          <div>
            <div className="fb-intro__title">
              {childTone ? "불편했던 걸 알려 줘" : "불편한 점을 바로 알려 주세요"}
            </div>
            <p className="fb-intro__sub">
              {childTone
                ? "설명과 앱 상태를 같이 보내 빠르게 확인할게."
                : "설명과 앱 상태를 함께 보내 빠르게 확인할게요."}
            </p>
          </div>
        </div>

        <section className="fb-satis" aria-labelledby="feedback-type-title">
          <h2 id="feedback-type-title" className="fb-section-title">
            {childTone ? "무엇을 알려 줄 거야?" : "어떤 도움이 필요하세요?"}
          </h2>
          <div className="fb-kind-grid">
            {FEEDBACK_TYPES.map((option) => {
              const selected = feedbackKind === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  className="fb-kind hy-press"
                  data-selected={selected ? "true" : "false"}
                  aria-pressed={selected}
                  onClick={() => setFeedbackKind(option.id)}
                >
                  <span className="fb-kind__icon" aria-hidden="true">
                    <option.Icon size={20} strokeWidth={2.2} />
                  </span>
                  <span className="fb-kind__copy">
                    <strong>{childTone ? option.childLabel : option.label}</strong>
                    <small>{childTone ? option.childDetail : option.detail}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="fb-cats" aria-labelledby="feedback-category-title">
          <div className="fb-section-head">
            <h2 id="feedback-category-title" className="fb-section-title">
              {childTone ? "어느 기능에서 그랬어?" : "어느 기능에 관한 내용인가요?"}
            </h2>
            <span>선택 사항</span>
          </div>
          <div className="fb-cats__row">
            {CATEGORIES.map((option) => {
              const selected = category === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  className="fb-cat hy-press"
                  data-selected={selected ? "true" : "false"}
                  aria-pressed={selected}
                  onClick={() => setCategory((current) => (
                    current === option.id ? null : option.id
                  ))}
                >
                  {childTone ? option.childLabel : option.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="fb-message" aria-labelledby="feedback-message-title">
          <div className="fb-section-head">
            <label id="feedback-message-title" className="fb-section-title" htmlFor="feedback-content">
              {childTone ? "어떤 일이 있었어?" : "어떤 일이 있었나요?"}
            </label>
            <span>{text.length}/3000</span>
          </div>
          <div className="fb-textwrap">
            <textarea
              id="feedback-content"
              className="fb-textarea"
              placeholder={placeholder}
              value={text}
              maxLength={3000}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <p className="fb-message__hint">
            {childTone
              ? "전화번호나 비밀번호는 적지 않아도 돼."
              : "전화번호·비밀번호·결제 정보는 적지 않아도 확인할 수 있어요."}
          </p>
        </section>

        <section className="fb-ideas" aria-labelledby="feedback-diagnostic-title">
          <div className="fb-section-head">
            <h2 id="feedback-diagnostic-title" className="fb-section-title">
              {childTone ? "앱 상태 같이 보내기" : "진단 정보 함께 보내기"}
            </h2>
            <span>권장</span>
          </div>
          <div className="fb-ideas__card">
            <div className="fb-diagnostic">
              <span className="fb-diagnostic__icon" aria-hidden="true">
                <ShieldCheck size={22} strokeWidth={2.2} />
              </span>
              <span className="fb-diagnostic__copy">
                <strong>{childTone ? "문제를 더 빨리 찾을 수 있어" : "문제 확인이 더 빨라져요"}</strong>
                <small>
                  앱 버전·기기·화면, 최근 오류 최대 12건
                </small>
              </span>
              <button
                type="button"
                className="fb-diagnostic__toggle hy-press"
                data-selected={includeDiagnostics ? "true" : "false"}
                aria-pressed={includeDiagnostics}
                onClick={() => setIncludeDiagnostics((current) => !current)}
              >
                {includeDiagnostics ? "포함" : "제외"}
              </button>
            </div>
            <div className="fb-diagnostic__privacy">
              <Paperclip size={16} strokeWidth={2.2} aria-hidden="true" />
              <span>
                {childTone
                  ? "진단 정보에는 대화 내용·위치 좌표·사진·비밀번호·로그인 토큰을 넣지 않아."
                  : "진단 정보에는 대화 내용·위치 좌표·사진·비밀번호·로그인 토큰을 포함하지 않아요."}
              </span>
            </div>
          </div>
        </section>

        <button
          type="button"
          className="fb-submit hy-press"
          onClick={() => void submit()}
          disabled={submitting}
          aria-busy={submitting}
        >
          <img className="fb-submit__icon" src={asset("ui/chat-heart.webp")} alt="" />
          {submitting
            ? childTone ? "보내는 중…" : "안전하게 보내는 중…"
            : feedbackKind === "problem"
              ? childTone ? "문제 알려주기" : "문제 내용 보내기"
              : feedbackKind === "question"
                ? childTone ? "질문 보내기" : "문의 보내기"
                : childTone ? "아이디어 보내기" : "제안 보내기"}
        </button>
      </section>
    </div>
  );
}
