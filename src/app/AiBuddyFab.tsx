import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthContext";
import { asset } from "@/lib/assets";
import { useAiFriendPublicSettings } from "@/queries/useAi";
import { useAiBuddyMood } from "./aiBuddyMood";
import {
  AI_BUDDY_BLINK_DURATION_MS,
  AI_BUDDY_BLINK_INTERVAL_MS,
  aiBuddyEmotionLabel,
  aiBuddyFaceAsset,
  AI_BUDDY_EMOTIONS,
} from "@/transform/aiBuddyEmotion";
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
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;

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
    applyOffset(ratio);
  }, [applyOffset, ratio]);

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

  // 표정이 바뀌면 한 번 통통 튀어 변화를 알린다.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    setPop(true);
    const timer = setTimeout(() => setPop(false), 460);
    return () => clearTimeout(timer);
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
      // 옮기지 않았으면 열기. 위치는 원래대로 되돌린다.
      applyOffset(ratioRef.current);
      openChat();
      return;
    }
    const snapped = snapAiBuddyFabRatio(ratioRef.current);
    setRatio(snapped);
    applyOffset(snapped);
    writeStoredRatio(storageKey, snapped);
  };

  const face = blinking && !dragging ? "blink" : emotion;
  const label = `AI 친구와 이야기하기 · ${aiBuddyEmotionLabel(emotion)}`;

  return (
    <button
      ref={hostRef}
      type="button"
      className="abf"
      data-dragging={dragging ? "true" : "false"}
      data-pop={pop ? "true" : "false"}
      data-emotion={emotion}
      aria-label={label}
      title="AI 친구"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <span className="abf__glow" aria-hidden="true" />
      <span className="abf__face">
        <span className="abf__stack">
          {/* 표정 전환이 끊겨 보이지 않도록 전체 프레임을 겹쳐 두고 투명도로 바꾼다. */}
          {AI_BUDDY_EMOTIONS.map((name) => (
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
          <img
            src={asset(aiBuddyFaceAsset("blink"))}
            alt=""
            width={AI_BUDDY_FAB_SIZE}
            height={AI_BUDDY_FAB_SIZE}
            decoding="async"
            data-shown={face === "blink" ? "true" : "false"}
          />
        </span>
      </span>
    </button>
  );
}
