import type { ActiveStudyChild } from "@/transform/studyManagementView";
import { STUDY_COPY_KO } from "./studyCopy.ko";

export function StudyChildTabs({
  children,
  selectedMemberId,
  onSelect,
}: Readonly<{
  children: readonly ActiveStudyChild[];
  selectedMemberId: string | null;
  onSelect: (memberId: string) => void;
}>) {
  if (children.length === 0) return null;
  return (
    <div className="study-child-tabs" role="tablist" aria-label={STUDY_COPY_KO.tabs.label}>
      {children.map((child) => {
        const selected = child.memberId === selectedMemberId;
        return (
          <button
            type="button"
            role="tab"
            aria-selected={selected}
            className="study-child-tabs__tab hy-press"
            data-selected={selected}
            key={child.memberId}
            onClick={() => onSelect(child.memberId)}
          >
            <span className="study-child-tabs__avatar" aria-hidden="true">
              {child.photoUrl ? <img src={child.photoUrl} alt="" /> : child.displayName.slice(0, 1)}
            </span>
            <span>{child.displayName}</span>
          </button>
        );
      })}
    </div>
  );
}
