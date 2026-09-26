import { useFamilyTimeZone } from "@/region/FamilyTimeZone";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { useNavigate } from "react-router";
import { ChevronLeft } from "lucide-react";
import { asset } from "@/lib/assets";
import { childAvatarPath } from "@/lib/avatar";
import { useToast } from "@/app/toast";
import { useMyFamily } from "@/queries/useFamily";
import { useActiveChild } from "@/app/activeChild";
import { useReceivedStickers, useSendSticker, useStickerSummary } from "@/queries/useStickers";

import { buildStickerBook, stickerSendDateKey } from "@/transform/stickerBook";
import { ScreenQueryState } from "@/components/ui/ScreenQueryState";
import { resolveQueryTruthState } from "@/transform/queryTruthState";
import "@/components/ChildSwitcher.css";
import "./StickerSend.css";

type Sticker = { id: string; img: string; labelId: string; emoji: string };

/** 상황별 칭찬 스티커 목록(assets/sticker/*.webp). emoji 는 전송 payload 용. */
const STICKERS: ReadonlyArray<Sticker> = [
  { id: "best", img: "sticker/best.webp", labelId: "shared.stickerSend.sticker.best", emoji: "🏆" },
  { id: "love", img: "sticker/love.webp", labelId: "shared.stickerSend.sticker.love", emoji: "💗" },
  { id: "cool", img: "sticker/cool.webp", labelId: "shared.stickerSend.sticker.cool", emoji: "😎" },
  { id: "brave", img: "sticker/brave.webp", labelId: "shared.stickerSend.sticker.brave", emoji: "🙌" },
  { id: "study", img: "sticker/study.webp", labelId: "shared.stickerSend.sticker.study", emoji: "📚" },
  { id: "self", img: "sticker/self.webp", labelId: "shared.stickerSend.sticker.self", emoji: "👍" },
  { id: "ready", img: "sticker/ready.webp", labelId: "shared.stickerSend.sticker.ready", emoji: "✅" },
  { id: "early", img: "sticker/early.webp", labelId: "shared.stickerSend.sticker.early", emoji: "🌟" },
  { id: "friend", img: "sticker/friend.webp", labelId: "shared.stickerSend.sticker.friend", emoji: "💛" },
  { id: "play", img: "sticker/play.webp", labelId: "shared.stickerSend.sticker.play", emoji: "🧸" },
  { id: "sports", img: "sticker/sports.webp", labelId: "shared.stickerSend.sticker.sports", emoji: "🎾" },
  { id: "rest", img: "sticker/rest.webp", labelId: "shared.stickerSend.sticker.rest", emoji: "🌙" },
];

/** photo_url(http/blob)은 그대로, 로컬 캐릭터 키는 asset()으로 해석. */
function avatarSrc(path: string): string {
  return path.startsWith("http") || path.startsWith("blob:") ? path : asset(path);
}

/** 등록한 프로필 사진인지 — 프레임을 꽉 채워 표시하기 위한 판정. */
function isUploadedAvatar(src: string | null | undefined): boolean {
  const value = src?.trim() ?? "";
  return value.startsWith("http") || value.startsWith("blob:");
}

