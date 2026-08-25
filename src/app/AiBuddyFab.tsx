import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useIntl } from "react-intl";
import { useAuth } from "@/auth/AuthContext";
import { useToast } from "@/app/toast";
import { asset } from "@/lib/assets";
import { useAiFriendPublicSettings } from "@/queries/useAi";
import { useAiBuddyNudgeInput } from "@/queries/useAiBuddyNudge";
import { useLongPress } from "@/lib/useLongPress";
import { prefersReducedMotion } from "@/lib/reducedMotion";
import { useAiBuddyMood } from "./aiBuddyMood";
import { preloadRoute } from "./routePreload";
import {
  AI_BUDDY_BLINK_DURATION_MS,
  AI_BUDDY_BLINK_FACE,
  AI_BUDDY_BLINK_INTERVAL_MS,
  AI_BUDDY_CHAT_FACES,
  AI_BUDDY_TAP_FACE,
  aiBuddyChatFaceAsset,
  aiBuddyEmotionLabel,
  aiBuddyFaceFor,
  type AiBuddyChatFace,
} from "@/transform/aiBuddyEmotion";
import {
  AI_BUDDY_WANDER_LINE_MS,
  AI_BUDDY_WANDER_STEP_MS,
  AI_BUDDY_WANDER_TRAVEL_MS,
  aiBuddyWanderFace,
  aiBuddyWanderLine,
  canAiBuddyWander,
  nextAiBuddyWanderRatio,
  shouldShowAiBuddyWanderLine,
} from "@/transform/aiBuddyWander";
import {
  aiBuddyFabOffset,
  aiBuddyFabPresentation,
  aiBuddyFabRatioFromOffset,
  aiBuddyFabStorageKey,
  DEFAULT_AI_BUDDY_FAB_RATIO,
  isAiBuddyFabTap,
  normalizeAiBuddyFabRatio,
  snapAiBuddyFabRatio,
  type AiBuddyFabFrame,
  type AiBuddyFabPresentation,
  type AiBuddyFabRatio,
} from "@/transform/aiBuddyFabPosition";
import {
  aiBuddyVoiceHintStorageKey,
  markAiBuddyVoiceHintShown,
  markAiBuddyVoiceHintUsed,
  readAiBuddyVoiceHintState,
  shouldShowAiBuddyVoiceHint,
  writeAiBuddyVoiceHintState,
  AI_BUDDY_VOICE_HINT_DELAY_MS,
  AI_BUDDY_VOICE_HINT_MS,
  AI_BUDDY_VOICE_LONG_PRESS_MS,
  EMPTY_AI_BUDDY_VOICE_HINT_STATE,
  type AiBuddyVoiceHintState,
} from "@/transform/aiBuddyVoiceHint";
import {
  aiBuddyAttentionDurationMs,
  aiBuddyAttentionStage,
  aiBuddyAttentionStorageKey,
  AI_BUDDY_ATTENTION_TICK_MS,
  EMPTY_AI_BUDDY_ATTENTION_STATE,
  markAiBuddyAttentionShown,
  readAiBuddyAttentionState,
  shouldPlayAiBuddyAttention,
  writeAiBuddyAttentionState,
  type AiBuddyAttentionStage,
  type AiBuddyAttentionState,
} from "@/transform/aiBuddyAttention";
import { aiBuddyLaunchDelayMs, AI_BUDDY_HANDOFF_FACE_PX } from "@/transform/aiBuddyLaunch";
import { buildAiBuddyNudge, type AiBuddyNudge } from "@/transform/aiBuddyNudge";
import { resolveAiFriendDisplayName } from "@/transform/aiFriendName";
import {
  aiBuddyHomeChatHintLine,
  resolveAiBuddyFabBubbleLine,
  resolveAiBuddyFabTarget,
} from "@/transform/aiBuddyFabPrompt";
import "./AiBuddyFab.css";

/** 상단 상태바·화면 헤더가 가리는 높이. 이 아래로만 버튼을 놓는다. */
const TOP_INSET = 64;

