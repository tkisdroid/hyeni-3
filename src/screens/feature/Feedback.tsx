import { useState } from "react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router";
import {
  ChevronLeft,
  Paperclip,
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
  icon: string;
  labelId: string;
  childLabelId: string;
  detailId: string;
  childDetailId: string;
}

const FEEDBACK_TYPES: readonly FeedbackTypeOption[] = [
  {
    id: "problem",
    icon: "ui/clay/feedback.webp",
    labelId: "shared.feedback.type.problem.formal",
    childLabelId: "shared.feedback.type.problem.child",
    detailId: "shared.feedback.type.problemDetail.formal",
    childDetailId: "shared.feedback.type.problemDetail.child",
  },
  {
    id: "question",
    icon: "ui/settings-faq.webp",
    labelId: "shared.feedback.type.question.formal",
    childLabelId: "shared.feedback.type.question.child",
    detailId: "shared.feedback.type.questionDetail.formal",
    childDetailId: "shared.feedback.type.questionDetail.child",
  },
  {
    id: "suggestion",
    icon: "ui/sparkle.webp",
    labelId: "shared.feedback.type.suggestion.formal",
    childLabelId: "shared.feedback.type.suggestion.child",
    detailId: "shared.feedback.type.suggestionDetail.formal",
    childDetailId: "shared.feedback.type.suggestionDetail.child",
  },
] as const;

const CATEGORIES: ReadonlyArray<{
  id: FeedbackCategory;
  labelId: string;
  childLabelId: string;
}> = [
  { id: "location_safety", labelId: "shared.feedback.category.locationSafety.formal", childLabelId: "shared.feedback.category.locationSafety.child" },
  { id: "notification", labelId: "shared.feedback.category.notification.formal", childLabelId: "shared.feedback.category.notification.child" },
  { id: "calendar", labelId: "shared.feedback.category.calendar.formal", childLabelId: "shared.feedback.category.calendar.child" },
  { id: "chat_ai", labelId: "shared.feedback.category.chatAi.formal", childLabelId: "shared.feedback.category.chatAi.child" },
  { id: "account", labelId: "shared.feedback.category.account.formal", childLabelId: "shared.feedback.category.account.child" },
  { id: "design", labelId: "shared.feedback.category.design.formal", childLabelId: "shared.feedback.category.design.child" },
  { id: "other", labelId: "shared.feedback.category.other.formal", childLabelId: "shared.feedback.category.other.child" },
];

const FORMAL_PLACEHOLDER_IDS: Record<FeedbackKind, string> = {
  problem: "shared.feedback.message.placeholder.problem.formal",
  question: "shared.feedback.message.placeholder.question.formal",
  suggestion: "shared.feedback.message.placeholder.suggestion.formal",
};

const CHILD_PLACEHOLDER_IDS: Record<FeedbackKind, string> = {
  problem: "shared.feedback.message.placeholder.problem.child",
  question: "shared.feedback.message.placeholder.question.child",
  suggestion: "shared.feedback.message.placeholder.suggestion.child",
};

