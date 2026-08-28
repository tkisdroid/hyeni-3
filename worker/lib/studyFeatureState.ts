import { readGlobalSetting } from "./globalSettings.ts";

export const STUDY_MANAGEMENT_ENABLED_KEY = "study_management_enabled";
export const STUDY_LEARNER_ENABLED_KEY = "study_learner_enabled";
export const STUDY_ROLLOUT_BASIS_POINTS_KEY = "study_rollout_basis_points";
export const STUDY_ROLLOUT_CANARY_REFS_KEY = "study_rollout_canary_refs";

type StudyAccessRole = "parent" | "child";

interface StudyFeatureSettings {
  managementEnabled: boolean;
  learnerEnabled: boolean;
  rolloutBasisPoints: number;
  rolloutCanaryRefs: ReadonlySet<string>;
}

function parseEnabledFlag(value: string): boolean {
  return value === "true";
}

function parseBasisPoints(value: string): number | null {
  if (!/^(?:0|[1-9]\d{0,4})$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 10_000 ? parsed : null;
}

function parseCanaryRefs(value: string): ReadonlySet<string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(entry))) {
    return null;
  }
  return new Set(parsed);
}

async function readStudyFeatureSettings(db: D1Database): Promise<StudyFeatureSettings | null> {
  try {
    const [management, learner, rollout, canaries] = await Promise.all([
      readGlobalSetting(db, STUDY_MANAGEMENT_ENABLED_KEY),
      readGlobalSetting(db, STUDY_LEARNER_ENABLED_KEY),
      readGlobalSetting(db, STUDY_ROLLOUT_BASIS_POINTS_KEY),
      readGlobalSetting(db, STUDY_ROLLOUT_CANARY_REFS_KEY),
    ]);
    const rolloutBasisPoints = parseBasisPoints(rollout.value);
    const rolloutCanaryRefs = parseCanaryRefs(canaries.value);
    if (rolloutBasisPoints === null || rolloutCanaryRefs === null) return null;
    return {
      managementEnabled: parseEnabledFlag(management.value),
      learnerEnabled: parseEnabledFlag(learner.value),
      rolloutBasisPoints,
      rolloutCanaryRefs,
    };
  } catch {
    return null;
  }
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createFamilyRef(secret: string, familyId: string): Promise<{ ref: string; first16Bits: number } | null> {
  if (!secret || !familyId) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = new Uint8Array(await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`study-rollout\n${familyId}`),
    ));
    if (digest.length < 2) return null;
    return {
      ref: base64url(digest),
      first16Bits: (digest[0] << 8) | digest[1],
    };
  } catch {
    return null;
  }
}

function isInBasisPointRollout(first16Bits: number, basisPoints: number): boolean {
  if (basisPoints === 10_000) return true;
  if (basisPoints === 0) return false;
  return Math.floor((first16Bits * 10_000) / 65_536) < basisPoints;
}

/**
 * 역할별 플래그와 가족 가명 rollout을 모두 통과했을 때만 Study binding을 호출한다.
 * 설정 행·형식·secret 중 하나라도 없으면 false로 닫고 가족 ID는 반환하거나 기록하지 않는다.
 */
export async function isStudyFeatureEnabled(
  db: D1Database,
  input: { familyId: string; role: StudyAccessRole; rolloutSecret: string | undefined },
): Promise<boolean> {
  const settings = await readStudyFeatureSettings(db);
  if (!settings) return false;
  if (input.role === "parent" ? !settings.managementEnabled : !settings.learnerEnabled) return false;

  const familyRef = await createFamilyRef(input.rolloutSecret ?? "", input.familyId);
  if (!familyRef) return false;
  if (settings.rolloutCanaryRefs.has(familyRef.ref)) return true;
  return isInBasisPointRollout(familyRef.first16Bits, settings.rolloutBasisPoints);
}