/** 부모: 상황별 칭찬 스티커 + 한마디를 골라 아이에게 전송(다자녀 시 대상 선택). */
export function StickerSend() {
  const familyTimeZone = useFamilyTimeZone();
  const navigate = useNavigate();
  const intl = useIntl();
  const { show } = useToast();
  const familyQuery = useMyFamily();
  const summaryQuery = useStickerSummary();
  const family = familyQuery.data;
  const summary = summaryQuery.data;
  const sendSticker = useSendSticker();

  const [pickedId, setPickedId] = useState<string>(STICKERS[0].id);
  const [message, setMessage] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const picked = STICKERS.find((s) => s.id === pickedId) ?? STICKERS[0];
  const pickedLabel = intl.formatMessage({ id: picked.labelId });

  // 연동된(user_id 보유) 자녀 목록. 2명 이상이면 대상 선택 UI 노출.
  const children = useMemo(
    () => (family?.members ?? []).filter((m) => m.role === "child" && !!m.user_id),
    [family],
  );
  // 식별자 2축: 명시 선택은 user_id, 활성 아이는 family_members.id로만 매칭한다.
  const { activeChild } = useActiveChild();
  const targetChild = useMemo(
    () =>
      children.find((c) => c.user_id === selectedUserId) ??
      children.find((c) => c.id === activeChild?.id) ??
      null,
    [children, selectedUserId, activeChild],
  );
  const receivedQuery = useReceivedStickers(targetChild?.user_id ?? null);
  const nowMs = useMemo(() => Date.now(), []);
  // 아이 스티커북과 동일한 API·동일한 변환기를 사용해 부모 화면의 보유 현황이 반드시 일치한다.
  const receivedBook = useMemo(
    () => buildStickerBook(receivedQuery.data ?? [], nowMs, new Set<string>(), intl),
    [intl, receivedQuery.data, nowMs],
  );
  const stickerQueryState = resolveQueryTruthState([
    { isLoading: familyQuery.isLoading, isError: familyQuery.isError },
    { isLoading: summaryQuery.isLoading, isError: summaryQuery.isError },
    {
      isLoading: targetChild ? receivedQuery.isLoading : false,
      isError: targetChild ? receivedQuery.isError : false,
    },
  ]);
  const stickerDataMissing = stickerQueryState === "ready" && (
    !family || summary === undefined || (targetChild != null && receivedQuery.data === undefined)
  );
  const stickerDataReady = stickerQueryState === "ready" && !stickerDataMissing;
  const stickerRefetching = familyQuery.isFetching || summaryQuery.isFetching || receivedQuery.isFetching;
  const retryStickerSend = async (): Promise<void> => {
    await Promise.all([
      familyQuery.refetch(),
      summaryQuery.refetch(),
      ...(targetChild ? [receivedQuery.refetch()] : []),
    ]);
  };
  const childName = targetChild?.name
    || intl.formatMessage({ id: "shared.stickerSend.childFallback" });

  // 받은 칭찬 누적(스티커 집계) — 미리보기 카드 실데이터.
  const receivedCount = useMemo(() => {
    const row = summary?.find((s) => s.user_id === targetChild?.user_id);
    return row?.total_count ?? 0;
  }, [summary, targetChild]);

  // 전송은 사용자가 버튼을 눌러야만 실행(자동 실행 금지).
  const handleSend = () => {
    if (!stickerDataReady) {
      show(intl.formatMessage({ id: "shared.stickerSend.dataUnavailable" }), "⚠️");
      return;
    }
    if (!targetChild?.user_id) {
      show(intl.formatMessage({ id: "shared.stickerSend.noTargetToast" }), "👶");
      return;
    }
    if (sendSticker.isPending) return;
    const note = message.trim();
    sendSticker.mutate(
      {
        user_id: targetChild.user_id,
        event_id: `praise-${Date.now()}`,
        date_key: stickerSendDateKey(new Date(), familyTimeZone),
        sticker_type: "praise",
        emoji: picked.emoji,
        // 스티커 전용 메시지 필드가 없어 한마디를 title 로 실제 전송(없으면 스티커 라벨).
        title: note || pickedLabel,
      },
      {
        onSuccess: () => {
          show(intl.formatMessage(
            { id: "shared.stickerSend.sent" },
            { childName, stickerLabel: pickedLabel },
          ), "💌");
          setMessage("");
        },
        onError: () => show(intl.formatMessage({ id: "shared.stickerSend.sendError" }), "⚠️"),
      },
    );
  };

  if (stickerQueryState === "loading") {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "shared.stickerSend.screenTitle" })}
        state="loading"
        heading={intl.formatMessage({ id: "shared.stickerSend.loadingHeading" })}
        description={intl.formatMessage({ id: "shared.stickerSend.loadingDescription" })}
        onBack={() => navigate(-1)}
      />
    );
  }

  if (stickerQueryState === "error" || stickerDataMissing) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "shared.stickerSend.screenTitle" })}
        state="error"
        heading={intl.formatMessage({ id: "shared.stickerSend.errorHeading" })}
        description={intl.formatMessage({ id: "shared.stickerSend.errorDescription" })}
        onBack={() => navigate(-1)}
        onRetry={() => void retryStickerSend()}
        retrying={stickerRefetching}
      />
    );
  }

  if (children.length === 0) {
    return (
      <ScreenQueryState
        screenTitle={intl.formatMessage({ id: "shared.stickerSend.screenTitle" })}
        state="empty"
        heading={intl.formatMessage({ id: "shared.stickerSend.emptyHeading" })}
        description={intl.formatMessage({ id: "shared.stickerSend.emptyDescription" })}
        onBack={() => navigate(-1)}
        onRetry={() => navigate("/child-invite?role=child")}
        retryLabel={intl.formatMessage({ id: "shared.stickerSend.connectChild" })}
      />
    );
  }

  return (
    <div className="ss-wrap">
      <header className="ss-header">
        <button
          type="button"
          className="ss-back hy-press"
          aria-label={intl.formatMessage({ id: "shared.stickerSend.back" })}
          onClick={() => navigate(-1)}
        >
          <ChevronLeft size={22} strokeWidth={2.2} color="#4A4145" />
        </button>
        <span className="ss-title">
          {intl.formatMessage({ id: "shared.stickerSend.screenTitle" })}
        </span>
      </header>

      <div className="ss-body">
        {/* 다자녀이거나 활성 아이가 유효하지 않으면 사용자가 수신자를 명시한다. */}
        {(children.length > 1 || !targetChild) && (
          <>
            {!targetChild ? (
              <div className="ss-pick-title">
                {intl.formatMessage({ id: "shared.stickerSend.selectChildPrompt" })}
              </div>
            ) : null}
            {/* 받는 아이는 이 화면에서 명시적으로 고른다. 모양은 앱 공용 다자녀 전환 알약과 같다. */}
            <div className="hy-kidswitch ss-children" role="radiogroup" aria-label={intl.formatMessage({ id: "shared.childSwitcher.label" })}>
              {children.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  className="hy-kidswitch__item hy-press"
                  data-selected={c.user_id === targetChild?.user_id ? "true" : "false"}
                  aria-checked={c.user_id === targetChild?.user_id}
                  onClick={() => setSelectedUserId(c.user_id)}
                >
                  <span className="hy-kidswitch__avatar" data-photo={isUploadedAvatar(c.photo_url) ? "true" : "false"}>
                    <img className="hy-network-avatar" src={avatarSrc(childAvatarPath(c.photo_url))} alt="" loading="lazy" decoding="async" />
                  </span>
                  <span className="hy-kidswitch__name">
                    {c.name || intl.formatMessage({ id: "shared.stickerSend.childFallback" })}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* 미리보기 카드 */}
        <div className="hy-card ss-preview">
          <div className="ss-preview__eyebrow">
            {targetChild
              ? intl.formatMessage(
                { id: "shared.stickerSend.preview" },
                { childName },
              )
              : intl.formatMessage({ id: "shared.stickerSend.previewNoTarget" })}
          </div>
          <div className="ss-preview__tile" key={picked.id}>
            <img src={asset(picked.img)} alt="" />
          </div>
          <div className="ss-preview__label">{pickedLabel}</div>
          <div className="ss-preview__count">
            {intl.formatMessage(
              { id: "shared.stickerSend.receivedCount" },
              { count: receivedCount },
            )}
          </div>
        </div>

        {/* 아이 스티커북과 같은 정본 데이터로 보여주는 현재 보유 현황. */}
        <section className="ss-received" aria-labelledby="ss-received-title">
          <div className="ss-received__head">
            <div>
              <div id="ss-received-title" className="ss-pick-title">
                {intl.formatMessage({ id: "shared.stickerSend.receivedBookTitle" })}
              </div>
              <p>{intl.formatMessage(
                { id: "shared.stickerSend.receivedCount" },
                { count: receivedQuery.data?.length ?? 0 },
              )}</p>
            </div>
            <img src={asset("ui/clay/sticker.webp")} alt="" />
          </div>
          <div className="hy-card ss-received__grid">
            {receivedBook.slots.map((slot) => (
              <div
                key={slot.key}
                className="ss-received__slot"
                data-received={slot.got}
                aria-label={`${slot.label} ${slot.count}`}
              >
                {slot.count > 1 ? <span>{slot.count}</span> : null}
                <img src={asset(slot.img)} alt="" />
                <small>{slot.label}</small>
              </div>
            ))}
          </div>
        </section>

        {/* 상황별 선택 그리드 */}
        <div>
          <div className="ss-pick-title">
            {intl.formatMessage({ id: "shared.stickerSend.chooseTitle" })}
          </div>
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
                <span className="ss-chip__label">
                  {intl.formatMessage({ id: s.labelId })}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 한마디 (선택) */}
        <div>
          <div className="ss-pick-title">
            {intl.formatMessage({ id: "shared.stickerSend.messageTitle" })}
          </div>
          <textarea
            className="ss-msg"
            aria-label={intl.formatMessage({ id: "shared.stickerSend.messageAria" })}
            placeholder={intl.formatMessage({ id: "shared.stickerSend.messagePlaceholder" })}
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
          disabled={sendSticker.isPending || !targetChild} aria-busy={sendSticker.isPending}
        >
          <img src={asset("ui/chat-heart.webp")} alt="" />
          {sendSticker.isPending
            ? intl.formatMessage({ id: "shared.stickerSend.sending" })
            : targetChild
              ? intl.formatMessage({ id: "shared.stickerSend.sendTo" }, { childName })
              : intl.formatMessage({ id: "shared.stickerSend.selectChildButton" })}
        </button>
      </div>
    </div>
  );
}
