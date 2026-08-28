import { WorkerEntrypoint } from "cloudflare:workers";
import type { CalendarChildProjectionDto } from "../contracts/studyRpc";
import { getActiveChildProjection } from "../lib/studyCalendarProjection";
import type { Env } from "../types";

/** Study Worker가 Calendar 정본에서 최소 활성 자녀 표시값만 읽는 RPC entrypoint다. */
export class CalendarProfileService extends WorkerEntrypoint<Env> {
  getActiveChildProjection(familyId: string, memberId: string): Promise<CalendarChildProjectionDto> {
    return getActiveChildProjection(this.env.DB, familyId, memberId);
  }
}
