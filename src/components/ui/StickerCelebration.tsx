import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useReceivedStickers } from "@/queries/useStickers";
import type { ReceivedSticker } from "@/lib/api/endpoints/stickers";
import { useIntl } from "react-intl";

/** 축하 화면(그림·색종이·CSS)은 아이가 스티커를 받을 때만 필요하다 — 진입 번들 밖에서 받아 온다. */
const loadCelebrationView = () => import("./StickerCelebrationView");
const StickerCelebrationView = lazy(async () => ({ default: (await loadCelebrationView()).StickerCelebrationView }));

export interface StickerCelebrationDetail {
  id?: string;
  emoji?: string;
  title?: string;
  stickerType?: string;
}

declare global {
  interface WindowEventMap {
    "hy:sticker-celebration": CustomEvent<StickerCelebrationDetail>;
  }
}

const CELEBRATION_MS = 4200;
const RECENT_STICKER_MS = 12 * 60 * 60 * 1000;

function storageKey(userId: string): string {
  return `hy_last_celebrated_sticker_${userId}`;
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
    const latest = (received.data ?? [])[0];
    if (!latest?.id || !isRecentSticker(latest)) return;
    try {
      if (window.localStorage.getItem(storageKey(userId)) === latest.id) return;
    } catch {
      // 저장소 접근 불가 환경에서는 세션 중복 방지만 적용한다.
    }
    openCelebration({
      id: latest.id,
      emoji: latest.emoji,
      title: latest.title,
      stickerType: latest.sticker_type,
    });
  }, [openCelebration, received.data, role, userId]);

  // 아이 세션은 첫 화면 뒤에 축하 화면을 미리 받아 두어 첫 스티커가 늦게 뜨지 않게 한다.
  useEffect(() => {
    if (role === "child") void loadCelebrationView();
  }, [role]);

  if (!detail) return null;

  const title = stickerTitle(detail.title, intl.formatMessage({ id: "shared.sticker.defaultTitle" }));
  return (
    <Suspense fallback={null}>
      <StickerCelebrationView key={detail.key} detail={detail} title={title} onClose={() => setDetail(null)} />
    </Suspense>
  );
}
