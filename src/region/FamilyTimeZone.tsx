import { createContext, useContext } from "react";
import { LEGACY_TIME_ZONE } from "../../shared/timeZone";

/** 인증된 가족의 명시적 시간대. 브라우저 언어 또는 여행 중 위치로 바꾸지 않는다. */
export const FamilyTimeZoneContext = createContext(LEGACY_TIME_ZONE);
export function useFamilyTimeZone(): string {
  return useContext(FamilyTimeZoneContext);
}
