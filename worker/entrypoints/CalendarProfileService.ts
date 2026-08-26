import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "../types";
import type {
  CalendarProfileServiceContract,
  ChildProjectionDto,
} from "../contracts/studyRpc";
import { createCalendarProfileService } from "../lib/studyCalendarProjection";

export class CalendarProfileService
  extends WorkerEntrypoint<Env>
  implements CalendarProfileServiceContract {
  private service(): CalendarProfileServiceContract {
    return createCalendarProfileService(this.env);
  }

  getActiveChildProjection(
    familyId: string,
    memberId: string,
  ): Promise<ChildProjectionDto> {
    return this.service().getActiveChildProjection(familyId, memberId);
  }

  fetchActiveChildAvatar(
    familyId: string,
    memberId: string,
    variant: "study-128",
  ): Promise<Response> {
    return this.service().fetchActiveChildAvatar(familyId, memberId, variant);
  }
}
