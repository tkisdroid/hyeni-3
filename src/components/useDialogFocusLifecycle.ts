import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[contenteditable=\"true\"]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(", ");

interface DialogFocusLifecycleOptions {
  open: boolean;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  canClose?: () => boolean;
}

/** dialog의 진입·순환·Escape 종료·호출 버튼 복귀를 한 생명주기로 관리한다. */
export function useDialogFocusLifecycle<TDialog extends HTMLElement>({
  open,
  onClose,
  initialFocusRef,
  canClose = () => true,
}: DialogFocusLifecycleOptions): RefObject<TDialog | null> {
  const dialogRef = useRef<TDialog>(null);
  const onCloseRef = useRef(onClose);
  const canCloseRef = useRef(canClose);
  onCloseRef.current = onClose;
  canCloseRef.current = canClose;

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusableElements = (): HTMLElement[] =>
      [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])]
        .filter((element) => element.tabIndex >= 0 && !element.hidden);

    const animationFrame = window.requestAnimationFrame(() => {
      const preferred = initialFocusRef?.current;
      (preferred ?? focusableElements()[0] ?? dialogRef.current)?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!canCloseRef.current()) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const focusIsOutside = !dialogRef.current?.contains(active);
      if (event.shiftKey && (active === first || focusIsOutside)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (active === last || focusIsOutside)) {
        event.preventDefault();
        first?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [initialFocusRef, open]);

  return dialogRef;
}
