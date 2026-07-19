import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceChildInviteConnection,
  type ChildInviteConnectionState,
} from "../src/transform/childInviteConnection.ts";
import {
  DialogFocusStack,
  handleTopmostDialogKey,
  restoreDialogFocus,
  shouldHandleDialogKey,
} from "../src/components/dialogFocusStack.ts";

test("아이 초대 baseline은 오류 응답을 무시하고 첫 성공 응답에서만 확정한다", () => {
  let state: ChildInviteConnectionState = { baseline: null, notified: false };

  const failed = advanceChildInviteConnection(state, { status: "error", childUids: [] });
  assert.equal(failed.state.baseline, null);
  assert.equal(failed.newChildUid, null);

  const retried = advanceChildInviteConnection(failed.state, {
    status: "success",
    childUids: ["existing-child"],
  });
  assert.deepEqual(retried.state.baseline, ["existing-child"]);
  assert.equal(retried.newChildUid, null, "오류 뒤 재조회된 기존 아이를 신규 연결로 오인하면 안 됩니다");

  state = retried.state;
  const retryError = advanceChildInviteConnection(state, {
    status: "error",
    childUids: [],
  });
  const sameChildren = advanceChildInviteConnection(retryError.state, {
    status: "success",
    childUids: ["existing-child"],
  });
  assert.equal(sameChildren.newChildUid, null);

  const connected = advanceChildInviteConnection(sameChildren.state, {
    status: "success",
    childUids: ["new-child", "existing-child"],
  });
  assert.equal(connected.newChildUid, "new-child");
  assert.equal(connected.state.notified, true);

  const duplicatePoll = advanceChildInviteConnection(connected.state, {
    status: "success",
    childUids: ["existing-child", "new-child"],
  });
  assert.equal(duplicatePoll.newChildUid, null, "같은 연결을 폴링마다 다시 안내하면 안 됩니다");
});

test("중첩 dialog는 최상단만 Escape와 Tab을 처리하고 한 번에 하나만 닫는다", () => {
  const stack = new DialogFocusStack<string>();
  stack.open({ id: "outer", focusFallback: () => undefined });
  stack.open({ id: "inner", focusFallback: () => undefined });

  assert.equal(shouldHandleDialogKey(stack, "outer", "Escape"), false);
  assert.equal(shouldHandleDialogKey(stack, "outer", "Tab"), false);
  assert.equal(shouldHandleDialogKey(stack, "inner", "Escape"), true);
  assert.equal(shouldHandleDialogKey(stack, "inner", "Tab"), true);

  const closedInner = stack.close("inner");
  assert.equal(closedInner.wasTop, true);
  assert.equal(closedInner.nextTop?.id, "outer");
  assert.equal(stack.isTop("outer"), true, "Escape 한 번으로 바깥 dialog까지 닫히면 안 됩니다");
});

test("dialog focus 복원은 연결된 이전 요소를 우선하고 없으면 남은 최상단으로 돌아간다", () => {
  const calls: string[] = [];
  const stack = new DialogFocusStack<string>();
  stack.open({ id: "outer", focusFallback: () => calls.push("outer") });
  stack.open({ id: "inner", focusFallback: () => calls.push("inner") });

  const closedInner = stack.close("inner");
  restoreDialogFocus(closedInner, () => calls.push("previous"));
  assert.deepEqual(calls, ["previous"]);

  stack.open({ id: "inner-2", focusFallback: () => calls.push("inner-2") });
  const closedWithoutPrevious = stack.close("inner-2");
  restoreDialogFocus(closedWithoutPrevious, null);
  assert.deepEqual(calls, ["previous", "outer"]);

  stack.open({ id: "inner-3", focusFallback: () => calls.push("inner-3") });
  const removedUnderlay = stack.close("outer");
  restoreDialogFocus(removedUnderlay, () => calls.push("should-not-run"));
  assert.deepEqual(calls, ["previous", "outer"], "최상단이 아닌 dialog 정리 시 포커스를 훔치면 안 됩니다");
});

