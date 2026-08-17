import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePwaUpdateCriticalSection } from "@/lib/usePwaUpdateCriticalSection";
import { useLocation, useNavigate } from "react-router";
import { ChevronLeft, Flag, MessageCircle, Settings } from "lucide-react";
import { useLongPress, type LongPressHandlers } from "@/lib/useLongPress";
import { asset } from "@/lib/assets";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily } from "@/queries/useFamily";
import { useEvents, useDailySupplies } from "@/queries/useSchedule";
import { useSavedPlaces } from "@/queries/useLocation";
import {
  useAiCreditPublicStatus,
  useAiMessages,
  useAiFriendPublicSettings,
  useSendChildChat,
} from "@/queries/useAi";
import { messagesToBubbles, type ChatBubble } from "@/transform/aiView";
import { groupEventsByDateKey, PAST_TAGS } from "@/transform/scheduleView";
import { todayDateKey } from "@/transform/dateKey";
import { filterEventsForChild } from "@/transform/eventScope";
import { isApiError } from "@/lib/api/errors";
import { resolveAiFriendDisplayName } from "@/transform/aiFriendName";
import {
  resolveAiLimitExhaustionReason,
  type AiCreditPublicStatus,
} from "@/transform/aiCreditPublicStatus";
import { hasJongseong } from "@/transform/adventureMap";
import { useToast } from "@/app/toast";
import { useSafeBack } from "@/app/useSafeBack";
import { MessageSafetyDialog, type ReportReasonOption } from "@/components/MessageSafetyDialog";
import { useReportAiMessage } from "@/queries/useContentSafety";
import type { AiContentReportReason } from "@/lib/api/endpoints/contentSafety";
import { Loading } from "@/components/ui/Loading";
import {
  AI_FRIEND_PERSONAS,
  DEFAULT_CHARACTER,
  personaFor,
  readSelectedCharacter,
} from "./AiFriendSetup";
import "@/styles/jua.css";
import "./AiFriendChat.css";

const BASE_SUGGESTIONS = ["오늘 뭐 하고 놀까?", "심심해 😪", "재밌는 얘기 해줘"];

const AI_REPORT_REASONS: readonly ReportReasonOption<AiContentReportReason>[] = [
  { value: "scary_or_uncomfortable", label: "무섭거나 불편해" },
  { value: "abusive_language", label: "나쁜 말" },
  { value: "asks_personal_info", label: "개인정보를 물어봐" },
  { value: "inaccurate", label: "사실과 달라" },
  { value: "other", label: "다른 이유" },
];

// 전송 실패 코드(Worker 가 비-2xx { error } 로 응답 → ApiError.message)를 아이 톤(반말) 안내로.
function friendlyError(err: unknown, status: AiCreditPublicStatus | null): string {
  const code = isApiError(err) ? err.message : "";
  switch (code) {
    case "daily_limit_reached": {
      const reason = resolveAiLimitExhaustionReason(status);
      if (reason === "parent_safety_limit") {
        return "부모님이 정한 오늘 대화 횟수를 다 썼어! 내일 또 만나자 💜";
      }
      if (reason === "free_included_limit") {
        return "무료로 오늘 5번 다 이야기했어! 더 이야기하고 싶으면 부모님께 프리미엄을 부탁해 줘 💜";
      }
      if (reason === "premium_allowance_limit") {
        return "오늘 이야기할 수 있는 횟수를 다 썼어! 더 필요하면 부모님께 알려줘 💜";
      }
      return "오늘 이야기할 수 있는 횟수를 다 썼어! 부모님께 알려줘 💜";
    }
    case "feature_disabled":
      return "나 지금 잠깐 쉬는 중이야. 부모님께 켜 달라고 부탁해 줘 🙏";
    case "not_child":
    case "no_family":
      return "지금은 이야기할 수 없어. 부모님께 알려줘!";
    case "message_too_long":
      return "조금만 짧게 다시 말해 줄래? 😊";
    default:
      return "잠깐 연결이 안 됐어. 다시 말해 줄래? 💜";
  }
}

