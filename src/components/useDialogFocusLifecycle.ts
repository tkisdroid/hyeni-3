import { useEffect, useRef, type RefObject } from "react";
import {
  dialogFocusStack,
  handleTopmostDialogKey,
  restoreDialogFocus,
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
    dialogFocusStack.open({
      id: dialogId,
      focusFallback: focusDialog,
      restoreFallback: () => {
        if (!previousFocus?.isConnected) return false;
        previousFocus.focus();
        return true;
      },
    });

    const animationFrame = window.requestAnimationFrame(() => {
      if (dialogFocusStack.isTop(dialogId)) focusDialog();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      const focusable = focusableElements();
      const active = document.activeElement;
      const focusIsOutside = !dialogRef.current?.contains(active);
      handleTopmostDialogKey({
        stack: dialogFocusStack,
        dialogId,
        key: event.key,
        shiftKey: event.shiftKey,
        canClose: canCloseRef.current,
        onClose: onCloseRef.current,
        preventDefault: () => event.preventDefault(),
        focusable,
        activeElement: active instanceof HTMLElement ? active : null,
        focusIsOutside,
        focusDialog,
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("keydown", onKeyDown);
      const closeResult = dialogFocusStack.close(dialogId);
      restoreDialogFocus(closeResult);
    };
  }, [initialFocusRef, open]);

  return dialogRef;
}