/** 정적 기본 class는 디자인 가드가 읽고, 모드 modifier는 런타임에 한 곳에서 붙인다. */
function aiBuddyFabModeClassName(baseClass: "abf", mode: AiBuddyFabPresentation["mode"]): string {
  return `${baseClass} ${baseClass}--${mode}`;
}

function aiBuddyFabFaceClassName(baseClass: "abf__face", face: AiBuddyChatFace): string {
  return `${baseClass} ${baseClass}--${face}`;
}

/**
 * AI 친구 화면 안에서는 버튼을 띄우지 않는다.
 * 이미 친구와 이야기하는 중인데 얼굴이 두 개 떠 있으면 무엇을 눌러야 할지 헷갈린다.
 * SOS·온보딩은 다른 것에 집중해야 하는 화면이라 함께 제외한다.
 */
const HIDDEN_PATHS = new Set([
  "/child/ai-friend",
  "/child/ai-friend-setup",
  "/child/sos",
  "/onboarding",
]);

function readStoredRatio(key: string): AiBuddyFabRatio {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return DEFAULT_AI_BUDDY_FAB_RATIO;
    return normalizeAiBuddyFabRatio(JSON.parse(raw)) ?? DEFAULT_AI_BUDDY_FAB_RATIO;
  } catch {
    return DEFAULT_AI_BUDDY_FAB_RATIO;
  }
}

function writeStoredRatio(key: string, ratio: AiBuddyFabRatio): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(ratio));
  } catch {
    // 저장 실패는 기능을 막지 않는다(이번 세션 위치만 유지).
  }
}

interface AiBuddyFabProps {
  /** 하단 독·탭바가 가리는 높이. 셸마다 다르므로 화면 쪽이 알려 준다. */
  bottomInset: number;
}

/**
 * 아이 모드 어디서나 떠 있는 AI 친구 버튼.
 *
 * · 드래그로 옮길 수 있고 손을 떼면 가까운 가장자리에 붙는다(콘텐츠를 계속 가리지 않도록).
 * · 표정은 대화 상태를 따라 바뀌며, 대기 중에는 눈을 깜빡여 "기다리고 있다"를 보여 준다.
 * · 오늘 알아야 할 것(부모님 메시지·다음 일정·못 챙긴 준비물)을 스스로 먼저 알려 준다.
 * · 가끔 커졌다 화면을 채우고 다시 작아지며 아이를 부른다(부모가 설정에서 끌 수 있다).
 * · 아이 세션에서만, AI 친구 화면 밖에서만 렌더한다.
 */
export function AiBuddyFab({ bottomInset }: AiBuddyFabProps) {
  const { role } = useAuth();
  const location = useLocation();
  if (role !== "child" || HIDDEN_PATHS.has(location.pathname)) return null;
  return (
    <AiBuddyFabButton
      bottomInset={bottomInset}
      presentation={aiBuddyFabPresentation(location.pathname)}
    />
  );
}

interface AiBuddyFabButtonProps extends AiBuddyFabProps {
  presentation: AiBuddyFabPresentation;
}