export function AiFriendChat() {
  const navigate = useNavigate();
  const goBack = useSafeBack("/child/home");
  const location = useLocation();
  const { show } = useToast();

  // 아이 모드에서는 로그인 사용자 = 아이. childUserId = userId.
  const { familyId, userId } = useAuth();
  const { data: family } = useMyFamily();
  const { data: publicSettings } = useAiFriendPublicSettings(userId);

  // 설정 화면에서 넘어온 선택(state) 우선 → 로컬 저장 → 가족 멤버 emoji → 기본.
  const navState = (location.state ?? {}) as { characterEmoji?: string; friendName?: string };
  const familyEmoji = userId
    ? family?.members.find((m) => m.user_id === userId)?.emoji ?? undefined
    : undefined;
  const character = useMemo(() => {
    const candidates = [
      navState.characterEmoji,
      readSelectedCharacter(familyId, userId),
      familyEmoji,
      DEFAULT_CHARACTER,
    ];
    return candidates.find((c) => c && AI_FRIEND_PERSONAS.some((p) => p.emoji === c)) ?? DEFAULT_CHARACTER;
  }, [navState.characterEmoji, familyId, userId, familyEmoji]);
  const persona = personaFor(character);
  const childName =
    userId ? family?.members.find((m) => m.role === "child" && m.user_id === userId)?.name ?? "" : "";
  const friendName = resolveAiFriendDisplayName({
    savedName: navState.friendName || publicSettings?.ai_friend_name,
    childName,
    fallbackName: persona.name,
  });
  const animalSrc = asset(`animal/${persona.animal}.webp`);

  // 오늘 일정·준비물(내 것) — AI 가 먼저 물어보는 선제 인사와 제안칩의 컨텍스트(로컬 생성 · 크레딧 0).
  const { data: events } = useEvents();
  const { data: places } = useSavedPlaces();
  const now = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => todayDateKey(now), [now]);
  const suppliesQuery = useDailySupplies(todayKey);
  const myMemberId = family?.members.find((m) => m.role === "child" && m.user_id === userId)?.id ?? null;
  const nextEvent = useMemo(() => {
    const list =
      groupEventsByDateKey(filterEventsForChild(events ?? [], myMemberId), now, undefined, places)[todayKey] ?? [];
    return list.find((e) => !PAST_TAGS.has(e.tag)) ?? null;
  }, [events, myMemberId, now, todayKey, places]);
  const pendingSupply = useMemo(() => {
    const all = suppliesQuery.data ?? [];
    const mine = myMemberId ? all.filter((s) => s.child_user_id === myMemberId) : [];
    return mine.find((s) => !s.done) ?? null;
  }, [suppliesQuery.data, myMemberId]);

  // 선제 인사 — 준비물/일정이 있으면 AI 가 먼저 물어본다(서버 프롬프트도 같은 컨텍스트 인지).
  const greeting: ChatBubble = useMemo(() => {
    let text = persona.greeting;
    if (pendingSupply) {
      text = `${persona.greeting.split("!")[0]}! 오늘 「${pendingSupply.label}」 아직 안 챙겼지? 같이 확인해 볼까? 😊`;
    } else if (nextEvent) {
      text = `${persona.greeting.split("!")[0]}! 오늘 ${nextEvent.time ? `${nextEvent.time} ` : ""}${nextEvent.title} 있네! 준비는 다 됐어?`;
    }
    return { id: "greeting", role: "ai", text };
  }, [persona.greeting, pendingSupply, nextEvent]);

  // 제안칩 — 오늘 컨텍스트가 있으면 관련 질문을 앞세운다.
  const suggestions = useMemo(() => {
    const out: string[] = [];
    if (nextEvent) out.push("오늘 일정 알려줘");
    if (pendingSupply) out.push("준비물 뭐 챙겨야 해?");
    out.push(...BASE_SUGGESTIONS);
    return out.slice(0, 4);
  }, [nextEvent, pendingSupply]);

  const messagesQuery = useAiMessages(userId);
  const messagesData = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);
  const chatLoading = messagesQuery.isLoading;
  const chatError = messagesQuery.isError;
  const aiCreditStatus = useAiCreditPublicStatus(userId);
  const sendChat = useSendChildChat();
  const reportAiMessage = useReportAiMessage();
  // 공개 상태는 포함분·구매분·부모 상한을 합친 서버 정본이고, 전송 성공값도 같은 캐시에 반영된다.
  const [remaining, setRemaining] = useState<number | null>(null);
  const shownRemaining = remaining ?? aiCreditStatus.data?.availableRemaining ?? null;

  useEffect(() => {
    setRemaining(aiCreditStatus.data?.availableRemaining ?? null);
  }, [userId, aiCreditStatus.data?.availableRemaining]);

  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [input, setInput] = useState("");
  const [pendingSendSource, setPendingSendSource] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<ChatBubble | null>(null);
  usePwaUpdateCriticalSection(input.trim().length > 0 || sendChat.isPending);
  // 신고는 AI 답변을 길게 눌러 연다(버블마다 버튼을 띄우지 않기 위해).
  // 신고 대상이 아닌 말풍선(내 메시지·로컬 인사)에는 핸들러를 붙이지 않는다.
  const bindLongPressReport = useLongPress<ChatBubble>((m) => setReportTarget(m));
  const bindReportPress = useCallback(
    (m: ChatBubble): LongPressHandlers => (
      m.role === "ai" && m.reportable ? bindLongPressReport(m) : {}
    ),
    [bindLongPressReport],
  );
  const messagesRef = useRef<HTMLDivElement>(null);
  const retryChat = async () => {
    const result = await messagesQuery.refetch();
    if (result.data) setSeeded(false);
  };

  // 서버 기록이 도착하면 1회 시드(자동 전송 아님 — 표시만). 비어 있으면 인사 말풍선을 남긴다.
  useEffect(() => {
    if (seeded || !messagesQuery.data) return;
    const bubbles = messagesToBubbles(messagesData);
    setMessages(bubbles.length > 0 ? bubbles : [greeting]);
    setSeeded(true);
    // greeting 은 persona 파생(렌더마다 새 참조) — 의존성에 넣으면 시드 재실행되므로 제외.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messagesData, seeded]);

  // 로딩 전에는 인사 말풍선만 보여 화면이 비지 않게 한다.
  const shown = messages.length > 0 ? messages : [greeting];

  useEffect(() => {
    const host = messagesRef.current;
    if (host) host.scrollTo({ top: host.scrollHeight, behavior: "smooth" });
    // sendChat.isPending 이 바뀔 때(타이핑 인디케이터 등장/퇴장)도 맨 아래로 스크롤한다.
  }, [shown.length, sendChat.isPending]);

  // 전송 = 사용자 액션(버튼·칩·Enter)에서만. 자동 실행 금지. 크레딧 소모 주의.
  const send = (raw: string, source: string) => {
    const text = raw.trim();
    if (!text || sendChat.isPending) return;
    // 사용자가 대화를 시작하면 로컬 상태가 정본 — 뒤늦게 도착한 서버 기록이 덮어쓰지 않게 시드 잠금.
    if (!seeded) setSeeded(true);
    const base = `${Date.now()}`;
    setMessages((prev) => [
      ...(prev.length > 0 ? prev : [greeting]),
      { id: `${base}-me`, role: "me", text },
    ]);
    setPendingSendSource(source);
    sendChat.mutate(
      { message: text, characterEmoji: character },
      {
        onSuccess: (res) => {
          if (
            typeof res.remaining === "number"
            && Number.isSafeInteger(res.remaining)
            && res.remaining >= 0
          ) {
            setRemaining(res.remaining);
          }
          const reply = String(res.reply ?? "").trim();
          setMessages((prev) => [
            ...prev,
            reply
              ? {
                  id: res.assistantMessageId || `${base}-ai`,
                  role: "ai",
                  text: reply,
                  reportable: !!res.assistantMessageId,
                }
              // 서버가 빈 답을 주면 대답한 척하지 않는다(가짜 응답 금지 — 아이는 반말 안내).
              : {
                  id: `${base}-ai`,
                  role: "ai",
                  text: "지금은 대답을 못 받았어. 잠시 뒤에 다시 말 걸어줘!",
                },
          ]);
        },
        onError: (err) => {
          setMessages((prev) => [...prev, {
            id: `${base}-ai`,
            role: "ai",
            text: friendlyError(err, aiCreditStatus.data ?? null),
          }]);
        },
        onSettled: () => setPendingSendSource((current) => (current === source ? null : current)),
      },
    );
  };

  const handleSend = () => {
    send(input, "composer");
    setInput("");
  };

  return (
    <div className="afc">
      <header className="afc-header">
        <button
          type="button"
          className="afc-back hy-press"
          aria-label="뒤로"
          onClick={goBack}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--hy-accent-text)" />
        </button>
        <div className="afc-avatar">
          <img src={animalSrc} alt="" />
        </div>
        <div className="afc-head-main">
          <div className="afc-head-name">{friendName}</div>
        </div>
        {shownRemaining != null && (
          <span className="afc-credits">
            <MessageCircle size={14} strokeWidth={2.2} aria-hidden="true" />
            {shownRemaining}번 남았어
          </span>
        )}
        <button
          type="button"
          className="afc-setup hy-press"
          aria-label="AI 친구 바꾸기"
          onClick={() => navigate("/child/ai-friend-setup")}
        >
          <Settings size={20} strokeWidth={2.2} color="var(--hy-accent-text)" />
        </button>
      </header>

      <div ref={messagesRef} className="afc-msgs">
        {chatLoading ? (
          <div className="afc-query-state"><Loading label="지난 이야기를 불러오는 중이야" size={6} /></div>
        ) : chatError ? (
          <div className="afc-query-state" role="alert">
            <span>지난 이야기를 못 불러왔어.</span>
            <button type="button" className="hy-press" onClick={() => void retryChat()}>다시 불러오기</button>
          </div>
        ) : (
          <>
            {messagesData.length === 0 && (
              <div className="afc-query-state">아직 나눈 이야기가 없어. 먼저 말을 걸어봐!</div>
            )}
            {/* 신고 진입점 안내 — 답변마다 버튼을 띄우는 대신 길게 누르기로 옮겼다. */}
            <p className="afc-safety-hint">
              <Flag size={12} strokeWidth={2.2} aria-hidden="true" />
              마음에 걸리는 답이 있으면 길게 눌러 「이 답변 신고」를 해줘.
            </p>
            {shown.map((m) => {
              // JSX spread 는 디자인 시스템 정적 분석이 해석하지 못해 하나씩 연결한다.
              const reportPress = bindReportPress(m);
              return (
              <div key={m.id} className={`afc-row afc-row--${m.role}`}>
                {m.role === "ai" && (
                  <div className="afc-mini">
                    <img src={animalSrc} alt="" />
                  </div>
                )}
                <div className="afc-bubble-stack">
                  <div
                    className={`afc-bubble afc-bubble--${m.role}`}
                    onPointerDown={reportPress.onPointerDown}
                    onPointerMove={reportPress.onPointerMove}
                    onPointerUp={reportPress.onPointerUp}
                    onPointerCancel={reportPress.onPointerCancel}
                    onPointerLeave={reportPress.onPointerLeave}
                    onContextMenu={reportPress.onContextMenu}
                  >
                    {m.text}
                  </div>

                </div>
              </div>
              );
            })}
          </>
        )}
        {/* AI 친구 응답 대기 중 — 타이핑 인디케이터(전송 진행 중임을 정직하게 표시). */}
        {sendChat.isPending && (
          <div className="afc-row afc-row--ai">
            <div className="afc-mini">
              <img src={animalSrc} alt="" />
            </div>
            <div className="afc-bubble afc-bubble--ai afc-typing" aria-label={`${friendName}${hasJongseong(friendName) ? "이" : "가"} 생각하는 중`}>
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>

      <div className="afc-input-wrap">
        <div className="afc-suggest">
          {suggestions.map((q) => (
            <button
              key={q}
              type="button"
              className="afc-chip hy-press"
              onClick={() => send(q, `suggestion:${q}`)}
              disabled={sendChat.isPending}
              aria-busy={sendChat.isPending && pendingSendSource === `suggestion:${q}`}
            >
              {q}
            </button>
          ))}
        </div>
        <div className="afc-bar">
          <input
            className="afc-field"
            value={input}
            aria-label={`${friendName}에게 메시지`}
            placeholder={`${friendName}에게 말해 봐…`}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <button
            type="button"
            className="afc-send hy-press"
            onClick={handleSend}
            disabled={sendChat.isPending || !input.trim()}
            aria-busy={sendChat.isPending && pendingSendSource === "composer"}
          >
            보내기
          </button>
        </div>
      </div>

      <MessageSafetyDialog
        open={!!reportTarget}
        tone="child"
        title="이 답변을 알려줄래?"
        description="불편하거나 이상한 답변은 앱 안에서 바로 신고할 수 있어."
        reasons={AI_REPORT_REASONS}
        onClose={() => setReportTarget(null)}
        onReport={async (reason, detail) => {
          if (!reportTarget?.id) throw new Error("report_target_missing");
          await reportAiMessage.mutateAsync({ messageId: reportTarget.id, reason, detail });
          show("알려 줘서 고마워. 이 답변은 다시 확인할게.", "🛡️");
        }}
      />
    </div>
  );
}
