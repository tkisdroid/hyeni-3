import type { CalendarStudyServiceBinding } from "../contracts/studyRpc";
import type { Env } from "../types";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;
type Assert<Condition extends true> = Condition;

type StudyServiceMustStayNarrow = Assert<Equal<Env["STUDY_SERVICE"], CalendarStudyServiceBinding>>;
type StudyHmacSecretMustStayRequiredString = Assert<Equal<Env["STUDY_RPC_HMAC_SECRET"], string>>;

void (0 as unknown as StudyServiceMustStayNarrow);
void (0 as unknown as StudyHmacSecretMustStayRequiredString);
