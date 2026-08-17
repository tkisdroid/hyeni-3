/**
 * 폭죽 축하 — 가방 챙기기 항목을 완료했을 때 뜬다("참 잘했어요!").
 *
 * 2.2초 뒤 자동으로 사라지고, 아무 곳이나 누르면 바로 닫힌다.
 * `prefers-reduced-motion` 에서는 CSS 가 조각을 숨기고 애니메이션을 끈다(움직임 없이 문구만).
 */
import { useEffect, useMemo } from "react";
import { useIntl } from "react-intl";
import { asset } from "@/lib/assets";
import "./ChildSheet.css";

const CONFETTI_COLORS = ["#F76BA6", "#F5C542", "#31C48D", "#A78BFA", "#4FB2E8", "#FF9E7A"];
const AUTO_CLOSE_MS = 2200;

export interface CelebrateProps {
  /** 크게 띄울 스티커/아이콘 에셋 경로. null 이면 렌더하지 않는다. */
  icon: string | null;
  /** 부제(무엇을 잘했는지). */
  sub: string;
  onClose: () => void;
}

export function Celebrate({ icon, sub, onClose }: CelebrateProps) {
  const intl = useIntl();
  const pieces = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => ({
        left: `${i * 6.3 + 2}%`,
        background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        width: i % 3 ? 9 : 13,
        height: i % 2 ? 14 : 9,
        rotate: (i * 47) % 360,
        delay: `${((i % 5) * 0.12).toFixed(2)}s`,
        duration: `${(1.15 + (i % 4) * 0.22).toFixed(2)}s`,
      })),
    [],
  );

  useEffect(() => {
    if (!icon) return;
    const id = setTimeout(onClose, AUTO_CLOSE_MS);
    return () => clearTimeout(id);
  }, [icon, onClose]);

  if (!icon) return null;

  return (
    <div className="ks-celebrate" role="status" aria-live="polite">
      <button
        type="button"
        className="ks-celebrate__dim"
        aria-label={intl.formatMessage({ id: "child.action.close" })}
        onClick={onClose}
      />
      {pieces.map((p, i) => (
        <span
          key={i}
          className="ks-confetti"
          style={{
            left: p.left,
            width: p.width,
            height: p.height,
            background: p.background,
            transform: `rotate(${p.rotate}deg)`,
            animationDelay: p.delay,
            animationDuration: p.duration,
          }}
        />
      ))}
      <div className="ks-celebrate__box">
        <img className="ks-celebrate__img" src={asset(icon)} alt="" />
        <div className="ks-celebrate__title">{intl.formatMessage({ id: "child.celebrate.title" })}</div>
        <div className="ks-celebrate__sub">{sub}</div>
      </div>
    </div>
  );
}
