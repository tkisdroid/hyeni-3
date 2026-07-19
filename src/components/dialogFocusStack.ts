export interface DialogFocusStackEntry<TId> {
  id: TId;
  focusFallback: () => void;
}

export interface DialogFocusStackCloseResult<TId> {
  wasTop: boolean;
  nextTop: DialogFocusStackEntry<TId> | null;
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
    if (index < 0) return { wasTop: false, nextTop: this.top() };
    const wasTop = index === this.entries.length - 1;
    this.entries = this.entries.filter((entry) => entry.id !== id);
    return { wasTop, nextTop: wasTop ? this.top() : null };
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

/** 닫힌 최상단 dialog의 호출 요소가 없으면 남아 있는 dialog 안으로 안전하게 복귀한다. */
export function restoreDialogFocus<TId>(
  result: DialogFocusStackCloseResult<TId>,
  restorePrevious: (() => void) | null,
): void {
  if (!result.wasTop) return;
  if (restorePrevious) {
    restorePrevious();
    return;
  }
  result.nextTop?.focusFallback();
}

export const dialogFocusStack = new DialogFocusStack<symbol>();