function AiBuddyFabButton({ bottomInset, presentation }: AiBuddyFabButtonProps) {
  const navigate = useNavigate();
  const intl = useIntl();
  const { show } = useToast();
  const { familyId, userId } = useAuth();
  const { emotion } = useAiBuddyMood();
  const friendSettings = useAiFriendPublicSettings(userId);
  const chatTarget = resolveAiBuddyFabTarget({
    settings: friendSettings.data,
    loading: friendSettings.isLoading,
    error: friendSettings.isError,
  });
  const friendName = resolveAiFriendDisplayName({ savedName: friendSettings.data?.ai_friend_name });
  // AI 친구가 꺼진 가족에서는 말 걸 재료도 받지 않는다(열 수 없는 대화를 위한 통신은 낭비다).
  const aiEnabled = friendSettings.data?.ai_enabled === true;
  // 부모가 명시적으로 끄면 부르지 않는다. 설정을 아직 못 읽었으면 조용히 있는다.
  const attentionAllowed = presentation.canPrompt
    && aiEnabled
    && friendSettings.data?.buddy_attention_enabled !== false;
  const nudgeInput = useAiBuddyNudgeInput(aiEnabled && presentation.canPrompt);

  const storageKey = aiBuddyFabStorageKey(familyId, userId);
  const hostRef = useRef<HTMLButtonElement>(null);
  const [ratio, setRatio] = useState<AiBuddyFabRatio>(DEFAULT_AI_BUDDY_FAB_RATIO);
  const [dragging, setDragging] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const [pop, setPop] = useState(false);
  // 배회는 임시 자리다 — 저장하지 않고 새로 열면 아이가 둔 자리에서 다시 시작한다.
  const [wanderRatio, setWanderRatio] = useState<AiBuddyFabRatio | null>(null);
  const [wanderFace, setWanderFace] = useState<AiBuddyChatFace | null>(null);
  const [wanderLine, setWanderLine] = useState<string | null>(null);
  const [tapped, setTapped] = useState(false);
  // 길게 누르면 마이크가 바로 켜진다는 안내 — 아직 써 보지 않은 아이에게만 띄운다.
  const [voiceHint, setVoiceHint] = useState(false);
  // 스스로 아이를 부르는 중(커지기 / 화면 채우기)과 그때 건네는 말.
  const [attention, setAttention] = useState<{ stage: AiBuddyAttentionStage; nudge: AiBuddyNudge } | null>(null);
  // 대화 화면으로 이어지는 전환 중(버튼이 커지며 가운데로 간다).
  const [launching, setLaunching] = useState(false);
  const voiceHintStateRef = useRef<AiBuddyVoiceHintState>(EMPTY_AI_BUDDY_VOICE_HINT_STATE);
  const voiceHintKey = aiBuddyVoiceHintStorageKey(familyId, userId);
  const attentionKey = aiBuddyAttentionStorageKey(familyId, userId);
  const attentionStateRef = useRef<AiBuddyAttentionState>(EMPTY_AI_BUDDY_ATTENTION_STATE);
  const attentionRef = useRef(attention);
  attentionRef.current = attention;
  const attentionHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attentionAllowedRef = useRef(attentionAllowed);
  attentionAllowedRef.current = attentionAllowed;
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;
  const nudgeInputRef = useRef(nudgeInput);
  nudgeInputRef.current = nudgeInput;
  const mountedAtRef = useRef(Date.now());
  const launchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const launchingRef = useRef(launching);
  launchingRef.current = launching;
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const wanderStepRef = useRef(0);
  const wanderRatioRef = useRef<AiBuddyFabRatio | null>(null);
  wanderRatioRef.current = wanderRatio;
  // 배회 타이머는 감정이 바뀌어도 다시 만들지 않는다 — 재생성되면 도착 표정 타이머가 취소돼
  // 친구가 두리번거리는 얼굴에서 멈춘다(실측: 첫 걸음이 7.5초 동안 explore 로 굳었다).
  const emotionRef = useRef(emotion);
  emotionRef.current = emotion;
  const arrivalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDragAtRef = useRef<number | null>(null);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;
  const liveRatio = wanderRatio ?? ratio;

  // 드래그 중에는 state 를 갱신하지 않고 스타일만 직접 옮긴다(매 프레임 리렌더 방지).
  const dragRef = useRef<{
    pointerId: number;
    grabX: number;
    grabY: number;
    startX: number;
    startY: number;
    startedAt: number;
    moved: boolean;
    frame: AiBuddyFabFrame;
  } | null>(null);

  useEffect(() => {
    setRatio(readStoredRatio(storageKey));
  }, [storageKey]);

  const measureFrame = useCallback((): AiBuddyFabFrame => {
    const parent = hostRef.current?.offsetParent as HTMLElement | null;
    return {
      width: parent?.clientWidth ?? window.innerWidth,
      height: parent?.clientHeight ?? window.innerHeight,
      topInset: TOP_INSET,
      bottomInset: bottomInset + presentation.bottomClearance,
      // 홈 크기는 화면 폭에 반응하는 CSS clamp다. 실제 렌더 폭을 써야 드래그 경계가 정확하다.
      fabSize: hostRef.current?.offsetWidth ?? presentation.size,
    };
  }, [bottomInset, presentation.bottomClearance, presentation.size]);

  const applyOffset = useCallback(
    (next: AiBuddyFabRatio) => {
      const host = hostRef.current;
      if (!host) return;
      const { left, top } = aiBuddyFabOffset(next, measureFrame());
      host.style.left = `${Math.round(left)}px`;
      host.style.top = `${Math.round(top)}px`;
    },
    [measureFrame],
  );

  useLayoutEffect(() => {
    // 전환 중에는 가운데로 보낸 좌표를 유지한다(제자리로 되돌리면 동작이 중간에 끊긴다).
    if (launching) return;
    applyOffset(liveRatio);
  }, [applyOffset, launching, liveRatio]);

  // 회전·키보드 등으로 프레임 크기가 바뀌면 비율은 그대로 두고 위치만 다시 계산한다.
  useEffect(() => {
    const parent = hostRef.current?.offsetParent as HTMLElement | null;
    if (!parent || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => {
      if (launchingRef.current) return;
      applyOffset(ratioRef.current);
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [applyOffset]);

  // 대기 중 눈 깜빡임 — 정지한 그림이 아니라 기다리는 친구로 읽히게 한다.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    const interval = setInterval(() => {
      setBlinking(true);
      closeTimer = setTimeout(() => setBlinking(false), AI_BUDDY_BLINK_DURATION_MS);
    }, AI_BUDDY_BLINK_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      if (closeTimer) clearTimeout(closeTimer);
    };
  }, []);

  // 대기 중 스스로 조금씩 옮겨 다니며 표정을 짓는다("살아 있는 친구").
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const timer = setInterval(() => {
      if (!presentationRef.current.canWander) return;
      const gate = {
        dragging: dragRef.current !== null,
        showingEmotion: emotionRef.current !== "idle" && emotionRef.current !== "sleepy",
        visible: typeof document === "undefined" ? true : !document.hidden,
        reducedMotion: prefersReducedMotion(),
        msSinceDrag: lastDragAtRef.current === null ? null : Date.now() - lastDragAtRef.current,
      };
      if (!canAiBuddyWander(gate)) return;
      // 부르는 중·전환 중에는 배회하지 않는다 — 커진 얼굴이 걸어 다니면 어지럽다.
      if (attentionRef.current || launchingRef.current) return;
      const step = wanderStepRef.current + 1;
      wanderStepRef.current = step;
      const from = wanderRatioRef.current ?? ratioRef.current;
      const next = nextAiBuddyWanderRatio(from, step);
      setWanderRatio(next);
      setWanderFace(aiBuddyWanderFace(step, true));
      // 도착하면 아이에게 말을 걸 듯한 얼굴로 바꾼다(이동 중은 두리번거리는 얼굴).
      arrivalTimerRef.current = setTimeout(() => {
        const arrival = aiBuddyWanderFace(step, false);
        // 몇 걸음에 한 번만 짧게 말을 건다 — 매번 띄우면 화면을 가리고 잔소리가 된다.
        if (!shouldShowAiBuddyWanderLine(step)) {
          setWanderFace(arrival);
          return;
        }
        // 오늘 알아야 할 게 있으면 그것부터 말한다(빈말보다 쓸모가 먼저다).
        const nudge = buildAiBuddyNudge(nudgeInputRef.current, step);
        const line = nudge.kind === "invite" ? aiBuddyWanderLine(arrival) : nudge.line;
        setWanderFace(nudge.kind === "invite" ? arrival : nudge.face);
        if (!line) return;
        setWanderLine(line);
        if (lineTimerRef.current) clearTimeout(lineTimerRef.current);
        lineTimerRef.current = setTimeout(() => setWanderLine(null), AI_BUDDY_WANDER_LINE_MS);
      }, AI_BUDDY_WANDER_TRAVEL_MS);
    }, AI_BUDDY_WANDER_STEP_MS);
    return () => {
      clearInterval(timer);
      if (arrivalTimerRef.current) clearTimeout(arrivalTimerRef.current);
      if (lineTimerRef.current) clearTimeout(lineTimerRef.current);
    };
  }, []);

  // 홈 밖에서는 저장된 가장자리 위치만 지키고, 이전 화면의 배회·말풍선·주목 상태를 이어오지 않는다.
  useEffect(() => {
    if (presentation.canWander) return;
    setWanderRatio(null);
    setWanderFace(null);
    setWanderLine(null);
    setAttention(null);
    setVoiceHint(false);
  }, [presentation.canWander]);

  useEffect(() => {
    attentionStateRef.current = readAiBuddyAttentionState(attentionKey);
  }, [attentionKey]);

  /**
   * 스스로 아이를 부르는 순간(2026-08-19 TK 지시).
   * 구석의 작은 버튼은 그냥 지나치므로, 가끔 커졌다가 화면을 채우고 다시 작아진다.
   * 부모가 끄면(attentionAllowed=false) 이 타이머는 아무 일도 하지 않는다.
   */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const timer = setInterval(() => {
      if (attentionRef.current || launchingRef.current) return; // 이미 부르는 중
      const now = Date.now();
      const gate = {
        enabled: attentionAllowedRef.current,
        dragging: dragRef.current !== null,
        showingEmotion: emotionRef.current !== "idle" && emotionRef.current !== "sleepy",
        visible: typeof document === "undefined" ? true : !document.hidden,
        reducedMotion: prefersReducedMotion(),
        msSinceDrag: lastDragAtRef.current === null ? null : now - lastDragAtRef.current,
        msSinceMount: now - mountedAtRef.current,
        state: attentionStateRef.current,
        nowMs: now,
      };
      if (!shouldPlayAiBuddyAttention(gate)) return;
      const stage = aiBuddyAttentionStage(attentionStateRef.current.totalShown);
      const nudge = buildAiBuddyNudge(nudgeInputRef.current, attentionStateRef.current.totalShown);
      const next = markAiBuddyAttentionShown(attentionStateRef.current, now);
      attentionStateRef.current = next;
      writeAiBuddyAttentionState(attentionKey, next);
      setWanderLine(null);
      setAttention({ stage, nudge });
      if (attentionHideTimerRef.current) clearTimeout(attentionHideTimerRef.current);
      attentionHideTimerRef.current = setTimeout(
        () => setAttention(null),
        aiBuddyAttentionDurationMs(stage),
      );
    }, AI_BUDDY_ATTENTION_TICK_MS);
    return () => {
      clearInterval(timer);
      if (attentionHideTimerRef.current) clearTimeout(attentionHideTimerRef.current);
    };
  }, [attentionKey]);

  // 표정이 바뀌면 한 번 통통 튀어 변화를 알린다.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    setPop(true);
    const timer = setTimeout(() => setPop(false), 460);
    return () => clearTimeout(timer);
  }, [emotion]);

  useEffect(() => {
    if (emotion === "idle" || emotion === "sleepy") return;
    // 실제 대화 감정이 오면 혼자 놀던 표정·말풍선·부르기는 물러난다(대화가 우선이다).
    setWanderFace(null);
    setWanderLine(null);
    setVoiceHint(false);
    setAttention(null);
  }, [emotion]);

  /**
   * "꾹 누르면 바로 말할 수 있어" 안내(2026-08-19 TK 지시).
   * 버튼이 스스로 알려 주지 않으면 아이는 이 기능이 있는 줄 모른다.
   * 한 번 써 본 아이·이미 여러 번 들은 아이에게는 띄우지 않는다(판정은 transform 정본).
   */
  useEffect(() => {
    if (!presentation.canPrompt || chatTarget === null) {
      setVoiceHint(false);
      return;
    }
    const state = readAiBuddyVoiceHintState(voiceHintKey);
    voiceHintStateRef.current = state;
    if (!shouldShowAiBuddyVoiceHint(state, Date.now())) return;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const showTimer = setTimeout(() => {
      // 화면이 안 보이는 동안 띄우면 아무도 못 보고 횟수만 깎인다.
      if (typeof document !== "undefined" && document.hidden) return;
      setVoiceHint(true);
      const shown = markAiBuddyVoiceHintShown(voiceHintStateRef.current, Date.now());
      voiceHintStateRef.current = shown;
      writeAiBuddyVoiceHintState(voiceHintKey, shown);
      hideTimer = setTimeout(() => setVoiceHint(false), AI_BUDDY_VOICE_HINT_MS);
    }, AI_BUDDY_VOICE_HINT_DELAY_MS);
    return () => {
      clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [chatTarget, presentation.canPrompt, voiceHintKey]);

  // 화면을 떠나면 대기 중인 꾹 누르기·전환 타이머도 함께 정리한다.
  useEffect(() => () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    if (launchTimerRef.current) clearTimeout(launchTimerRef.current);
  }, []);

  /**
   * 대화 화면으로 자연스럽게 넘어간다(2026-08-19 TK 제보 "흐름이 끊어져 보여요").
   * 곧바로 이동하지 않고 버튼이 커지며 화면 가운데로 온 다음 넘어가면,
   * 대화 화면이 같은 크기·자리에서 이어받아 한 동작으로 읽힌다.
   */
  const openChat = (startVoice = false) => {
    if (launchingRef.current) return;
    if (friendSettings.data?.ai_enabled === false) {
      show(intl.formatMessage({ id: "child.home.aiDisabled" }));
      return;
    }
    if (!chatTarget) {
      if (friendSettings.isError) {
        show(intl.formatMessage({ id: "child.aiSetup.loadError.title" }));
        if (!friendSettings.isFetching) void friendSettings.refetch();
      }
      return;
    }
    // 이름을 아직 안 정했으면 대화창 대신 친구 만들기부터. 빈 대화창을 열지 않는다.
    const configured = chatTarget === "/child/ai-friend";
    // 길게 누른 건 "말로 하고 싶다"는 뜻이다 — 대화창이 뜨자마자 마이크를 켠다.
    const state = { startVoice: configured && startVoice, buddyLaunch: true };
    const delay = aiBuddyLaunchDelayMs(prefersReducedMotion());
    if (delay <= 0) {
      navigate(chatTarget, { state });
      return;
    }
    setAttention(null);
    setWanderLine(null);
    setVoiceHint(false);
    setLaunching(true);
    launchingRef.current = true;
    // 버튼을 화면 가운데로 보낸다 — 대화 화면이 같은 크기·자리에서 이어받는다.
    const host = hostRef.current;
    if (host) {
      const frame = measureFrame();
      host.style.left = `${Math.round((frame.width - AI_BUDDY_HANDOFF_FACE_PX) / 2)}px`;
      host.style.top = `${Math.round((frame.height - AI_BUDDY_HANDOFF_FACE_PX) / 2)}px`;
    }
    if (launchTimerRef.current) clearTimeout(launchTimerRef.current);
    launchTimerRef.current = setTimeout(() => {
      launchTimerRef.current = null;
      navigate(chatTarget, { state });
    }, delay);
  };

  /**
   * 꾹 누르기 = 바로 말하기. 손을 떼기 전에 발동하므로 여기서 대화창을 연다.
   * 아이가 한 번이라도 써 봤으면 안내 말풍선은 더 띄우지 않는다(아는 걸 계속 알리지 않는다).
   */
  const fireVoiceLongPress = () => {
    longPressFiredRef.current = true;
    setVoiceHint(false);
    setWanderLine(null);
    const next = markAiBuddyVoiceHintUsed(voiceHintStateRef.current);
    voiceHintStateRef.current = next;
    writeAiBuddyVoiceHintState(voiceHintKey, next);
    openChat(true);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current === null) return;
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  // 화면을 채우고 부를 때의 큰 얼굴도 같은 조작이다 — 누르면 대화, 꾹 누르면 바로 말하기.
  const bindStageLongPress = useLongPress<void>(
    () => fireVoiceLongPress(),
    { delayMs: AI_BUDDY_VOICE_LONG_PRESS_MS },
  );
  const openChatRef = useRef(openChat);
  openChatRef.current = openChat;
  const stagePress = useMemo(
    () => bindStageLongPress(undefined, () => openChatRef.current(false)),
    [bindStageLongPress],
  );

  const dismissAttention = () => {
    if (attentionHideTimerRef.current) clearTimeout(attentionHideTimerRef.current);
    setAttention(null);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const host = hostRef.current;
    if (!host || dragRef.current || launching) return;
    const rect = host.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: Date.now(),
      moved: false,
      frame: measureFrame(),
    };
    host.setPointerCapture(event.pointerId);
    setDragging(true);
    setTapped(true);
    setWanderLine(null);
    // 꾹 누르고 있으면 손을 떼기 전에 마이크가 켜진 대화창이 열린다.
    longPressFiredRef.current = false;
    cancelLongPress();
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      if (dragRef.current === null || dragRef.current.moved) return;
      fireVoiceLongPress();
    }, AI_BUDDY_VOICE_LONG_PRESS_MS);
    // 누르는 순간 대화 화면을 미리 받아 둔다 — 손을 뗐을 때 빈 화면이 스치지 않게.
    preloadRoute("/child/ai-friend");
    preloadRoute("/child/ai-friend-setup");
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const host = hostRef.current;
    if (!drag || !host || drag.pointerId !== event.pointerId) return;
    const parent = host.offsetParent as HTMLElement | null;
    const parentRect = parent?.getBoundingClientRect();
    const originX = parentRect?.left ?? 0;
    const originY = parentRect?.top ?? 0;
    const next = aiBuddyFabRatioFromOffset(
      {
        left: event.clientX - originX - drag.grabX,
        top: event.clientY - originY - drag.grabY,
      },
      drag.frame,
    );
    if (!isAiBuddyFabTap(event.clientX - drag.startX, event.clientY - drag.startY, Date.now() - drag.startedAt)) {
      drag.moved = true;
      // 옮기는 중이면 말하기가 아니다 — 자리를 바꾸다 마이크가 켜지면 놀란다.
      cancelLongPress();
    }
    // 전환이 시작된 뒤에는 손가락을 따라가지 않는다(가운데로 가던 동작이 튄다).
    if (launchingRef.current) return;
    applyOffset(next);
    ratioRef.current = next;
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const host = hostRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    cancelLongPress();
    setDragging(false);
    if (host?.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);

    // 이미 꾹 누르기로 말하기가 시작됐으면 손을 뗀 것으로 대화창을 또 열지 않는다.
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      setTapped(false);
      return;
    }

    if (!drag.moved) {
      // 옮기지 않았으면 열기. 손가락이 살짝 흔들린 만큼을 먼저 되돌려 두고(움직임 줄이기에서는
      // 전환 연출이 없으므로 이 자리가 그대로 남는다) 전환이 그 자리에서 가운데로 데려간다.
      applyOffset(wanderRatioRef.current ?? ratioRef.current);
      setTapped(false);
      openChat();
      return;
    }
    lastDragAtRef.current = Date.now();
    setTapped(false);
    setWanderRatio(null);
    setWanderFace(null);
    const snapped = snapAiBuddyFabRatio(ratioRef.current);
    setRatio(snapped);
    applyOffset(snapped);
    writeStoredRatio(storageKey, snapped);
  };

  const attentionFace = attention?.nudge.face ?? null;
  const face: AiBuddyChatFace = tapped
    ? AI_BUDDY_TAP_FACE
    : emotion !== "idle" && emotion !== "sleepy"
      ? aiBuddyFaceFor(emotion)
      : attentionFace
        ? attentionFace
        : wanderFace
          ? wanderFace
          : blinking && !dragging
            ? AI_BUDDY_BLINK_FACE
            : aiBuddyFaceFor(emotion);
  // 안내와 지금 알아야 할 말을 먼저 보여 주고, 조용할 때는 탭해서 대화하는 법을 늘 알려 준다.
  const bubbleLine = resolveAiBuddyFabBubbleLine({
    canPrompt: presentation.canPrompt && chatTarget !== null,
    voiceHint,
    attentionStage: attention?.stage ?? null,
    attentionLine: attention?.nudge.line ?? null,
    wanderLine,
    friendName,
  });
  const guidanceBubble = voiceHint || bubbleLine === aiBuddyHomeChatHintLine(friendName);
  const label = `${friendName}와 이야기하기 · ${aiBuddyEmotionLabel(emotion)} · 길게 누르면 바로 말하기`;

  return (
    <>
      {/* 화면을 채우고 부르는 순간. 바깥을 누르면 닫히고, 얼굴을 누르면 대화가 열린다. */}
      {presentation.canPrompt && attention?.stage === "full" && !launching ? (
        <div className="abf-stage">
          {/* 스스로 3~4초 뒤 물러나는 알림이라 focus 를 가두지 않는다(대화 중이던 아이를 막지 않는다). */}
          <button
            type="button"
            className="abf-stage__scrim"
            aria-label={intl.formatMessage({ id: "core.aiBuddy.stage.dismiss" })}
            tabIndex={-1}
            onClick={dismissAttention}
          />
          <div className="abf-stage__card">
            <button
              type="button"
              className="abf-stage__face hy-press"
              aria-label={`${attention.nudge.fullLine} · 눌러서 이야기하기 · 길게 누르면 바로 말하기`}
              onPointerDown={stagePress.onPointerDown}
              onPointerMove={stagePress.onPointerMove}
              onPointerUp={stagePress.onPointerUp}
              onPointerCancel={stagePress.onPointerCancel}
              onPointerLeave={stagePress.onPointerLeave}
              onContextMenu={stagePress.onContextMenu}
              onClick={stagePress.onClick}
            >
              <img
                src={asset(aiBuddyChatFaceAsset(attention.nudge.face))}
                alt=""
                width={AI_BUDDY_HANDOFF_FACE_PX}
                height={AI_BUDDY_HANDOFF_FACE_PX}
                decoding="async"
              />
            </button>
            <div className="abf-stage__bubble">
              <p className="abf-stage__line">{attention.nudge.line}</p>
            </div>
          </div>
        </div>
      ) : null}

      {/* 대화 화면으로 넘어가는 동안 배경을 덮어 두 화면을 한 동작으로 이어 붙인다. */}
      {launching ? <div className="abf-launch-scrim" aria-hidden="true" /> : null}

      <button
        ref={hostRef}
        type="button"
        className={aiBuddyFabModeClassName("abf", presentation.mode)}
        data-dragging={dragging ? "true" : "false"}
        data-pop={pop ? "true" : "false"}
        data-emotion={emotion}
        data-attention={attention?.stage ?? "none"}
        data-launching={launching ? "true" : "false"}
        data-edge={liveRatio.xRatio >= 0.5 ? "right" : "left"}
        aria-label={label}
        title={friendName}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* 말풍선은 버튼 라벨에 이미 담긴 안내라 스크린리더에는 중복으로 읽히지 않게 둔다. */}
        {bubbleLine ? (
          <span
            className={guidanceBubble ? "abf__bubble abf__bubble--hint" : "abf__bubble"}
            aria-hidden="true"
          >
            {bubbleLine}
          </span>
        ) : null}
        <span className={aiBuddyFabFaceClassName("abf__face", face)}>
          <span className="abf__stack">
            {/* 표정 전환이 끊겨 보이지 않도록 전체 프레임을 겹쳐 두고 투명도로 바꾼다. */}
            {AI_BUDDY_CHAT_FACES.map((name) => (
              <img
                key={name}
                src={asset(aiBuddyChatFaceAsset(name))}
                alt=""
                width={presentation.size}
                height={presentation.size}
                decoding="async"
                data-shown={face === name ? "true" : "false"}
              />
            ))}
          </span>
        </span>
        <span className="abf__ground-shadow" aria-hidden="true" />
      </button>
    </>
  );
}
