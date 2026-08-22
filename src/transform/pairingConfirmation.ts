export interface PairingSessionSnapshot {
  userId: string | null;
  role: string | null;
  familyId: string | null;
}

export interface PairingFamilySnapshot {
  familyId: string;
  myRole: string | null;
  members: ReadonlyArray<{
    user_id: string | null;
    role: string;
  }>;
}

/**
 * 페어링 성공은 mutation 응답만으로 확정하지 않는다. 새 세션 claim, /family/mine 정본,
 * 같은 user_id의 활성 멤버십이 모두 요청 역할·가족과 일치해야 다음 화면으로 진행한다.
 */
export function isPairingMembershipConfirmed(input: {
  mode: "child" | "parent";
  expectedFamilyId: string | null;
  session: PairingSessionSnapshot;
  family: PairingFamilySnapshot | null;
}): boolean {
  const expectedFamilyId = input.expectedFamilyId?.trim() ?? "";
  const userId = input.session.userId?.trim() ?? "";
  if (!expectedFamilyId || !userId || !input.family) return false;
  if (input.session.role !== input.mode || input.session.familyId !== expectedFamilyId) return false;
  if (input.family.familyId !== expectedFamilyId || input.family.myRole !== input.mode) return false;
  return input.family.members.some(
    (member) => member.user_id === userId && member.role === input.mode,
  );
}
