import { useMemo } from "react";
import { asset } from "@/lib/assets";
import { useAuth } from "@/auth/AuthContext";
import { useStickerSummary, useReceivedStickers } from "@/queries/useStickers";
import type { ReceivedSticker } from "@/lib/api/endpoints/stickers";
import "./StickerBook.css";

/** 다음 선물까지 목표 개수(원본 시안: 12개 모음 + 3개 남음 = 15). */
const REWARD_TARGET = 15;

/** 칭찬 스티커 카탈로그 — 제목 → 3D 아이콘·표시명 매핑(StickerSend 라벨과 정렬). */
type CatalogEntry = { img: string; name: string; titles: readonly string[] };
const CATALOG: readonly CatalogEntry[] = [
  { img: "sticker/best.webp", name: "최고", titles: ["최고", "최고예요"] },
  { img: "sticker/love.webp", name: "사랑둥이", titles: ["사랑해요", "사랑해", "사랑둥이"] },
  { img: "sticker/cool.webp", name: "멋쟁이", titles: ["멋져요", "멋쟁이"] },
  { img: "sticker/brave.webp", name: "용감이", titles: ["용감해요", "용감이", "도전성공"] },
  { img: "sticker/study.webp", name: "공부왕", titles: ["공부왕", "숙제완료"] },
  { img: "sticker/self.webp", name: "스스로", titles: ["스스로", "스스로했어요"] },
  { img: "sticker/ready.webp", name: "준비왕", titles: ["준비완료", "준비왕"] },
  { img: "sticker/early.webp", name: "일찍왕", titles: ["일찍왔어", "일찍왕", "일찍도착", "정시도착"] },
  { img: "sticker/friend.webp", name: "친구사랑", titles: ["사이좋게", "친구사랑", "친구배려"] },
  { img: "sticker/play.webp", name: "신나게", titles: ["신나게", "놀이천재"] },
  { img: "sticker/sports.webp", name: "운동왕", titles: ["운동왕", "운동최고"] },
  { img: "sticker/rest.webp", name: "푹잘자", titles: ["푹쉬어요", "푹잘자", "마음충전"] },
];

const norm = (s: string): string => s.replace(/[!\s]/g, "");

/** 받은 스티커 → 표시용 {img?, name}. sticker_type(early/on_time) 우선, 그다음 title 매칭. */
function resolveSticker(s: ReceivedSticker): { img: string | null; name: string } {
  if (s.sticker_type === "early" || s.sticker_type === "on_time") {
    return { img: "sticker/early.webp", name: s.title || "일찍왕" };
  }
  const t = norm(s.title || "");
  const hit = CATALOG.find((c) => c.titles.some((k) => norm(k) === t));
  return { img: hit?.img ?? null, name: s.title || hit?.name || "칭찬" };
}

export function StickerBook() {
  const { userId } = useAuth();
  const summary = useStickerSummary();
  const received = useReceivedStickers(userId);

  // 리워드 카드 = 내 전체 스티커 집계(요약 API 는 전체 기간 total).
  const collected = useMemo(() => {
    const row = (summary.data ?? []).find((r) => r.user_id === userId);
    return row?.total_count ?? 0;
  }, [summary.data, userId]);

  const remaining = Math.max(REWARD_TARGET - collected, 0);
  const progress =
    REWARD_TARGET > 0 ? Math.min(100, Math.round((collected / REWARD_TARGET) * 100)) : 0;

  const list = received.data ?? [];
  const isLoading = received.isLoading || summary.isLoading;
  const isError = received.isError;

  return (
    <div className="hy-rise-in">
      <header className="sb-header">
        <span className="sb-header__title">내 스티커 🏅</span>
      </header>

      <div className="hy-content sb-list">
        {/* 이번 주 리워드 카드 */}
        <div className="sb-reward">
          <img className="sb-reward__gift" src={asset("ui/gift.webp")} alt="" />
          <div className="sb-reward__label">이번 주 모은 스티커</div>
          <div className="sb-reward__count">
            <span className="sb-reward__num">{collected}</span>
            <span className="sb-reward__unit">개</span>
          </div>
          <div className="sb-reward__track">
            <div className="sb-reward__fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="sb-reward__hint">
            {remaining > 0 ? `다음 선물까지 ${remaining}개 남았어! 🎁` : "선물 받을 수 있어! 🎁"}
          </div>
        </div>

        {/* 받은 스티커 실목록 */}
        {isLoading ? (
          <div className="sb-empty">스티커를 불러오는 중…</div>
        ) : isError ? (
          <div className="sb-empty">스티커를 불러오지 못했어 😢</div>
        ) : list.length === 0 ? (
          <div className="sb-empty">아직 받은 스티커가 없어! 칭찬 받으면 여기 붙어 💛</div>
        ) : (
          <div className="sb-grid">
            {list.map((s) => {
              const view = resolveSticker(s);
              return (
                <div key={s.id} className="sb-sticker">
                  {view.img ? (
                    <img className="sb-sticker__img" src={asset(view.img)} alt="" />
                  ) : (
                    <span className="sb-sticker__img sb-sticker__emoji">{s.emoji}</span>
                  )}
                  <span className="sb-sticker__name">{view.name}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
