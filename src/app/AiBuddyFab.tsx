import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthContext";
import { asset } from "@/lib/assets";
import { useAiFriendPublicSettings } from "@/queries/useAi";
import { useAiBuddyMood } from "./aiBuddyMood";
import {
  AI_BUDDY_BLINK_DURATION_MS,
  AI_BUDDY_BLINK_FACE,
  AI_BUDDY_BLINK_INTERVAL_MS,
  AI_BUDDY_CHAT_FACES,
  AI_BUDDY_TAP_FACE,
  aiBuddyEmotionLabel,
  aiBuddyFaceAsset,
  aiBuddyFaceFor,
  type AiBuddyChatFace,
} from "@/transform/aiBuddyEmotion";
import {
  AI_BUDDY_WANDER_LINE_MS,
  AI_BUDDY_WANDER_STEP_MS,
  aiBuddyWanderFace,
  aiBuddyWanderLine,
  canAiBuddyWander,
  nextAiBuddyWanderRatio,
  shouldShowAiBuddyWanderLine,
} from "@/transform/aiBuddyWander";
import {
  aiBuddyFabOffset,
  aiBuddyFabRatioFromOffset,
  aiBuddyFabStorageKey,
  AI_BUDDY_FAB_SIZE,
  DEFAULT_AI_BUDDY_FAB_RATIO,
  isAiBuddyFabTap,
  normalizeAiBuddyFabRatio,
  snapAiBuddyFabRatio,
  type AiBuddyFabFrame,
  type AiBuddyFabRatio,
} from "@/transform/aiBuddyFabPosition";
import "./AiBuddyFab.css";

/** 상단 상태바·화면 헤더가 가리는 높이. 이 아래로만 버튼을 놓는다. */
const TOP_INSET = 64;

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

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
 * · 아이 세션에서만, AI 친구 화면 밖에서만 렌더한다.
 */
export function AiBuddyFab({ bottomInset }: AiBuddyFabProps) {
  const { role } = useAuth();
  const location = useLocation();
  if (role !== "child" || HIDDEN_PATHS.has(location.pathname)) return null;
  return <AiBuddyFabButton bottomInset={bottomInset} />;
}

function AiBuddyFabButton({ bottomInset }: AiBuddyFabProps) {
  const navigate = useNavigate();
  const { familyId, userId } = useAuth();
  const { emotion } = useAiBuddyMood();
  const friendSettings = useAiFriendPublicSettings(userId);

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
      bottomInset,
    };
  }, [bottomInset]);

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
    applyOffset(liveRatio);
  }, [applyOffset, liveRatio]);

  // 회전·키보드 등으로 프레임 크기가 바뀌면 비율은 그대로 두고 위치만 다시 계산한다.
  useEffect(() => {
    const parent = hostRef.current?.offsetParent as HTMLElement | null;
    if (!parent || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => applyOffset(ratioRef.current));
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
      const gate = {
        dragging: dragRef.current !== null,
        showingEmotion: emotionRef.current !== "idle" && emotionRef.current !== "sleepy",
        visible: typeof document === "undefined" ? true : !document.hidden,
        reducedMotion: prefersReducedMotion(),
        msSinceDrag: lastDragAtRef.current === null ? null : Date.now() - lastDragAtRef.current,
      };
      if (!canAiBuddyWander(gate)) return;
      const step = wanderStepRef.current + 1;
      wanderStepRef.current = step;
      const from = wanderRatioRef.current ?? ratioRef.current;
      const next = nextAiBuddyWanderRatio(from, step);
      setWanderRatio(next);
      setWanderFace(aiBuddyWanderFace(step, true));
      // 도착하면 아이에게 말을 걸 듯한 얼굴로 바꾼다(이동 중은 두리번거리는 얼굴).
      arrivalTimerRef.current = setTimeout(() => {
        const arrival = aiBuddyWanderFace(step, false);
        setWanderFace(arrival);
        // 몇 걸음에 한 번만 짧게 말을 건다 — 매번 띄우면 화면을 가리고 잔소리가 된다.
        const line = shouldShowAiBuddyWanderLine(step) ? aiBuddyWanderLine(arrival) : null;
        if (!line) return;
        setWanderLine(line);
        if (lineTimerRef.current) clearTimeout(lineTimerRef.current);
        lineTimerRef.current = setTimeout(() => setWanderLine(null), AI_BUDDY_WANDER_LINE_MS);
      }, 1_500);
    }, AI_BUDDY_WANDER_STEP_MS);
    return () => {
      clearInterval(timer);
      if (arrivalTimerRef.current) clearTimeout(arrivalTimerRef.current);
      if (lineTimerRef.current) clearTimeout(lineTimerRef.current);
    };
  }, []);

  // 표정이 바뀌면 한 번 통통 튀어 변화를 알린다.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    setPop(true);
    const timer = setTimeout(() => setPop(false), 460);
    return () => clearTimeout(timer);
  }, [emotion]);

  useEffect(() => {
    if (emotion === "idle" || emotion === "sleepy") return;
    // 실제 대화 감정이 오면 혼자 놀던 표정·말풍선은 물러난다(대화가 우선이다).
    setWanderFace(null);
    setWanderLine(null);
  }, [emotion]);

  const openChat = () => {
    // 이름을 아직 안 정했으면 대화창 대신 친구 만들기부터. 빈 대화창을 열지 않는다.
    const configured = !!friendSettings.data?.ai_friend_name;
    navigate(configured ? "/child/ai-friend" : "/child/ai-friend-setup");
  };

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const host = hostRef.current;
    if (!host || dragRef.current) return;
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
    }
    applyOffset(next);
    ratioRef.current = next;
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const host = hostRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (host?.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);

    if (!drag.moved) {
      // 옮기지 않았으면 열기. 위치는 지금 있던 자리로 되돌린다.
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

  const face: AiBuddyChatFace = tapped
    ? AI_BUDDY_TAP_FACE
    : emotion !== "idle" && emotion !== "sleepy"
      ? aiBuddyFaceFor(emotion)
      : wanderFace
        ? wanderFace
        : blinking && !dragging
          ? AI_BUDDY_BLINK_FACE
          : aiBuddyFaceFor(emotion);
  const label = `AI 친구와 이야기하기 · ${aiBuddyEmotionLabel(emotion)}`;

  return (
    <button
      ref={hostRef}
      type="button"
      className="abf"
      data-dragging={dragging ? "true" : "false"}
      data-pop={pop ? "true" : "false"}
      data-emotion={emotion}
      data-edge={liveRatio.xRatio >= 0.5 ? "right" : "left"}
      aria-label={label}
      title="AI 친구"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* 말풍선은 버튼 라벨에 이미 담긴 안내라 스크린리더에는 중복으로 읽히지 않게 둔다. */}
      {wanderLine ? (
        <span className="abf__bubble" aria-hidden="true">{wanderLine}</span>
      ) : null}
      <span className="abf__face">
        <span className="abf__stack">
          {/* 표정 전환이 끊겨 보이지 않도록 전체 프레임을 겹쳐 두고 투명도로 바꾼다. */}
          {AI_BUDDY_CHAT_FACES.map((name) => (
            <img
              key={name}
              src={asset(aiBuddyFaceAsset(name))}
              alt=""
              width={AI_BUDDY_FAB_SIZE}
              height={AI_BUDDY_FAB_SIZE}
              decoding="async"
              data-shown={face === name ? "true" : "false"}
            />
          ))}
        </span>
      </span>
    </button>
  );
}
