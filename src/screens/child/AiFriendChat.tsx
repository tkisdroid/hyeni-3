import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePwaUpdateCriticalSection } from "@/lib/usePwaUpdateCriticalSection";
import { useLocation, useNavigate } from "react-router";
import { ChevronLeft, Flag, MessageCircle, Mic, Phone, Settings, Volume2, VolumeX } from "lucide-react";
import {
  cancelSpeechCapture,
  captureSpeech,
  isSpeechCaptureSupported,
  isSpeechPlaybackSupported,
  speakText,
  stopSpeaking,
} from "@/lib/native/speech";
import {
  readChildVoiceReplyEnabled,
  SPEECH_LOCALE,
  speakableReplyText,
  writeChildVoiceReplyEnabled,
} from "@/transform/childVoiceChat";
import { useIntl, type IntlShape } from "react-intl";
import { useLongPress, type LongPressHandlers } from "@/lib/useLongPress";
import { asset } from "@/lib/assets";
import { useAuth } from "@/auth/AuthContext";
import { useMyFamily } from "@/queries/useFamily";
import { sendAiCreditRequest } from "@/lib/api/endpoints/family";
import { useEvents, useDailySupplies } from "@/queries/useSchedule";
import { useSavedPlaces } from "@/queries/useLocation";
import {
  useAiCreditPublicStatus,
  useAiMessages,
  useAiFriendPublicSettings,
  useSendChildChat,
} from "@/queries/useAi";
import { messagesToBubbles, stripChatMarkdownEmphasis, type ChatBubble } from "@/transform/aiView";
import { groupEventsByDateKey, PAST_TAGS } from "@/transform/scheduleView";
import { useLocale } from "@/i18n/useLocale";
import { dateToDateKeyInTimeZone } from "@/transform/dateKey";
import { LEGACY_FAMILY_TIME_ZONE } from "@/i18n/format";
import { useRecentDateKeys } from "@/app/useRecentDateKeys";
import { filterEventsForChild } from "@/transform/eventScope";
import { isApiError } from "@/lib/api/errors";
import { resolveAiFriendDisplayName } from "@/transform/aiFriendName";
import {
  resolveAiLimitExhaustionReason,
  type AiCreditPublicStatus,
} from "@/transform/aiCreditPublicStatus";
import { useToast } from "@/app/toast";
import { useAccent } from "@/app/accent";
import {
  isDeviceActionTarget,
  openDeviceAction,
  type DeviceActionTarget,
} from "@/lib/native/deviceAction";
import { useAiBuddyMood } from "@/app/aiBuddyMood";
import {
  AI_BUDDY_TYPING_FACE,
  aiBuddyEmotionLabel,
  aiBuddyFaceAsset,
} from "@/transform/aiBuddyEmotion";
import { isAccentKey } from "@/transform/childAccent";
import { placePhoneCall } from "@/lib/native/phone";
import type { AiToolResult, ConfirmedAiTool } from "@/lib/api/endpoints/ai";
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
import { resolveAiFriendClientGreeting } from "@/transform/aiFriendDisplay";
import "@/styles/jua.css";
import "./AiFriendChat.css";

/**
 * 확인 카드에 띄울 문구 — 아직 하지 않았고 아이가 눌러야 실행된다는 걸 분명히 한다.
 * 문구는 모두 catalog ID 로 두어 10개 언어에서 같은 뜻으로 보인다.
 */
function confirmCardCopy(
  tool: AiToolResult,
  intl: IntlShape,
): { title: string; detail: string; action: string } | null {
  const parentFallback = intl.formatMessage({ id: "child.aiChat.confirm.parentFallback" });
  if (tool.toolName === "createMessageToParent") {
    return {
      title: intl.formatMessage({ id: "child.aiChat.confirm.sendToParent.title" }, { who: tool.displayName || parentFallback }),
      detail: tool.message ?? "",
      action: intl.formatMessage({ id: "child.aiChat.confirm.sendToParent.action" }),
    };
  }
  if (tool.toolName === "updateSchedule") {
    const time = tool.changes?.startTime
      ? `${tool.changes.startTime}${tool.changes.endTime ? `~${tool.changes.endTime}` : ""}`
      : "";
    return {
      title: intl.formatMessage(
        { id: "child.aiChat.confirm.updateSchedule.title" },
        { title: tool.event?.title || intl.formatMessage({ id: "child.aiChat.confirm.scheduleFallback" }) },
      ),
      detail: time
        ? intl.formatMessage({ id: "child.aiChat.confirm.updateSchedule.detailTime" }, { time })
        : intl.formatMessage({ id: "child.aiChat.confirm.updateSchedule.detail" }),
      action: intl.formatMessage({ id: "child.aiChat.confirm.updateSchedule.action" }),
    };
  }
  if (tool.toolName === "callParent") {
    return {
      title: intl.formatMessage({ id: "child.aiChat.confirm.callParent.title" }, { who: tool.displayName || parentFallback }),
      detail: intl.formatMessage({ id: "child.aiChat.confirm.callParent.detail" }),
      action: intl.formatMessage({ id: "child.aiChat.confirm.callParent.action" }),
    };
  }
  return null;
}

