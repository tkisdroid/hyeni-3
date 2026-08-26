// 서비스 전역 설정(app_global_settings) 읽기·쓰기.
//
// 첫 사용처는 아이 AI 친구의 "운영자 지침" 프롬프트다. 모든 가족의 아이 대화에 함께
// 들어가므로 읽기는 hot path(대화 1건당 1회)이고, 쓰기는 관리자만 한다.
import { pgNow } from "./time.ts";

export const AI_CHILD_OPERATOR_PROMPT_KEY = "ai_child_operator_prompt";
export const STUDY_MANAGEMENT_ENABLED_KEY = "study_management_enabled";

/** 운영자 지침 최대 길이 — 시스템 프롬프트 전체를 압도하지 않도록 제한한다. */
export const OPERATOR_PROMPT_MAX_LENGTH = 4000;

export interface GlobalSettingRecord {
  value: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

const LINE_FEED = 0x0a;
const TAB = 0x09;
const DEL = 0x7f;
const C1_START = 0x80;
const C1_END = 0x9f;

/**
 * 제어문자 제거 — 개행·탭만 남긴다(문단 구분이 지침의 의미다).
 * 정규식에 제어문자 리터럴을 쓰면 소스에 raw 바이트가 박히므로 코드포인트로 판정한다.
 */
function stripControlCharacters(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === LINE_FEED || code === TAB) {
      out += ch;
      continue;
    }
    const isControl = code < 0x20 || code === DEL || (code >= C1_START && code <= C1_END);
    if (isControl) continue;
    out += ch;
  }
  return out;
}

/**
 * 운영자 입력 정규화 — 모델에 그대로 들어가는 문자열이라 경계에서 다듬는다.
 * 제어문자를 남기면 프롬프트 구조를 깨거나 로그를 오염시킬 수 있다.
 */
export function normalizeOperatorPrompt(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const unified = raw.split("\r\n").join("\n");
  return stripControlCharacters(unified).trim().slice(0, OPERATOR_PROMPT_MAX_LENGTH);
}

async function ensureTable(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS app_global_settings (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL DEFAULT '',
       updated_by TEXT,
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  ).run();
}

export async function readGlobalSetting(
  db: D1Database,
  key: string,
): Promise<GlobalSettingRecord> {
  const empty: GlobalSettingRecord = { value: "", updatedBy: null, updatedAt: null };
  if (!key) return empty;
  try {
    const row = await db
      .prepare("SELECT value, updated_by, updated_at FROM app_global_settings WHERE key = ? LIMIT 1")
      .bind(key)
      .first<{ value: string; updated_by: string | null; updated_at: string | null }>();
    if (!row) return empty;
    return {
      value: typeof row.value === "string" ? row.value : "",
      updatedBy: row.updated_by ?? null,
      updatedAt: row.updated_at ?? null,
    };
  } catch (error) {
    // 마이그레이션 전이거나 D1 일시 오류 — 전역 지침이 없는 것으로 보고 아이 대화를 막지 않는다.
    console.error("[global-settings] read failed");
    return empty;
  }
}

export async function writeGlobalSetting(
  db: D1Database,
  key: string,
  value: string,
  updatedBy: string | null,
): Promise<GlobalSettingRecord> {
  await ensureTable(db);
  const now = pgNow();
  await db
    .prepare(
      `INSERT INTO app_global_settings (key, value, updated_by, updated_at)
       VALUES (?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                      updated_by = excluded.updated_by,
                                      updated_at = excluded.updated_at`,
    )
    .bind(key, value, updatedBy, now)
    .run();
  return { value, updatedBy, updatedAt: now };
}
