/**
 * 아이 스티커북 — 칭찬 스티커 12칸 도감(시안 2a).
 *
 * 받은 스티커는 색이 살아나고, 아직 못 받은 칸은 회색 자물쇠다. 새로 온 스티커에는 NEW 배지가 붙고,
 * 한 번 열어보면 사라진다("열어봤다"는 이 기기에만 저장 — 서버에 읽음 컬럼이 없다).
 */
import { useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { asset } from "@/lib/assets";
import { useToast } from "@/app/toast";
import { useAuth } from "@/auth/AuthContext";
import { useReceivedStickers } from "@/queries/useStickers";
import {
  buildStickerBook,
  readSeenStickers,
  writeSeenSticker,
  type StickerSlot,
} from "@/transform/stickerBook";
import { StickerDetail } from "./overlays/StickerDetail";
import "./StickerBook.css";

/** 이번 주에 받은 스티커 개수(배지). */
function countThisWeek(latestAts: readonly (number | null)[], nowMs: number): number {
  const week = 7 * 24 * 60 * 60 * 1000;
  return latestAts.filter((t) => t != null && nowMs - t <= week).length;
}

export function StickerBook() {
  const { show } = useToast();
  const { userId } = useAuth();
  const received = useReceivedStickers(userId);
  const nowMs = useMemo(() => Date.now(), []);

  const [seen, setSeen] = useState<ReadonlySet<string>>(() =>
    typeof window === "undefined" ? new Set<string>() : readSeenStickers(window.localStorage, userId),
  );
  const [selected, setSelected] = useState<StickerSlot | null>(null);

  const book = useMemo(
    () => buildStickerBook(received.data ?? [], nowMs, seen),
    [received.data, nowMs, seen],
  );
  const weekCount = countThisWeek(
    book.slots.map((s) => s.latestAt),
    nowMs,
  );

  const openSlot = (slot: StickerSlot) => {
    if (!slot.got) {
      show("부모님 칭찬을 받으면 열려! 🔒", "✨");
      return;
    }
    setSelected(slot);
    if (slot.latestId && typeof window !== "undefined") {
      setSeen(writeSeenSticker(window.localStorage, userId, seen, slot.latestId));
    }
  };

  return (
    <div className="sb-root hy-rise-in">
      <header className="sb-head">
        <img src={asset("ui/crown.webp")} alt="" />
        <span className="sb-head__title">내 스티커북</span>
        {weekCount > 0 && <span className="sb-head__badge">이번 주 +{weekCount}</span>}
      </header>

      <div className="sb-body">
        <div className="sb-progress">
          <div className="sb-progress__count">
            {book.total}개 중 <b>{book.gotCount}개</b> 모았어!
          </div>
          <div className="sb-progress__bar">
            <div className="sb-progress__fill" style={{ width: `${book.percent}%` }} />
          </div>
          <div className="sb-progress__hint">부모님이 칭찬 스티커를 보내면 여기 모여 💌</div>
        </div>

        {received.isLoading ? (
          <div className="sb-state">스티커를 불러오는 중이야…</div>
        ) : received.isError ? (
          <div className="sb-state" role="alert">
            <span>스티커를 못 불러왔어.</span>
            <button type="button" className="hy-press" onClick={() => void received.refetch()}>다시 불러오기</button>
          </div>
        ) : (
          <>
            {book.gotCount === 0 && <div className="sb-state">아직 받은 스티커가 없어. 첫 칭찬을 기다려 보자!</div>}
            <div className="sb-grid">
              {book.slots.map((slot) => (
                <button
                  key={slot.key}
                  type="button"
                  className={`sb-slot${slot.got ? "" : " sb-slot--locked"} hy-press`}
                  onClick={() => openSlot(slot)}
                  aria-label={slot.got ? `${slot.label} 스티커 열어보기` : `${slot.label} 스티커 아직 못 받았어`}
                >
                  {slot.isNew && <span className="sb-slot__new">NEW</span>}
                  {slot.count > 1 && <span className="sb-slot__count">{slot.count}</span>}
                  <img src={asset(slot.img)} alt="" />
                  <span className="sb-slot__label">{slot.label}</span>
                  {!slot.got && (
                    <span className="sb-slot__lock" aria-hidden="true">
                      <Lock size={14} strokeWidth={2.4} color="var(--fg-muted)" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <StickerDetail slot={selected} nowMs={nowMs} onClose={() => setSelected(null)} />
    </div>
  );
}