test("바깥 dialog가 먼저 unmount돼도 안쪽 dialog 종료 후 원래 페이지 포커스를 복원한다", () => {
  const calls: string[] = [];
  const stack = new DialogFocusStack<string>();
  stack.open({
    id: "outer",
    focusFallback: () => calls.push("outer-focus"),
    restoreFallback: () => {
      calls.push("page");
      return true;
    },
  });
  stack.open({
    id: "inner",
    focusFallback: () => calls.push("inner-focus"),
    restoreFallback: () => {
      calls.push("detached-outer-button");
      return false;
    },
  });

  restoreDialogFocus(stack.close("outer"));
  assert.deepEqual(calls, [], "최상단이 아닌 바깥 dialog 정리는 포커스를 훔치면 안 됩니다");

  restoreDialogFocus(stack.close("inner"));
  assert.deepEqual(
    calls,
    ["detached-outer-button", "page"],
    "끊긴 바깥 호출 버튼 다음으로 페이지 복귀 지점을 이어서 사용해야 합니다",
  );
});

test("실제 hook 키보드 알고리즘은 최상단 dialog에서만 Escape와 양방향 Tab 순환을 수행한다", () => {
  const stack = new DialogFocusStack<string>();
  stack.open({ id: "outer", focusFallback: () => undefined });
  stack.open({ id: "inner", focusFallback: () => undefined });

  const calls: string[] = [];
  const common = {
    stack,
    canClose: () => true,
    onClose: () => calls.push("close"),
    preventDefault: () => calls.push("prevent"),
    focusDialog: () => calls.push("dialog"),
  };
  const first = { id: "first", focus: () => calls.push("first") };
  const last = { id: "last", focus: () => calls.push("last") };

  assert.equal(handleTopmostDialogKey({
    ...common,
    dialogId: "outer",
    key: "Escape",
    shiftKey: false,
    focusable: [first, last],
    activeElement: last,
    focusIsOutside: false,
  }), false);
  assert.deepEqual(calls, []);

  assert.equal(handleTopmostDialogKey({
    ...common,
    dialogId: "inner",
    key: "Escape",
    shiftKey: false,
    focusable: [first, last],
    activeElement: last,
    focusIsOutside: false,
  }), true);
  assert.deepEqual(calls, ["prevent", "close"]);

  calls.length = 0;
  assert.equal(handleTopmostDialogKey({
    ...common,
    dialogId: "inner",
    key: "Tab",
    shiftKey: false,
    focusable: [first, last],
    activeElement: last,
    focusIsOutside: false,
  }), true);
  assert.deepEqual(calls, ["prevent", "first"]);

  calls.length = 0;
  assert.equal(handleTopmostDialogKey({
    ...common,
    dialogId: "inner",
    key: "Tab",
    shiftKey: true,
    focusable: [first, last],
    activeElement: first,
    focusIsOutside: false,
  }), true);
  assert.deepEqual(calls, ["prevent", "last"]);

  calls.length = 0;
  assert.equal(handleTopmostDialogKey({
    ...common,
    dialogId: "inner",
    key: "Tab",
    shiftKey: false,
    focusable: [],
    activeElement: null,
    focusIsOutside: true,
  }), true);
  assert.deepEqual(calls, ["prevent", "dialog"]);

  const nonTabbableContainer = { id: "container", focus: () => calls.push("container") };
  calls.length = 0;
  assert.equal(handleTopmostDialogKey({
    ...common,
    dialogId: "inner",
    key: "Tab",
    shiftKey: false,
    focusable: [first, last],
    activeElement: nonTabbableContainer,
    focusIsOutside: false,
  }), true);
  assert.deepEqual(calls, ["prevent", "first"], "tabIndex=-1 초기 컨테이너에서 첫 Tab이 dialog 밖으로 나가면 안 됩니다");

  calls.length = 0;
  assert.equal(handleTopmostDialogKey({
    ...common,
    dialogId: "inner",
    key: "Tab",
    shiftKey: true,
    focusable: [first, last],
    activeElement: nonTabbableContainer,
    focusIsOutside: false,
  }), true);
  assert.deepEqual(calls, ["prevent", "last"], "tabIndex=-1 초기 컨테이너에서 Shift+Tab은 마지막 항목으로 가야 합니다");
});
