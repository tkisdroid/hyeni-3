import { useEffect, useRef, type RefObject } from "react";
import {
  dialogFocusStack,
  restoreDialogFocus,
  shouldHandleDialogKey,
} from "./dialogFocusStack";

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
  const dialogIdRef = useRef(Symbol("dialog-focus"));
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

    const focusDialog = () => {
      const preferred = initialFocusRef?.current;
      (preferred ?? focusableElements()[0] ?? dialogRef.current)?.focus();
    };
    const dialogId = dialogIdRef.current;
    dialogFocusStack.open({ id: dialogId, focusFallback: focusDialog });

    const animationFrame = window.requestAnimationFrame(() => {
      if (dialogFocusStack.isTop(dialogId)) focusDialog();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandleDialogKey(dialogFocusStack, dialogId, event.key)) return;
      if (event.key === "Escape") {
        if (!canCloseRef.current()) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
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
      const closeResult = dialogFocusStack.close(dialogId);
      const restorePrevious = previousFocus?.isConnected
        ? () => previousFocus.focus()
        : null;
      restoreDialogFocus(closeResult, restorePrevious);
    };
  }, [initialFocusRef, open]);

  return dialogRef;
}
