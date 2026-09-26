import type { CSSProperties } from "react";
import { useIntl } from "react-intl";
import { asset } from "@/lib/assets";
import type { StickerCelebrationDetail } from "./StickerCelebration";
import "./StickerCelebration.css";

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

function stickerImage(emoji?: string): string {
  return asset(STICKER_BY_EMOJI[emoji ?? ""] ?? "sticker/best.webp");
}

/**
 * 스티커 도착 축하 화면. 아이가 스티커를 받을 때만 보이므로 진입 번들에서 떼어
 * StickerCelebrationHost 가 지연 로드한다(부모·선생님은 이 CSS 를 받지 않는다).
 */
export function StickerCelebrationView({
  detail,
  title,
  onClose,
}: {
  detail: StickerCelebrationDetail;
  title: string;
  onClose: () => void;
}) {
  const intl = useIntl();
  return (
    <button
      type="button"
      className="sticker-celebration"
      aria-label={intl.formatMessage({ id: "shared.sticker.receivedLabel" }, { title })}
      onClick={onClose}
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
        <span className="sticker-celebration__sub">
          {intl.formatMessage({
            id: detail.stickerType === "early" || detail.stickerType === "on_time"
              ? "shared.sticker.earnedAutomatically"
              : "shared.sticker.sentByParent",
          })}
        </span>
      </span>
      <span className="sticker-celebration__stars" aria-hidden="true">
        <span>★</span>
        <span>✦</span>
        <span>★</span>
      </span>
    </button>
  );
}
