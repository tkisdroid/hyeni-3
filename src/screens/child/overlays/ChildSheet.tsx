/**
 * 아이 모드 공용 오버레이 셸.
 *
 * 시안(2a)의 바텀시트/모달은 전부 같은 뼈대다: 딤 + 손잡이 + 위로 떠오르는 카드.
 * 여기서 딱 한 번만 구현하고 각 시트는 내용만 채운다(중복 구현 금지).
 *
 * 접근성: Esc 로 닫히고, 딤 영역도 닫기 버튼이다. 열려 있는 동안 뒤 화면 스크롤을 막는다.
 */
import { useEffect, type ReactNode } from "react";
import "./ChildSheet.css";

function useCloseOnEscape(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

export interface ChildSheetProps {
  open: boolean;
  onClose: () => void;
  /** 스크린리더가 읽을 시트 이름. */
  label: string;
  children: ReactNode;
}

/** 아래에서 올라오는 바텀시트. */
export function ChildSheet({ open, onClose, label, children }: ChildSheetProps) {
  useCloseOnEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="ks-layer" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" className="ks-dim" aria-label="닫기" onClick={onClose} />
      <div className="ks-sheet">
        <div className="ks-handle" />
        {children}
      </div>
    </div>
  );
}

/** 화면 가운데 뜨는 모달(스티커 상세 등). */
export function ChildModal({ open, onClose, label, children }: ChildSheetProps) {
  useCloseOnEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="ks-layer ks-layer--center" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" className="ks-dim ks-dim--strong" aria-label="닫기" onClick={onClose} />
      <div className="ks-modal">{children}</div>
    </div>
  );
}