// 전송 실패 코드와 서버 한도 원인을 아이 톤의 서로 다른 catalog ID로 연결한다.
function friendlyError(err: unknown, status: AiCreditPublicStatus | null): (intl: IntlShape) => string {
  return (intl) => {
  const code = isApiError(err) ? err.code ?? "" : "";
  switch (code) {
    case "daily_limit_reached": {
      const reason = resolveAiLimitExhaustionReason(status);
      if (reason === "parent_safety_limit") {
        return intl.formatMessage({ id: "child.aiChat.limit.parent" });
      }
      if (reason === "free_included_limit") {
        return intl.formatMessage({ id: "child.aiChat.limit.free" });
      }
      if (reason === "premium_allowance_limit") {
        return intl.formatMessage({ id: "child.aiChat.limit.premium" });
      }
      return intl.formatMessage({ id: "child.aiChat.limit.default" });
    }
    case "feature_disabled":
      return intl.formatMessage({ id: "child.aiChat.featureDisabled" });
    case "not_child":
    case "no_family":
      return intl.formatMessage({ id: "child.aiChat.unavailable" });
    case "ai_provider_busy":
      // 네트워크가 아니라 AI 공급자 쪽 한도·잔액이다. 연결 탓으로 돌리지 않는다.
      return intl.formatMessage({ id: "child.aiChat.providerBusy" });
    case "message_too_long":
      return intl.formatMessage({ id: "child.aiChat.tooLong" });
    default:
      return intl.formatMessage({ id: "child.aiChat.connectionFailed" });
  }
  };
}

