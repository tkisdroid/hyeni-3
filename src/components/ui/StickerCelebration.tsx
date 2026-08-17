import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useAuth } from "@/auth/AuthContext";
import { asset } from "@/lib/assets";
import { useReceivedStickers } from "@/queries/useStickers";
import type { ReceivedSticker } from "@/lib/api/endpoints/stickers";
import "./StickerCelebration.css";
import { useIntl } from "react-intl";

export interface StickerCelebrationDetail {
  id?: string;
  emoji?: string;
  title?: string;
}

declare global {
  interface WindowEventMap {
    "hy:sticker-celebration": CustomEvent<StickerCelebrationDetail>;
  }
}

const STICKER_BY_EMOJI: Record<string, string> = {
  "🏆": "sticker/best.webp",
  "💗": "sticker/love.webp",
  "😎": "sticker/cool.webp",
  "🙌": "sticker/brave.webp",
  "📚": "sticker/study.webp",
  "👍": "sticker/self.webp",
  "✅": "sticker/ready.webp",
  "🌟": "sticker/early.webp",
  "💛": "sticker/friend.webp",
  "🧸": "sticker/play.webp",
  "🎾": "sticker/sports.webp",
  "🌙": "sticker/rest.webp",
  "⭐": "sticker/best.webp",
};
const CELEBRATION_MS = 4200;
const RECENT_STICKER_MS = 12 * 60 * 60 * 1000;

function storageKey(userId: string): string {
  return `hy_last_celebrated_sticker_${userId}`;
}

function stickerImage(emoji?: string): string {
  return asset(STICKER_BY_EMOJI[emoji ?? ""] ?? "sticker/best.webp");
}

function stickerTitle(title: string | undefined, fallback: string): string {
  const text = String(title ?? "").trim();
  return text || fallback;
}

function isRecentSticker(sticker: ReceivedSticker): boolean {
  const time = new Date(sticker.earned_at).getTime();
  return Number.isFinite(time) && Date.now() - time <= RECENT_STICKER_MS;
}

export function StickerCelebrationHost() {
  const { role, userId } = useAuth();
  const intl = useIntl();
  const received = useReceivedStickers(role === "child" ? userId : null);
  const [detail, setDetail] = useState<(StickerCelebrationDetail & { key: number }) | null>(null);
  const timer = useRef<number | null>(null);
  const seenIds = useRef<Set<string>>(new Set());

  const openCelebration = useCallback((next: StickerCelebrationDetail) => {
    if (next.id) {
      if (seenIds.current.has(next.id)) return;
      seenIds.current.add(next.id);
      if (userId) {
        try {
          window.localStorage.setItem(storageKey(userId), next.id);
        } catch {
          // 저장소 접근 불가 환경에서는 세션 중복 방지만 적용한다.
        }
      }
    }
    if (timer.current) window.clearTimeout(timer.current);
    setDetail({ ...next, key: Date.now() });
    timer.current = window.setTimeout(() => setDetail(null), CELEBRATION_MS);
  }, [userId]);

  useEffect(() => {
    const onCelebrate = (event: WindowEventMap["hy:sticker-celebration"]) => {
      openCelebration(event.detail ?? {});
    };
    window.addEventListener("hy:sticker-celebration", onCelebrate);
    return () => {
      window.removeEventListener("hy:sticker-celebration", onCelebrate);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [openCelebration]);

  useEffect(() => {
    if (role !== "child" || !userId) return;
    const latest = (received.data ?? []).find((sticker) => sticker.sticker_type === "praise");
    if (!latest?.id || !isRecentSticker(latest)) return;
    try {
      if (window.localStorage.getItem(storageKey(userId)) === latest.id) return;
    } catch {
      // 저장소 접근 불가 환경에서는 세션 중복 방지만 적용한다.
    }
    openCelebration({ id: latest.id, emoji: latest.emoji, title: latest.title });
  }, [openCelebration, received.data, role, userId]);

  if (!detail) return null;

  const title = stickerTitle(detail.title, intl.formatMessage({ id: "shared.sticker.defaultTitle" }));
  return (
    <button
      key={detail.key}
      type="button"
      className="sticker-celebration"
      aria-label={intl.formatMessage({ id: "shared.sticker.receivedLabel" }, { title })}
      onClick={() => setDetail(null)}
    >
      <span className="sticker-celebration__flash" />
      <span className="sticker-celebration__confetti" aria-hidden="true">
        {Array.from({ length: 28 }, (_, i) => (
          <span key={i} style={{ "--i": i } as CSSProperties} />
        ))}
      </span>
      <span className="sticker-celebration__main">
        <span className="sticker-celebration__eyebrow">{intl.formatMessage({ id: "shared.sticker.arrived" })}</span>
        <img className="sticker-celebration__sticker" src={stickerImage(detail.emoji)} alt="" />
        <span className="sticker-celebration__title">{title}</span>
        <span className="sticker-celebration__sub">{intl.formatMessage({ id: "shared.sticker.sentByParent" })}</span>
      </span>
      <span className="sticker-celebration__stars" aria-hidden="true">
        <span>★</span>
        <span>✦</span>
        <span>★</span>
      </span>
    </button>
  );
}
