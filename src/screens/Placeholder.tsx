import { asset } from "@/lib/assets";

/** 아직 구현 전인 화면용 임시 플레이스홀더 (마스코트 + 안내). */
export function Placeholder({
  title,
  subtitle,
  mascot = "mascot/thinking.webp",
}: {
  title: string;
  subtitle: string;
  mascot?: string;
}) {
  return (
    <div className="hy-placeholder hy-rise-in">
      <img src={asset(mascot)} alt="" />
      <div className="hy-placeholder__title">{title}</div>
      <div className="hy-placeholder__sub">{subtitle}</div>
    </div>
  );
}
