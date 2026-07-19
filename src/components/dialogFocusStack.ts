export interface DialogFocusStackEntry<TId> {
  id: TId;
  focusFallback: () => void;
  /** dialog가 닫힐 때 원래 호출 요소로 돌아간다. 연결이 끊겼으면 false를 반환한다. */
  restoreFallback?: () => boolean;
}

export interface DialogFocusStackCloseResult<TId> {
  wasTop: boolean;
  nextTop: DialogFocusStackEntry<TId> | null;
  restoreFallback: (() => boolean) | null;
}

/** DOM과 분리된 dialog 순서 정본. 중첩 시 마지막으로 열린 dialog만 키보드 입력을 받는다. */
export class DialogFocusStack<TId> {
  private entries: Array<DialogFocusStackEntry<TId>> = [];

  open(entry: DialogFocusStackEntry<TId>): void {
    this.entries = this.entries.filter((item) => item.id !== entry.id);
    this.entries.push(entry);
  }

  close(id: TId): DialogFocusStackCloseResult<TId> {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index < 0) return { wasTop: false, nextTop: this.top(), restoreFallback: null };
    const wasTop = index === this.entries.length - 1;
    const closing = this.entries[index];

    // 바깥 dialog가 먼저 unmount되면 안쪽 dialog의 원래 호출 요소도 함께 끊길 수 있다.
    // 바깥 dialog가 기억하던 복귀 지점을 바로 위 dialog에 이어 붙여 마지막 종료 때 복원한다.
    if (!wasTop && closing?.restoreFallback) {
      const above = this.entries[index + 1];
      if (above) {
        const ownRestore = above.restoreFallback;
        const inheritedRestore = closing.restoreFallback;
        above.restoreFallback = () => ownRestore?.() === true || inheritedRestore();
      }
    }
    this.entries = this.entries.filter((entry) => entry.id !== id);
    return {
      wasTop,
      nextTop: wasTop ? this.top() : null,
      restoreFallback: wasTop ? closing?.restoreFallback ?? null : null,
    };
  }

  isTop(id: TId): boolean {
    return this.top()?.id === id;
  }

  private top(): DialogFocusStackEntry<TId> | null {
    return this.entries[this.entries.length - 1] ?? null;
  }
}

export function shouldHandleDialogKey<TId>(
  stack: DialogFocusStack<TId>,
  id: TId,
  key: string,
): boolean {
  return (key === "Escape" || key === "Tab") && stack.isTop(id);
}

interface FocusTarget {
  focus: () => void;
}

interface TopmostDialogKeyInput<TId, TFocus extends FocusTarget> {
  stack: DialogFocusStack<TId>;
  dialogId: TId;
  key: string;
  shiftKey: boolean;
  canClose: () => boolean;
  onClose: () => void;
  preventDefault: () => void;
  focusable: readonly TFocus[];
  activeElement: TFocus | null;
  focusIsOutside: boolean;
  focusDialog: () => void;
}

/** 실제 hook이 쓰는 Escape·Tab 알고리즘. DOM 없이도 중첩 순서와 포커스 순환을 회귀 검증한다. */
export function handleTopmostDialogKey<TId, TFocus extends FocusTarget>({
  stack,
  dialogId,
  key,
  shiftKey,
  canClose,
  onClose,
  preventDefault,
  focusable,
  activeElement,
  focusIsOutside,
  focusDialog,
}: TopmostDialogKeyInput<TId, TFocus>): boolean {
  if (!shouldHandleDialogKey(stack, dialogId, key)) return false;

  if (key === "Escape") {
    if (!canClose()) return true;
    preventDefault();
    onClose();
    return true;
  }

  if (focusable.length === 0) {
    preventDefault();
    focusDialog();
    return true;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const activeIsTabbable = activeElement !== null && focusable.includes(activeElement);
  if (!activeIsTabbable) {
    preventDefault();
    (shiftKey ? last : first)?.focus();
  } else if (shiftKey && (activeElement === first || focusIsOutside)) {
    preventDefault();
    last?.focus();
  } else if (!shiftKey && (activeElement === last || focusIsOutside)) {
    preventDefault();
    first?.focus();
  }
  return true;
}

/** 닫힌 최상단 dialog의 호출 요소가 없으면 남아 있는 dialog 안으로 안전하게 복귀한다. */
export function restoreDialogFocus<TId>(
  result: DialogFocusStackCloseResult<TId>,
  restorePrevious: (() => void) | null = null,
): void {
  if (!result.wasTop) return;
  if (restorePrevious) {
    restorePrevious();
    return;
  }
  if (result.restoreFallback?.() === true) return;
  result.nextTop?.focusFallback();
}

export const dialogFocusStack = new DialogFocusStack<symbol>();
