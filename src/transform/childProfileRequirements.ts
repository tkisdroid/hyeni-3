import { normalizeBirthdate } from "./phone.ts";

export interface ChildProfileRequirementDraft {
  name?: string | null;
  birthdate?: string | null;
}

export type ChildProfileRequirementResult =
  | { ok: true; children: Array<{ name: string; birthdate: string }> }
  | { ok: false; index: number; message: string };

export function normalizeRequiredChildBirthdate(value: string | null | undefined): string {
  return normalizeBirthdate(value);
}

export function validateChildDraftRequirements(
  children: ChildProfileRequirementDraft[],
): ChildProfileRequirementResult {
  const normalized: Array<{ name: string; birthdate: string }> = [];

  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    const label = `아이 ${i + 1}`;
    const name = String(child?.name ?? "").trim();
    if (!name) return { ok: false, index: i, message: `${label}의 이름을 입력해주세요` };

    const birthdate = normalizeRequiredChildBirthdate(child?.birthdate);
    if (!birthdate) return { ok: false, index: i, message: `${label}의 생년월일을 입력해주세요` };

    normalized.push({ name, birthdate });
  }

  return { ok: true, children: normalized };
}
