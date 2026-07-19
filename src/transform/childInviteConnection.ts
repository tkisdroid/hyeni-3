export interface ChildInviteConnectionState {
  baseline: readonly string[] | null;
  notified: boolean;
}

export interface ChildInviteConnectionSnapshot {
  status: "loading" | "error" | "success";
  childUids: readonly string[];
}

export interface ChildInviteConnectionResult {
  state: ChildInviteConnectionState;
  newChildUid: string | null;
}

function normalizeChildUids(childUids: readonly string[]): string[] {
  return [...new Set(childUids.map((uid) => uid.trim()).filter(Boolean))].sort();
}

/** 오류·로딩 응답은 baseline을 건드리지 않고, 성공 응답에서 나타난 새 uid만 한 번 감지한다. */
export function advanceChildInviteConnection(
  state: ChildInviteConnectionState,
  snapshot: ChildInviteConnectionSnapshot,
): ChildInviteConnectionResult {
  if (snapshot.status !== "success") return { state, newChildUid: null };

  const current = normalizeChildUids(snapshot.childUids);
  if (state.baseline === null) {
    return { state: { ...state, baseline: current }, newChildUid: null };
  }
  if (state.notified) return { state, newChildUid: null };

  const baseline = new Set(state.baseline);
  const newChildUid = current.find((uid) => !baseline.has(uid)) ?? null;
  if (!newChildUid) return { state, newChildUid: null };
  return {
    state: { ...state, notified: true },
    newChildUid,
  };
}