export function AiFriendChat() {
  const intl = useIntl();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const goBack = useSafeBack("/child/home");
  const location = useLocation();
  const { show } = useToast();
  const { setAccent } = useAccent();
  // 플로팅 버튼과 같은 표정을 쓴다 — 대화하다 홈으로 나가도 친구 기분이 이어진다.
  const { emotion, reactTo } = useAiBuddyMood();

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
  // 말풍선 옆 얼굴도 헤더·플로팅 버튼과 같은 AI 친구 얼굴이다.
  // (동물 프로필을 쓰면 "토끼와 대화하는 느낌"이 되어 친구가 둘처럼 보였다.)
  const friendFaceSrc = asset(aiBuddyFaceAsset(emotion));
  // 답을 쓰는 동안에는 "입력중" 얼굴로 지금 무엇을 하는지 보여 준다.
  const friendTypingFaceSrc = asset(aiBuddyFaceAsset(AI_BUDDY_TYPING_FACE));

  // 오늘 일정·준비물(내 것) — AI 가 먼저 물어보는 선제 인사와 제안칩의 컨텍스트(로컬 생성 · 크레딧 0).
  const { data: events } = useEvents();
  const { data: places } = useSavedPlaces();
  const recentDateKeys = useRecentDateKeys(1, LEGACY_FAMILY_TIME_ZONE);
  const recentTodayKey = recentDateKeys[0];
  const now = useMemo(() => new Date(), [recentTodayKey]);
  const todayKey = recentTodayKey
    ?? dateToDateKeyInTimeZone(now, LEGACY_FAMILY_TIME_ZONE);
  const suppliesQuery = useDailySupplies(todayKey);
  const myMemberId = family?.members.find((m) => m.role === "child" && m.user_id === userId)?.id ?? null;
  const nextEvent = useMemo(() => {
    const list =
      groupEventsByDateKey(
        filterEventsForChild(events ?? [], myMemberId),
        now,
        locale,
        LEGACY_FAMILY_TIME_ZONE,
        undefined,
        places,
      )[todayKey] ?? [];
    return list.find((e) => !PAST_TAGS.has(e.tag)) ?? null;
  }, [events, locale, myMemberId, now, todayKey, places]);
  const pendingSupply = useMemo(() => {
    const all = suppliesQuery.data ?? [];
    const mine = myMemberId ? all.filter((s) => s.child_user_id === myMemberId) : [];
    return mine.find((s) => !s.done) ?? null;
  }, [suppliesQuery.data, myMemberId]);

  // 선제 인사 — 준비물/일정이 있으면 AI 가 먼저 물어본다(서버 프롬프트도 같은 컨텍스트 인지).
  const greeting: ChatBubble = useMemo(() => {
    const text = resolveAiFriendClientGreeting(
      intl,
      persona.key,
      pendingSupply
        ? { supplyLabel: pendingSupply.label }
        : nextEvent
          ? { eventTitle: nextEvent.title, eventTime: nextEvent.time }
          : null,
    );
    return { id: "greeting", role: "ai", text };
  }, [intl, persona.key, pendingSupply, nextEvent]);

  // 제안칩 — 오늘 컨텍스트가 있으면 관련 질문을 앞세운다.
  const suggestions = useMemo(() => {
    const out: string[] = [];
    if (nextEvent) out.push(intl.formatMessage({ id: "child.aiChat.suggestion.schedule" }));
    if (pendingSupply) out.push(intl.formatMessage({ id: "child.aiChat.suggestion.supplies" }));
    out.push(
      intl.formatMessage({ id: "child.aiChat.suggestion.play" }),
      intl.formatMessage({ id: "child.aiChat.suggestion.bored" }),
      intl.formatMessage({ id: "child.aiChat.suggestion.story" }),
    );
    return out.slice(0, 4);
  }, [intl, nextEvent, pendingSupply]);

  const reportReasons = useMemo<readonly ReportReasonOption<AiContentReportReason>[]>(() => [
    { value: "scary_or_uncomfortable", label: intl.formatMessage({ id: "child.aiChat.report.scary" }) },
    { value: "abusive_language", label: intl.formatMessage({ id: "child.aiChat.report.abusive" }) },
    { value: "asks_personal_info", label: intl.formatMessage({ id: "child.aiChat.report.personalInfo" }) },
    { value: "inaccurate", label: intl.formatMessage({ id: "child.aiChat.report.inaccurate" }) },
    { value: "other", label: intl.formatMessage({ id: "child.aiChat.report.other" }) },
  ], [intl]);

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
  // 한도가 없는 가족은 남은 횟수 대신 무제한을 보여준다(줄지 않는 숫자는 고장처럼 보인다).
  const [unlimited, setUnlimited] = useState(false);
  const shownUnlimited = unlimited || aiCreditStatus.data?.unlimited === true;

  useEffect(() => {
    setRemaining(aiCreditStatus.data?.availableRemaining ?? null);
  }, [userId, aiCreditStatus.data?.availableRemaining]);

  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [input, setInput] = useState("");
  const [pendingSendSource, setPendingSendSource] = useState<string | null>(null);
  // 아직 실행하지 않고 아이 확인을 기다리는 도구(부모 메시지·일정 변경·전화).
  const [pendingTool, setPendingTool] = useState<AiToolResult | null>(null);
  // 기기 동작은 앱이 대신 하지 않는다 — 열어 줄 화면만 기억해 두고 아이가 누른다(2026-08-18).
  const [deviceAction, setDeviceAction] = useState<{ target: DeviceActionTarget; phone: string | null } | null>(null);
  const [reportTarget, setReportTarget] = useState<ChatBubble | null>(null);
  // 부모에게 충전을 부탁하는 중/부탁 완료 — 버튼 상태를 정직하게 나눈다.
  const [creditRequest, setCreditRequest] = useState<"idle" | "sending" | "sent">("idle");
  // ── 음성 대화 ──
  // 아이는 타자보다 말이 빠르다. 마이크로 말을 걸고 답을 귀로 들으면 "쓰는 앱"이 아니라
  // "친구와 이야기하는" 경험이 된다.
  const [listening, setListening] = useState(false);
  const voiceGenRef = useRef(0);
  const [voiceReply, setVoiceReply] = useState(false);
  const voiceReplyRef = useRef(false);
  const speechLang = SPEECH_LOCALE[locale];
  const micSupported = useMemo(() => isSpeechCaptureSupported(), []);
  const playbackSupported = useMemo(() => isSpeechPlaybackSupported(), []);

  // 저장된 읽어주기 설정은 아이가 바뀌면 다시 읽는다(가족+아이 키).
  useEffect(() => {
    const enabled = readChildVoiceReplyEnabled(familyId, userId);
    setVoiceReply(enabled);
    voiceReplyRef.current = enabled;
  }, [familyId, userId]);

  // 화면을 떠나면 듣기·읽어주기를 반드시 멈춘다(뒤에서 계속 말하면 안 된다).
  useEffect(() => () => {
    voiceGenRef.current += 1;
    cancelSpeechCapture();
    stopSpeaking();
  }, []);
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

  /**
   * 서버가 실제로 한 일을 화면에 반영한다.
   * · 확인이 필요한 도구는 카드로 세워 두고 아이가 누르기 전에는 실행된 척하지 않는다.
   * · 내 색깔은 서버 컬럼이 없어 기기에서 적용한다(서버가 색만 확정해 준다).
   */
  const applyToolResult = useCallback(
    (tool: AiToolResult | null | undefined) => {
      if (!tool || tool.ok !== true) return;
      if (tool.confirmationRequired === true) {
        setPendingTool(tool);
        return;
      }
      setPendingTool(null);
      if (tool.toolName === "changeAppTheme" && tool.clientAction === "setAccent" && isAccentKey(tool.accent)) {
        setAccent(tool.accent);
      }
      if (
        tool.toolName === "openDeviceAction"
        && tool.clientAction === "openDeviceAction"
        && isDeviceActionTarget(tool.target)
      ) {
        // 여는 것도 아이가 버튼을 눌렀을 때만 한다(대화 도착만으로 화면을 가로채지 않는다).
        setDeviceAction({ target: tool.target, phone: tool.phone ?? null });
      }
    },
    [setAccent],
  );

  // 전송 = 사용자 액션(버튼·칩·Enter)에서만. 자동 실행 금지. 크레딧 소모 주의.
  const send = (raw: string, source: string, confirmedTool?: ConfirmedAiTool) => {
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
    reactTo({ phase: "thinking", childText: text });
    sendChat.mutate(
      { message: text, characterEmoji: character, ...(confirmedTool ? { confirmedTool } : {}) },
      {
        onSuccess: (res) => {
          if (
            typeof res.remaining === "number"
            && Number.isSafeInteger(res.remaining)
            && res.remaining >= 0
          ) {
            setRemaining(res.remaining);
          }
          if (res.unlimited === true) setUnlimited(true);
          // 말풍선은 순수 텍스트라 마크다운을 해석하지 않는다 — 별표가 그대로 보이지 않게 벗긴다.
          const reply = stripChatMarkdownEmphasis(String(res.reply ?? "").trim());
          setMessages((prev) => [
            ...prev,
            reply
              ? {
                  id: res.assistantMessageId || `${base}-ai`,
                  role: "ai",
                  text: reply,
                  reportable: !!res.assistantMessageId,
                }
              : {
                  id: `${base}-ai`,
                  role: "ai",
                  text: intl.formatMessage({ id: "child.ai.emptyResponse" }),
                },
          ]);
          applyToolResult(res.toolResult);
          // 읽어주기가 켜져 있으면 답을 소리로 들려준다(실패는 조용히 넘긴다 — 글은 이미 떠 있다).
          if (voiceReplyRef.current && reply) {
            void speakText(speakableReplyText(reply), speechLang);
          }
          reactTo({
            phase: "reply",
            childText: text,
            replyText: reply,
            toolResult: res.toolResult ?? null,
            safetyRiskLevel: res.safety?.riskLevel ?? null,
          });
        },
        onError: (err) => {
          const limitReached = isApiError(err) && err.code === "daily_limit_reached";
          setMessages((prev) => [...prev, {
            id: `${base}-ai`,
            role: "ai",
            text: friendlyError(err, aiCreditStatus.data ?? null)(intl),
            // 다 쓴 게 원인일 때만 부탁 버튼을 붙인다(연결 실패에 붙이면 엉뚱한 길이다).
            creditExhausted: limitReached,
          }]);
          reactTo({ phase: "reply", childText: text, toolResult: { ok: false } });
        },
        onSettled: () => setPendingSendSource((current) => (current === source ? null : current)),
      },
    );
  };

  const handleSend = () => {
    send(input, "composer");
    setInput("");
  };

  /**
   * 마이크로 말 걸기. 인식된 말을 곧바로 보낸다 —
   * 아이가 "말하고 → 확인하고 → 전송" 3단계를 거치면 대화가 아니라 받아쓰기가 된다.
   */
  const startVoice = () => {
    if (listening || sendChat.isPending) return;
    if (!micSupported) {
      show(intl.formatMessage({ id: "child.aiChat.voice.unsupported" }), "🎤");
      return;
    }
    // 내 차례에 친구가 계속 말하고 있으면 어색하다 — 듣기 시작 전에 읽어주기를 멈춘다.
    stopSpeaking();
    const gen = ++voiceGenRef.current;
    setListening(true);
    void captureSpeech(speechLang)
      .then((transcript) => {
        if (gen !== voiceGenRef.current) return; // 화면 이탈·중단된 인식은 무시
        const spoken = transcript.trim();
        if (!spoken) {
          show(intl.formatMessage({ id: "child.aiChat.voice.empty" }), "🎤");
          return;
        }
        send(spoken, "voice");
      })
      .catch(() => {
        if (gen !== voiceGenRef.current) return;
        show(intl.formatMessage({ id: "child.aiChat.voice.failed" }), "🎤");
      })
      .finally(() => {
        if (gen === voiceGenRef.current) setListening(false);
      });
  };

  const stopVoice = () => {
    voiceGenRef.current += 1;
    cancelSpeechCapture();
    setListening(false);
  };

  /** 읽어주기 켜기/끄기. 끄면 지금 읽고 있던 말도 즉시 멈춘다. */
  const toggleVoiceReply = () => {
    const next = !voiceReply;
    setVoiceReply(next);
    voiceReplyRef.current = next;
    writeChildVoiceReplyEnabled(familyId, userId, next);
    if (!next) stopSpeaking();
  };

  /**
   * 오늘 대화를 다 썼을 때 부모에게 바로 부탁한다.
   * 서버가 소진 여부를 다시 판정하고 문구도 서버가 만든다 — 여기서는 요청만 보낸다.
   */
  const requestParentCredit = () => {
    if (creditRequest !== "idle" || !familyId || !userId) return;
    setCreditRequest("sending");
    void sendAiCreditRequest({ familyId, childUserId: userId })
      .then((result) => {
        setCreditRequest("sent");
        show(
          intl.formatMessage({
            id: result.duplicate
              ? "child.aiChat.creditRequest.already"
              : "child.aiChat.creditRequest.sent",
          }),
          "💌",
        );
      })
      .catch(() => {
        setCreditRequest("idle");
        show(intl.formatMessage({ id: "child.aiChat.creditRequest.failed" }), "⚠️");
      });
  };

  /** 확인 카드의 실행 버튼 — 여기서만 서버가 실제로 부탁을 처리한다. */
  const runPendingTool = () => {
    const tool = pendingTool;
    if (!tool || sendChat.isPending) return;

    if (tool.toolName === "callParent") {
      setPendingTool(null);
      if (tool.phone) {
        void placePhoneCall(tool.phone);
      } else {
        show(intl.formatMessage({ id: "child.aiChat.confirm.noPhone" }), "☎️");
      }
      return;
    }
    if (!tool.confirmationToken) {
      show(intl.formatMessage({ id: "child.aiChat.confirm.retry" }), "⚠️");
      setPendingTool(null);
      return;
    }
    const confirmed: ConfirmedAiTool | null =
      tool.toolName === "createMessageToParent"
        ? {
            toolName: "sendMessageToParent",
            confirmationToken: tool.confirmationToken,
            parentRole: tool.parentRole,
            message: tool.message,
          }
        : tool.toolName === "updateSchedule"
          ? {
              toolName: "updateSchedule",
              confirmationToken: tool.confirmationToken,
              scheduleId: tool.event?.id,
              title: tool.event?.title,
              changes: tool.changes,
            }
          : null;
    if (!confirmed) {
      setPendingTool(null);
      return;
    }
    setPendingTool(null);
    send(intl.formatMessage({ id: "child.aiChat.confirm.yes" }), "confirm", confirmed);
  };

  return (
    <div className="afc">
      <header className="afc-header">
        <button
          type="button"
          className="afc-back hy-press"
          aria-label={intl.formatMessage({ id: "child.action.back" })}
          onClick={goBack}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="var(--hy-accent-text)" />
        </button>
        <div className="afc-avatar" data-emotion={emotion}>
          <img src={friendFaceSrc} alt={aiBuddyEmotionLabel(emotion)} />
        </div>
        {/* 이름만 둔다. 아래 상태 한 줄과 가짜 온라인 점은 장식이라 좁은 헤더에서 잘리기만 했다
            (2026-08-17 TK 제보 "얘기…"). 표정은 아바타가 이미 말해 준다. */}
        <div className="afc-head-main">
          <div className="afc-head-name">{friendName}</div>
        </div>
        {shownUnlimited ? (
          <span className="afc-credits">
            <MessageCircle size={14} strokeWidth={2.2} aria-hidden="true" />
            {intl.formatMessage({ id: "child.aiChat.remainingUnlimited" })}
          </span>
        ) : shownRemaining != null && (
          <span className="afc-credits">
            <MessageCircle size={14} strokeWidth={2.2} aria-hidden="true" />
            {intl.formatMessage({ id: "child.aiChat.remaining" }, { count: shownRemaining })}
          </span>
        )}
        {playbackSupported && (
          <button
            type="button"
            className="afc-voicetog hy-press"
            aria-pressed={voiceReply}
            aria-label={intl.formatMessage({
              id: voiceReply ? "child.aiChat.voice.replyOffAria" : "child.aiChat.voice.replyOnAria",
            })}
            onClick={toggleVoiceReply}
          >
            {voiceReply
              ? <Volume2 size={20} strokeWidth={2.2} color="var(--hy-accent-text)" />
              : <VolumeX size={20} strokeWidth={2.2} color="var(--fg-tertiary)" />}
          </button>
        )}
        <button
          type="button"
          className="afc-setup hy-press"
          aria-label={intl.formatMessage({ id: "child.aiChat.changeFriend" })}
          onClick={() => navigate("/child/ai-friend-setup")}
        >
          <Settings size={20} strokeWidth={2.2} color="var(--hy-accent-text)" />
        </button>
      </header>

      <div ref={messagesRef} className="afc-msgs">
        {chatLoading ? (
          <div className="afc-query-state"><Loading label={intl.formatMessage({ id: "child.aiChat.loading" })} size={6} /></div>
        ) : chatError ? (
          <div className="afc-query-state" role="alert">
            <span>{intl.formatMessage({ id: "child.aiChat.loadError" })}</span>
            <button type="button" className="hy-press" onClick={() => void retryChat()}>
              {intl.formatMessage({ id: "child.action.reload" })}
            </button>
          </div>
        ) : (
          <>
            {messagesData.length === 0 && (
              <div className="afc-query-state">{intl.formatMessage({ id: "child.aiChat.empty" })}</div>
            )}
            <p className="afc-safety-hint">
              <Flag size={12} strokeWidth={2.2} aria-hidden="true" />
              {intl.formatMessage({ id: "child.aiChat.reportHint" })}
            </p>
            {shown.map((m) => {
              // JSX spread 는 디자인 시스템 정적 분석이 해석하지 못해 하나씩 연결한다.
              const reportPress = bindReportPress(m);
              return (
              <div key={m.id} className={`afc-row afc-row--${m.role}`}>
                {m.role === "ai" && (
                  <div className="afc-mini">
                    <img src={friendFaceSrc} alt="" />
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
                  {m.creditExhausted && (
                    <button
                      type="button"
                      className="afc-credit-ask hy-press"
                      onClick={requestParentCredit}
                      disabled={creditRequest !== "idle"}
                      aria-busy={creditRequest === "sending"}
                    >
                      {intl.formatMessage({
                        id: creditRequest === "sent"
                          ? "child.aiChat.creditRequest.done"
                          : "child.aiChat.creditRequest.action",
                      })}
                    </button>
                  )}
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
              <img src={friendTypingFaceSrc} alt="" />
            </div>
            <div
              className="afc-bubble afc-bubble--ai afc-typing"
              aria-label={intl.formatMessage({ id: "child.aiChat.thinking" }, { name: friendName })}
            >
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>

      {/* 기기 동작 — 앱이 바꾸지 않고 화면만 열어 준다. 마지막 한 번은 아이가 누른다. */}
      {deviceAction && (
        <div className="afc-device" role="group">
          <button
            type="button"
            className="afc-device__open hy-press"
            onClick={() => {
              void (async () => {
                const result = await openDeviceAction(deviceAction);
                if (!result.opened) {
                  show(intl.formatMessage({ id: "child.aiChat.device.unavailable" }), "⚠️");
                  return;
                }
                setDeviceAction(null);
              })();
            }}
          >
            {intl.formatMessage({ id: `child.aiChat.device.${deviceAction.target}` })}
          </button>
        </div>
      )}

      {/* 확인이 필요한 부탁 — 여기서 누르기 전에는 아무것도 실행되지 않았다. */}
      {pendingTool && (() => {
        const copy = confirmCardCopy(pendingTool, intl);
        if (!copy) return null;
        return (
          <div className="afc-confirm" role="group" aria-label={intl.formatMessage({ id: "child.aiChat.confirm.group" })}>
            <div className="afc-confirm__title">{copy.title}</div>
            {copy.detail && <div className="afc-confirm__detail">{copy.detail}</div>}
            <div className="afc-confirm__actions">
              <button
                type="button"
                className="afc-confirm__cancel hy-press"
                onClick={() => setPendingTool(null)}
              >
                {intl.formatMessage({ id: "child.aiChat.confirm.cancel" })}
              </button>
              <button
                type="button"
                className="afc-confirm__go hy-press"
                onClick={runPendingTool}
                disabled={sendChat.isPending}
                aria-busy={sendChat.isPending && pendingSendSource === "confirm"}
              >
                {pendingTool.toolName === "callParent" && (
                  <Phone size={16} strokeWidth={2.4} aria-hidden="true" />
                )}
                {copy.action}
              </button>
            </div>
          </div>
        );
      })()}

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
        {listening && (
          <div className="afc-listening" role="status">
            <span className="afc-listening__wave" aria-hidden="true">
              <span /><span /><span /><span />
            </span>
            {intl.formatMessage({ id: "child.aiChat.voice.listening" })}
            <button type="button" className="afc-listening__stop hy-press" onClick={stopVoice}>
              {intl.formatMessage({ id: "child.aiChat.voice.stop" })}
            </button>
          </div>
        )}
        <div className="afc-bar">
          {micSupported && (
            <button
              type="button"
              className={listening ? "afc-mic afc-mic--on hy-press" : "afc-mic hy-press"}
              onClick={listening ? stopVoice : startVoice}
              disabled={sendChat.isPending}
              // 진행 표시는 전송 버튼이 소유한다 — 마이크는 전송 중 잠기기만 한다.
              data-progress-owner="afc-send"
              aria-label={intl.formatMessage({
                id: listening ? "child.aiChat.voice.stopAria" : "child.aiChat.voice.startAria",
              })}
            >
              <Mic size={20} strokeWidth={2.2} aria-hidden="true" />
            </button>
          )}
          <input
            className="afc-field"
            value={input}
            aria-label={intl.formatMessage({ id: "child.aiChat.messageAria" }, { name: friendName })}
            placeholder={intl.formatMessage({ id: "child.aiChat.placeholder" }, { name: friendName })}
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
            {intl.formatMessage({ id: "child.action.send" })}
          </button>
        </div>
      </div>

      <MessageSafetyDialog
        open={!!reportTarget}
        tone="child"
        title={intl.formatMessage({ id: "child.aiChat.report.title" })}
        description={intl.formatMessage({ id: "child.aiChat.report.description" })}
        reasons={reportReasons}
        onClose={() => setReportTarget(null)}
        onReport={async (reason, detail) => {
          if (!reportTarget?.id) throw new Error("report_target_missing");
          await reportAiMessage.mutateAsync({ messageId: reportTarget.id, reason, detail });
          show(intl.formatMessage({ id: "child.aiChat.report.thanks" }), "🛡️");
        }}
      />
    </div>
  );
}