export function Feedback() {
  const intl = useIntl();
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
  const message = (childId: string, formalId: string): string => intl.formatMessage({
    id: childTone ? childId : formalId,
  });
  const placeholder = intl.formatMessage({
    id: childTone
      ? CHILD_PLACEHOLDER_IDS[feedbackKind]
      : FORMAL_PLACEHOLDER_IDS[feedbackKind],
  });
  const returnRoute = role === "child"
    ? "/child/settings"
    : role === "teacher"
      ? "/teacher/settings"
      : "/parent/settings";

  const submit = async () => {
    if (submitting) return;
    const content = text.trim();
    if (!content) {
      show(message(
        "shared.feedback.message.required.child",
        "shared.feedback.message.required.formal",
      ), "✍️");
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
          ? message(
              "shared.feedback.result.sent.child",
              "shared.feedback.result.sent.formal",
            )
          : message(
              "shared.feedback.result.queued.child",
              "shared.feedback.result.queued.formal",
            ),
        "💌",
      );
      navigate(returnRoute, { replace: true });
    } catch (error) {
      const code = isApiError(error) ? error.code : null;
      show(
        code === "feedback_rate_limited"
          ? message(
              "shared.feedback.error.rateLimited.child",
              "shared.feedback.error.rateLimited.formal",
            )
          : message(
              "shared.feedback.error.generic.child",
              "shared.feedback.error.generic.formal",
            ),
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
          aria-label={message("shared.feedback.back.child", "shared.feedback.back.formal")}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <h1 className="fb-header__title">
          {message("shared.feedback.title.child", "shared.feedback.title.formal")}
        </h1>
      </header>

      <section className="fb-body">
        <div className="fb-intro">
          <img className="fb-intro__mascot" src={asset("mascot/thinking.webp")} alt="" />
          <div>
            <div className="fb-intro__title">
              {message("shared.feedback.intro.title.child", "shared.feedback.intro.title.formal")}
            </div>
            <p className="fb-intro__sub">
              {message("shared.feedback.intro.description.child", "shared.feedback.intro.description.formal")}
            </p>
          </div>
        </div>

        <section className="fb-satis" aria-labelledby="feedback-type-title">
          <h2 id="feedback-type-title" className="fb-section-title">
            {message("shared.feedback.type.heading.child", "shared.feedback.type.heading.formal")}
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
                    <img src={asset(option.icon)} alt="" />
                  </span>
                  <span className="fb-kind__copy">
                    <strong>{intl.formatMessage({
                      id: childTone ? option.childLabelId : option.labelId,
                    })}</strong>
                    <small>{intl.formatMessage({
                      id: childTone ? option.childDetailId : option.detailId,
                    })}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="fb-cats" aria-labelledby="feedback-category-title">
          <div className="fb-section-head">
            <h2 id="feedback-category-title" className="fb-section-title">
              {message("shared.feedback.category.heading.child", "shared.feedback.category.heading.formal")}
            </h2>
            <span>{intl.formatMessage({ id: "shared.feedback.category.optional" })}</span>
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
                  {intl.formatMessage({
                    id: childTone ? option.childLabelId : option.labelId,
                  })}
                </button>
              );
            })}
          </div>
        </section>

        <section className="fb-message" aria-labelledby="feedback-message-title">
          <div className="fb-section-head">
            <label id="feedback-message-title" className="fb-section-title" htmlFor="feedback-content">
              {message("shared.feedback.message.heading.child", "shared.feedback.message.heading.formal")}
            </label>
            <span>{intl.formatMessage(
              { id: "shared.feedback.message.counter" },
              { count: text.length, max: 3000 },
            )}</span>
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
            {message("shared.feedback.message.hint.child", "shared.feedback.message.hint.formal")}
          </p>
        </section>

        <section className="fb-ideas" aria-labelledby="feedback-diagnostic-title">
          <div className="fb-section-head">
            <h2 id="feedback-diagnostic-title" className="fb-section-title">
              {message("shared.feedback.diagnostics.heading.child", "shared.feedback.diagnostics.heading.formal")}
            </h2>
            <span>{intl.formatMessage({ id: "shared.feedback.diagnostics.recommended" })}</span>
          </div>
          <div className="fb-ideas__card">
            <div className="fb-diagnostic">
              <span className="fb-diagnostic__icon" aria-hidden="true">
                <img src={asset("ui/clay/privacy.webp")} alt="" />
              </span>
              <span className="fb-diagnostic__copy">
                <strong>{message(
                  "shared.feedback.diagnostics.benefit.child",
                  "shared.feedback.diagnostics.benefit.formal",
                )}</strong>
                <small>
                  {message(
                    "shared.feedback.diagnostics.summary.child",
                    "shared.feedback.diagnostics.summary.formal",
                  )}
                </small>
              </span>
              <button
                type="button"
                className="fb-diagnostic__toggle hy-press"
                data-selected={includeDiagnostics ? "true" : "false"}
                aria-pressed={includeDiagnostics}
                onClick={() => setIncludeDiagnostics((current) => !current)}
              >
                {intl.formatMessage({
                  id: includeDiagnostics
                    ? "shared.feedback.diagnostics.include"
                    : "shared.feedback.diagnostics.exclude",
                })}
              </button>
            </div>
            <div className="fb-diagnostic__privacy">
              <Paperclip size={16} strokeWidth={2.2} aria-hidden="true" />
              <span>
                {message(
                  "shared.feedback.diagnostics.privacy.child",
                  "shared.feedback.diagnostics.privacy.formal",
                )}
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
            ? message("shared.feedback.submit.pending.child", "shared.feedback.submit.pending.formal")
            : feedbackKind === "problem"
              ? message("shared.feedback.submit.problem.child", "shared.feedback.submit.problem.formal")
              : feedbackKind === "question"
                ? message("shared.feedback.submit.question.child", "shared.feedback.submit.question.formal")
                : message("shared.feedback.submit.suggestion.child", "shared.feedback.submit.suggestion.formal")}
        </button>
      </section>
    </div>
  );
}
