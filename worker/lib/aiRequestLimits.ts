import { MAX_STORAGE_OBJECT_BYTES } from "./storageObjectValidation";

// 기존 첨부 저장소의 8MiB 원본 상한을 base64 data URL로 감쌀 수 있는 크기다.
export const MAX_AI_IMAGE_DATA_URL_CHARS = Math.ceil(MAX_STORAGE_OBJECT_BYTES * 4 / 3) + 256;
export const MAX_AI_JSON_BYTES = 12 * 1024 * 1024;
export const MAX_VOICE_PARSE_TEXT_CHARS = 20_000;
export const MAX_VOICE_PARSE_ACADEMIES = 100;
export const MAX_VOICE_PARSE_TODAY_EVENTS = 200;
export const MAX_CHILD_MONITOR_EVENTS = 200;

export type AiJsonReadResult =
  | { ok: true; value: unknown }
  | { ok: false; error: "payload_too_large" | "invalid_json" };

export type AiInputValidationResult =
  | { ok: true }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalStringWithin(value: unknown, maxChars: number): boolean {
  return value === undefined || (typeof value === "string" && value.length <= maxChars);
}

function optionalNullableStringWithin(value: unknown, maxChars: number): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.length <= maxChars);
}

function boundedRecordArray(
  value: unknown,
  maxItems: number,
  validate: (row: Record<string, unknown>) => boolean,
): "ok" | "too_large" | "invalid" {
  if (value === undefined) return "ok";
  if (!Array.isArray(value)) return "invalid";
  if (value.length > maxItems) return "too_large";
  return value.every((row) => isRecord(row) && validate(row)) ? "ok" : "invalid";
}

/** Content-Length를 신뢰하지 않고 maxBytes+1 전에 스트림을 취소하는 AI JSON reader. */
export async function readBoundedAiJson(
  request: Request,
  maxBytes = MAX_AI_JSON_BYTES,
): Promise<AiJsonReadResult> {
  const rawLength = request.headers.get("Content-Length");
  if (rawLength !== null) {
    const declaredLength = Number(rawLength);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return { ok: false, error: "payload_too_large" };
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, error: "invalid_json" };
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let total = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // 스트림 취소 실패가 크기 초과 판정을 바꾸면 안 된다.
        }
        return { ok: false, error: "payload_too_large" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

export function validateVoiceParseInput(value: unknown): AiInputValidationResult {
  if (!isRecord(value)) return { ok: false, error: "invalid_voice_parse_input" };
  if (!optionalStringWithin(value.text, MAX_VOICE_PARSE_TEXT_CHARS)) {
    return { ok: false, error: "voice_parse_text_too_large" };
  }
  if (!optionalStringWithin(value.image, MAX_AI_IMAGE_DATA_URL_CHARS)) {
    return { ok: false, error: "voice_parse_image_too_large" };
  }
  if (!optionalStringWithin(value.mode, 20) || !optionalStringWithin(value.feature, 40)) {
    return { ok: false, error: "invalid_voice_parse_input" };
  }

  const academies = boundedRecordArray(value.academies, MAX_VOICE_PARSE_ACADEMIES, (row) =>
    optionalStringWithin(row.name, 120) && optionalStringWithin(row.category, 40));
  if (academies === "too_large") return { ok: false, error: "voice_parse_academies_too_large" };
  if (academies === "invalid") return { ok: false, error: "invalid_voice_parse_input" };

  const events = boundedRecordArray(value.todayEvents, MAX_VOICE_PARSE_TODAY_EVENTS, (row) =>
    optionalStringWithin(row.id, 200)
      && optionalStringWithin(row.title, 200)
      && optionalNullableStringWithin(row.time, 32)
      && optionalStringWithin(row.memo, 1_000));
  if (events === "too_large") return { ok: false, error: "voice_parse_today_events_too_large" };
  if (events === "invalid") return { ok: false, error: "invalid_voice_parse_input" };

  if (value.currentDate !== undefined) {
    if (!isRecord(value.currentDate)) return { ok: false, error: "invalid_voice_parse_input" };
    for (const key of ["year", "month", "day"] as const) {
      const field = value.currentDate[key];
      if (field !== undefined && (typeof field !== "number" || !Number.isInteger(field))) {
        return { ok: false, error: "invalid_voice_parse_input" };
      }
    }
  }
  return { ok: true };
}

export function validateChildMonitorInput(value: unknown): AiInputValidationResult {
  if (!isRecord(value)) return { ok: false, error: "invalid_child_monitor_input" };
  if (!optionalStringWithin(value.familyId, 200)
    || !optionalStringWithin(value.analysisType, 40)
    || !optionalStringWithin(value.memoText, 4_000)
    || !optionalStringWithin(value.childName, 80)
    || !optionalStringWithin(value.eventTitle, 200)) {
    return { ok: false, error: "child_monitor_field_too_large" };
  }

  const events = boundedRecordArray(value.events, MAX_CHILD_MONITOR_EVENTS, (row) =>
    optionalStringWithin(row.title, 200)
      && optionalStringWithin(row.time, 32)
      && (row.arrivedOnTime === undefined || typeof row.arrivedOnTime === "boolean")
      && (row.arrivalDelay === undefined
        || (typeof row.arrivalDelay === "number" && Number.isFinite(row.arrivalDelay))));
  if (events === "too_large") return { ok: false, error: "child_monitor_events_too_large" };
  if (events === "invalid") return { ok: false, error: "invalid_child_monitor_input" };
  return { ok: true };
}
