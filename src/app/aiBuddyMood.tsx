import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AI_BUDDY_EMOTION_HOLD_MS,
  aiBuddyIdleEmotion,
  resolveAiBuddyEmotion,
  type AiBuddyEmotion,
  type AiBuddyEmotionInput,
} from "@/transform/aiBuddyEmotion";

/**
 * AI 친구의 지금 표정을 앱 전체가 공유한다.
 *
 * 대화 화면(PushShell)과 플로팅 버튼(ChildShell)은 서로 다른 셸에 있어서, 라우터 위에서
 * 한 번만 들고 있어야 "대화하고 홈으로 돌아왔는데 버튼이 아직 웃고 있는" 연결감이 생긴다.
 * 라우트 이동으로 컴포넌트가 언마운트돼도 표정이 초기화되지 않는 게 목적이다.
 */
interface AiBuddyMoodValue {
  emotion: AiBuddyEmotion;
  /** 대화 상황을 넘기면 표정을 정하고 일정 시간 뒤 대기 얼굴로 돌아간다. */
  reactTo: (input: AiBuddyEmotionInput) => void;
  /** 표정을 즉시 대기 상태로 되돌린다(대화 종료·로그아웃). */
  resetMood: () => void;
}

const AiBuddyMoodContext = createContext<AiBuddyMoodValue | null>(null);

/** KST 기준 시(0~23). 밤에는 대기 얼굴이 졸린 표정이 된다. */
function currentKstHour(): number {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours();
}

export function AiBuddyMoodProvider({ children }: { children: React.ReactNode }) {
  const [emotion, setEmotion] = useState<AiBuddyEmotion>(() => aiBuddyIdleEmotion(currentKstHour()));
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHold = useCallback(() => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearHold, [clearHold]);

  const resetMood = useCallback(() => {
    clearHold();
    setEmotion(aiBuddyIdleEmotion(currentKstHour()));
  }, [clearHold]);

  const reactTo = useCallback(
    (input: AiBuddyEmotionInput) => {
      const next = resolveAiBuddyEmotion({ hourOfDay: currentKstHour(), ...input });
      clearHold();
      setEmotion(next);
      // 생각 중은 답이 올 때까지 유지한다(타이머로 지우면 대기 중인데 웃는 얼굴이 된다).
      if (input.phase === "thinking") return;
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        setEmotion(aiBuddyIdleEmotion(currentKstHour()));
      }, AI_BUDDY_EMOTION_HOLD_MS);
    },
    [clearHold],
  );

  const value = useMemo<AiBuddyMoodValue>(
    () => ({ emotion, reactTo, resetMood }),
    [emotion, reactTo, resetMood],
  );

  return <AiBuddyMoodContext.Provider value={value}>{children}</AiBuddyMoodContext.Provider>;
}

/** Provider 밖에서도 화면이 죽지 않도록 대기 표정으로 강등한다. */
export function useAiBuddyMood(): AiBuddyMoodValue {
  const ctx = useContext(AiBuddyMoodContext);
  if (ctx) return ctx;
  return {
    emotion: aiBuddyIdleEmotion(currentKstHour()),
    reactTo: () => {},
    resetMood: () => {},
  };
}
