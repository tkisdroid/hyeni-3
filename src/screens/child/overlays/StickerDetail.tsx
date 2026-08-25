/**
 * 스티커 상세 모달 — 스티커북에서 받은 스티커를 누르면 열린다.
 *
 * 서버 `stickers` 에는 보낸 사람 이름도, 칭찬 메시지도 없다. 그래서 시안의
 * "엄마가 오늘 보냈어 / 태권도 가방을 스스로 챙겼구나!" 같은 문장은 만들지 않는다.
 * 대신 확실한 사실만 쓴다: 언제 받았는지(earned_at), 어떤 종류인지(sticker_type), 몇 개인지.
 */
import { asset } from "@/lib/assets";
import { useIntl } from "react-intl";
import { stickerOriginText, stickerWhenLabel, type StickerSlot } from "@/transform/stickerBook";
import { ChildModal } from "./ChildSheet";
import { useLocale } from "@/i18n/useLocale";
import { LEGACY_FAMILY_TIME_ZONE } from "@/i18n/format";

export interface StickerDetailProps {
  slot: StickerSlot | null;
  nowMs: number;
  onClose: () => void;
}

export function StickerDetail({ slot, nowMs, onClose }: StickerDetailProps) {
  const intl = useIntl();
  const { locale } = useLocale();
  if (!slot) return null;
  return (
    <ChildModal
      open
      onClose={onClose}
      label={intl.formatMessage({ id: "child.stickerDetail.label" }, { label: slot.label })}
    >
      <img className="ks-modal__img" src={asset(slot.img)} alt={slot.label} />
      <div className="ks-modal__label">{slot.label}</div>
      <div className="ks-modal__meta">
        {stickerWhenLabel(slot.latestAt, nowMs, locale, LEGACY_FAMILY_TIME_ZONE, intl)}
        {slot.count > 1
          ? intl.formatMessage({ id: "child.stickerDetail.count" }, { count: slot.count })
          : ""}
      </div>
      <div className="ks-modal__msg">{stickerOriginText(slot.latestType, intl)}</div>
      <button type="button" className="ks-cta hy-press" onClick={onClose}>
        {intl.formatMessage({ id: "child.stickerDetail.confirm" })}
      </button>
    </ChildModal>
  );
}
