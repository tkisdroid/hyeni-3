import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useAiCreditPublicStatus, useAiFriendPublicSettings } from "@/queries/useAi";
import { useMyFamily } from "@/queries/useFamily";
import { resolveAiFriendDisplayName } from "@/transform/aiFriendName";
import {
  childAiEmotionAsset,
  inferChildAiEmotion,
  readStoredChildAiEmotion,
  type ChildAiEmotion,
} from "@/transform/childAiEmotion";
import "./ChildAiFab.css";

const HIDDEN_PREFIXES = [
  "/child/sos",
  "/child/ai-friend",
  "/child/ai-friend-setup",
  "/onboarding",
];

function routePath(pathname: string): string {
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

export function ChildAiFab() {
  const navigate = useNavigate();
  const location = useLocation();
  const { show } = useToast();
  const { role, userId, familyId } = useAuth();
  const { data: family } = useMyFamily();
  const { data: publicSettings } = useAiFriendPublicSettings(role === "child" ? userId : null);
  const creditStatus = useAiCreditPublicStatus(role === "child" ? userId : null);
  const [emotion, setEmotion] = useState<ChildAiEmotion>("idle");

  const childName = userId
    ? family?.members.find((member) => member.role === "child" && member.user_id === userId)?.name ?? ""
    : "";
  const friendName = resolveAiFriendDisplayName({
    savedName: publicSettings?.ai_friend_name,
    childName,
    fallbackName: "AI 친구",
  });
  const remaining = creditStatus.data?.availableRemaining ?? null;
  const path = routePath(location.pathname);
  const hidden = HIDDEN_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

  useEffect(() => {
    if (typeof window === "undefined") return;
    setEmotion(readStoredChildAiEmotion(window.sessionStorage, familyId, userId));
  }, [familyId, userId, location.pathname]);

  useEffect(() => {
    if (hidden || emotion !== "idle") return;
    const timer = window.setInterval(() => {
      setEmotion((current) => (current === "pondering" ? "happy" : current === "happy" ? "idle" : "happy"));
    }, 4200);
    return () => window.clearInterval(timer);
  }, [hidden, emotion]);

  const src = useMemo(() => asset(childAiEmotionAsset(emotion)), [emotion]);
  if (role !== "child" || hidden) return null;

  const openFriend = () => {
    if (publicSettings?.ai_enabled === false) {
      setEmotion(inferChildAiEmotion({ intent: "parent_locked_setting" }));
      show("AI 친구는 부모님이 켜 줘야 해. 부탁해 봐! 🙏", "🤖");
      return;
    }
    if (!publicSettings?.ai_friend_name?.trim()) {
      navigate("/child/ai-friend-setup");
      return;
    }
    navigate("/child/ai-friend");
  };

  return (
    <button
      type="button"
      className="caf hy-press"
      data-emotion={emotion}
      aria-label={
        remaining != null
          ? `${friendName}랑 이야기하기, 오늘 ${remaining}번 남음`
          : `${friendName}랑 이야기하기`
      }
      onClick={openFriend}
    >
      <img src={src} alt="" />
      {remaining != null && remaining <= 2 && (
        <span className="caf-credit">{remaining}</span>
      )}
    </button>
  );
}
