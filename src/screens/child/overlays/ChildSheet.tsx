/**
 * 아이 모드 공용 오버레이 셸.
 *
 * 시안(2a)의 바텀시트/모달은 전부 같은 뼈대다: 딤 + 손잡이 + 위로 떠오르는 카드.
 * 여기서 딱 한 번만 구현하고 각 시트는 내용만 채운다(중복 구현 금지).
 *
 * 접근성: 공통 dialog lifecycle로 포커스를 가두고 Esc·복귀 포커스를 관리한다.
 */
import { useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useDialogFocusLifecycle } from "@/components/useDialogFocusLifecycle";
import "./ChildSheet.css";

export interface ChildSheetProps {
  open: boolean;
  onClose: () => void;
  /** 스크린리더가 읽을 시트 이름. */
  label: string;
  /** 스크린리더가 읽을 짧은 시트 설명. */
  description?: string;
  children: ReactNode;
}

/** 아래에서 올라오는 바텀시트. */
export function ChildSheet({ open, onClose, label, description, children }: ChildSheetProps) {
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open,
    onClose,
    initialFocusRef: closeRef,
  });
  if (!open) return null;
  return (
    <div
      ref={dialogRef}
      className="ks-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <span id={titleId} className="ks-dialog-a11y">{label}</span>
      <span id={descriptionId} className="ks-dialog-a11y">{description ?? `${label} 창이 열렸어.`}</span>
      <button type="button" className="ks-dim" tabIndex={-1} aria-label="닫기" onClick={onClose} />
      <div className="ks-sheet">
        <div className="ks-dialog-toolbar">
          <div className="ks-handle" aria-hidden="true" />
          <button ref={closeRef} type="button" className="ks-dialog-close hy-press" aria-label="닫기" onClick={onClose}>
            <X size={20} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 화면 가운데 뜨는 모달(스티커 상세 등). */
export function ChildModal({ open, onClose, label, description, children }: ChildSheetProps) {
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocusLifecycle<HTMLDivElement>({
    open,
    onClose,
    initialFocusRef: closeRef,
  });
  if (!open) return null;
  return (
    <div
      ref={dialogRef}
      className="ks-layer ks-layer--center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <span id={titleId} className="ks-dialog-a11y">{label}</span>
      <span id={descriptionId} className="ks-dialog-a11y">{description ?? `${label} 창이 열렸어.`}</span>
      <button type="button" className="ks-dim ks-dim--strong" tabIndex={-1} aria-label="닫기" onClick={onClose} />
      <div className="ks-modal">
        <div className="ks-dialog-toolbar ks-dialog-toolbar--modal">
          <button ref={closeRef} type="button" className="ks-dialog-close hy-press" aria-label="닫기" onClick={onClose}>
            <X size={20} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
