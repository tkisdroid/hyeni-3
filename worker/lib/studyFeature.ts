import {
  STUDY_MANAGEMENT_ENABLED_KEY,
  readGlobalSetting,
} from "./globalSettings";
import type { Env } from "../types";

export type StudyFeatureState = "disabled" | "ready" | "unavailable";

export async function studyFeatureState(env: Env): Promise<StudyFeatureState> {
  const setting = await readGlobalSetting(env.DB, STUDY_MANAGEMENT_ENABLED_KEY);
  if (setting.value.trim().toLowerCase() !== "true") return "disabled";
  return env.STUDY_SERVICE ? "ready" : "unavailable";
}
