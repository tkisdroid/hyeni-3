import type { ReactNode } from "react";

/** 섹션 헤더: 선택 아이콘 + 제목 + 우측 액션 슬롯. */
export function SectionHeader({
  icon,
  iconBg,
  title,
  action,
}: {
  icon?: ReactNode;
  iconBg?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="hy-section-head">
      {icon != null && (
        <span className="hy-section-icon" style={{ background: iconBg }}>
          {icon}
        </span>
      )}
      <span className="hy-section-title">{title}</span>
      {action}
    </div>
  );
}
