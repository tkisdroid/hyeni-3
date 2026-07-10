import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { asset } from "@/lib/assets";
import { childAvatarPath } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { useMyFamily } from "@/queries/useFamily";
import { useActiveChild } from "@/app/activeChild";
import { useSendSticker, useStickerSummary } from "@/queries/useStickers";
import { todayDateKey } from "@/transform/dateKey";
import "./StickerSend.css";

type Sticker = { id: string; img: string; label: string; emoji: string };

/** 상황별 칭찬 스티커 목록(assets/sticker/*.webp). emoji 는 전송 payload 용. */
const STICKERS: ReadonlyArray<Sticker> = [
  { id: "best", img: "sticker/best.webp", label: "최고예요", emoji: "🏆" },
  { id: "love", img: "sticker/love.webp", label: "사랑해요", emoji: "💗" },
  { id: "cool", img: "sticker/cool.webp", label: "멋져요", emoji: "😎" },
  { id: "brave", img: "sticker/brave.webp", label: "용감해요", emoji: "🙌" },
  { id: "study", img: "sticker/study.webp", label: "공부왕", emoji: "📚" },
  { id: "self", img: "sticker/self.webp", label: "스스로", emoji: "👍" },
  { id: "ready", img: "sticker/ready.webp", label: "준비완료", emoji: "✅" },
  { id: "early", img: "sticker/early.webp", label: "일찍왔어", emoji: "🌟" },
  { id: "friend", img: "sticker/friend.webp", label: "사이좋게", emoji: "💛" },
  { id: "play", img: "sticker/play.webp", label: "신나게", emoji: "🧸" },
  { id: "sports", img: "sticker/sports.webp", label: "운동왕", emoji: "🎾" },
  { id: "rest", img: "sticker/rest.webp", label: "푹쉬어요", emoji: "🌙" },
];

/** photo_url(원격 http)은 그대로, 로컬 캐릭터 키는 asset()으로 해석. */
function avatarSrc(path: string): string {
  return path.startsWith("http") ? path : asset(path);
}

/** 부모: 상황별 칭찬 스티커 + 한마디를 골라 아이에게 전송(다자녀 시 대상 선택). */
export function StickerSend() {
  const navigate = useNavigate();
  const { show } = useToast();
  const { data: family } = useMyFamily();
  const { data: summary } = useStickerSummary();
  const sendSticker = useSendSticker();

  const [pickedId, setPickedId] = useState<string>(STICKERS[0].id);
  const [message, setMessage] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const picked = STICKERS.find((s) => s.id === pickedId) ?? STICKERS[0];

  // 연동된(user_id 보유) 자녀 목록. 2명 이상이면 대상 선택 UI 노출.
  const children = useMemo(
    () => (family?.members ?? []).filter((m) => m.role === "child" && !!m.user_id),
    [family],
  );
  // 대상 자녀 = 사용자가 고른 자녀 > 전역 활성 아이(홈 스위치) > 첫 자녀(기본 선택값).
  const { activeChild } = useActiveChild();
  const targetChild = useMemo(
    () =>
      children.find((c) => c.user_id === selectedUserId) ??
      children.find((c) => c.id === activeChild?.id) ??
      children[0] ??
      null,
    [children, selectedUserId, activeChild],
  );
  const childName = targetChild?.name || "우리 아이";

  // 받은 칭찬 누적(스티커 집계) — 미리보기 카드 실데이터.
  const receivedCount = useMemo(() => {
    const row = summary?.find((s) => s.user_id === targetChild?.user_id);
    return row?.total_count ?? 0;
  }, [summary, targetChild]);

  // 전송은 사용자가 버튼을 눌러야만 실행(자동 실행 금지).
  const handleSend = () => {
    if (!targetChild?.user_id) {
      show("아이와 연결되면 스티커를 보낼 수 있어요", "👶");
      return;
    }
    if (sendSticker.isPending) return;
    const note = message.trim();
    sendSticker.mutate(
      {
        user_id: targetChild.user_id,
        event_id: `praise-${Date.now()}`,
        date_key: todayDateKey(),
        sticker_type: "praise",
        emoji: picked.emoji,
        // 스티커 전용 메시지 필드가 없어 한마디를 title 로 실제 전송(없으면 스티커 라벨).
        title: note || picked.label,
      },
      {
        onSuccess: () => {
          show(`${childName}에게 '${picked.label}' 스티커를 보냈어요`, "💌");
          setMessage("");
        },
        onError: () => show("스티커를 보내지 못했어요", "⚠️"),
      },
    );
  };

  return (
    <div className="ss-wrap">
      <header className="ss-header">
        <button
          type="button"
          className="ss-back hy-press"
          aria-label="뒤로"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="ss-title">칭찬 스티커 보내기</span>
      </header>

      <div className="ss-body">
        {/* 대상 자녀 선택(다자녀 시) */}
        {children.length > 1 && (
          <div className="ss-children">
            {children.map((c) => (
              <button
                key={c.id}
                type="button"
                className="ss-child hy-press"
                data-active={c.user_id === targetChild?.user_id}
                onClick={() => setSelectedUserId(c.user_id)}
              >
                <span className="ss-child__avatar">
                  <img src={avatarSrc(childAvatarPath(c.photo_url))} alt="" />
                </span>
                <span className="ss-child__name">{c.name || "아이"}</span>
              </button>
            ))}
          </div>
        )}

        {/* 미리보기 카드 */}
        <div className="hy-card ss-preview">
          <div className="ss-preview__eyebrow">{childName}에게 보낼 스티커</div>
          <div className="ss-preview__tile" key={picked.id}>
            <img src={asset(picked.img)} alt="" />
          </div>
          <div className="ss-preview__label">{picked.label}</div>
          <div className="ss-preview__count">받은 칭찬 {receivedCount}개</div>
        </div>

        {/* 상황별 선택 그리드 */}
        <div>
          <div className="ss-pick-title">상황에 맞게 골라요</div>
          <div className="hy-card ss-grid">
            {STICKERS.map((s) => (
              <button
                key={s.id}
                type="button"
                className="ss-chip hy-press"
                data-active={s.id === pickedId}
                onClick={() => setPickedId(s.id)}
              >
                <img className="ss-chip__img" src={asset(s.img)} alt="" />
                <span className="ss-chip__label">{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 한마디 (선택) */}
        <div>
          <div className="ss-pick-title">한마디 (선택)</div>
          <textarea
            className="ss-msg"
            placeholder="예) 숙제 스스로 끝냈어! 최고 👏"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={60}
            rows={2}
          />
        </div>

        {/* 보내기 버튼 */}
        <button
          type="button"
          className="ss-send hy-press"
          onClick={handleSend}
          disabled={sendSticker.isPending}
        >
          <img src={asset("ui/chat-heart.webp")} alt="" />
          {sendSticker.isPending ? "보내는 중…" : `${childName}에게 보내기`}
        </button>
      </div>
    </div>
  );
}
