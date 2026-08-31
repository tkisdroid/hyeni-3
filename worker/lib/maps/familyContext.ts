import type { AuthUser } from "../../types.ts";
import { assertFamilyAccess, resolveCanonicalFamilyMembership } from "../../db/authz.ts";
import { readFamilyRegion } from "../region.ts";
import type { MapPolicy } from "../../../shared/mapPolicy.ts";

export interface FamilyMapContext {
  userId: string;
  familyId: string;
  role: "parent" | "child";
  countryCode: string;
  policy: MapPolicy;
}

export class FamilyMapContextError extends Error {
  readonly code: string;
  readonly status: 403 | 404;

  constructor(code: string, status: 403 | 404) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function loadFamilyMapContext(input: {
  db: D1Database;
  user: AuthUser;
  familyId: unknown;
}): Promise<FamilyMapContext> {
  if (input.user.role === "teacher") throw new FamilyMapContextError("map_teacher_forbidden", 403);
  const familyId = typeof input.familyId === "string" ? input.familyId.trim() : "";
  const canonical = await resolveCanonicalFamilyMembership(
    input.db,
    input.user.sub,
    input.user.family_id ?? null,
  );
  if (!familyId || !canonical || canonical.familyId !== familyId) {
    throw new FamilyMapContextError("map_family_forbidden", 403);
  }
  if (!(await assertFamilyAccess(input.db, input.user.sub, familyId))) {
    throw new FamilyMapContextError("map_family_forbidden", 403);
  }
  const region = await readFamilyRegion(input.db, familyId);
  return {
    userId: input.user.sub,
    familyId,
    role: canonical.role,
    countryCode: region.countryCode,
    policy: region.mapPolicy,
  };
}
