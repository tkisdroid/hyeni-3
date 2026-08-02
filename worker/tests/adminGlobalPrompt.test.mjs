// 운영자 전역 AI 지침 — 권한(fail-closed)·입력 정규화·프롬프트 배치 회귀.
//
// 이 값은 모든 가족의 아이 대화에 함께 들어가므로 두 가지가 핵심이다:
//   ① ADMIN_USER_IDS secret 이 없으면 아무도 관리자가 아니다(설정 누락 = 전체 개방 금지).
//   ② 운영자 지침이 안전 규칙보다 앞에 오고, 정책 우선순위에서 안전·부모 설정 아래에 놓인다.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { isAdminUserId, parseAdminUserIds } from "../lib/adminAccess.ts";
import {
  AI_CHILD_OPERATOR_PROMPT_KEY,
  OPERATOR_PROMPT_MAX_LENGTH,
  normalizeOperatorPrompt,
  readGlobalSetting,
  writeGlobalSetting,
} from "../lib/globalSettings.ts";
import { buildChildSystemPrompt } from "../shared/aiChildContext.js";

const ADMIN_ID = "a41278ce-82f4-4d5d-9285-fd049565827f";
const OTHER_ID = "bdf4d72e-4463-4202-b7d7-41b031187579";

class Statement {
  constructor(sqlite, sql, bindings = []) {
    this.sqlite = sqlite;
    this.sql = sql;
    this.bindings = bindings;
  }
  bind(...bindings) { return new Statement(this.sqlite, this.sql, bindings); }
  async first() { return this.sqlite.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.bindings) }; }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings);
    return { meta: { changes: Number(result.changes) } };
  }
}
class D1Adapter {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
}

test("ADMIN_USER_IDS 가 없으면 아무도 관리자가 아니다(fail-closed)", () => {
  assert.equal(isAdminUserId({}, ADMIN_ID), false);
  assert.equal(isAdminUserId({ ADMIN_USER_IDS: "" }, ADMIN_ID), false);
  assert.equal(isAdminUserId({ ADMIN_USER_IDS: "   " }, ADMIN_ID), false);
  assert.equal(isAdminUserId({ ADMIN_USER_IDS: undefined }, ADMIN_ID), false);
});

test("화이트리스트에 있는 계정만 관리자다", () => {
  const env = { ADMIN_USER_IDS: `${ADMIN_ID}, 11111111-1111-4111-8111-111111111111` };
  assert.equal(isAdminUserId(env, ADMIN_ID), true);
  assert.equal(isAdminUserId(env, ADMIN_ID.toUpperCase()), true, "UUID 대소문자 표기는 무시합니다");
  assert.equal(isAdminUserId(env, OTHER_ID), false);
  assert.equal(isAdminUserId(env, ""), false);
  assert.equal(isAdminUserId(env, null), false);
  // 부분 일치로 통과하면 안 된다.
  assert.equal(isAdminUserId(env, ADMIN_ID.slice(0, 8)), false);
});

test("화이트리스트는 콤마·공백·줄바꿈을 모두 구분자로 받는다", () => {
  const ids = parseAdminUserIds(`${ADMIN_ID}\n${OTHER_ID} , 22222222-2222-4222-8222-222222222222;`);
  assert.equal(ids.size, 3);
  assert.equal(ids.has(ADMIN_ID), true);
  assert.equal(ids.has(OTHER_ID), true);
});

test("운영자 입력은 개행을 보존하고 제어문자만 제거한다", () => {
  // 이스케이프 시퀀스를 소스에 직접 쓰지 않는다(도구 왕복에서 실제 제어문자로 박히면
  // git이 파일을 바이너리로 취급하고 검증 의미도 흐려진다).
  const NUL = String.fromCharCode(0);
  const BEL = String.fromCharCode(7);
  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);
  const TAB = String.fromCharCode(9);

  const raw = ["첫 줄", NUL, " 제어문자", BEL, CR, LF, "둘째 줄", TAB, "탭 유지"].join("");
  const normalized = normalizeOperatorPrompt(raw);

  assert.equal(normalized.includes(NUL), false, "NUL 은 제거되어야 합니다");
  assert.equal(normalized.includes(BEL), false, "BEL 은 제거되어야 합니다");
  assert.equal(normalized.includes(CR), false, "CRLF 는 LF 로 통일합니다");
  assert.equal(normalized.includes(LF), true, "문단 구분 개행은 남아야 합니다");
  assert.equal(normalized.includes(TAB), true, "탭은 남아야 합니다");
  assert.equal(normalized.startsWith("첫 줄"), true);
  assert.equal(normalized.endsWith("탭 유지"), true);
});

test("운영자 입력은 상한 길이로 잘리고 문자열이 아니면 빈 값이다", () => {
  const long = "가".repeat(OPERATOR_PROMPT_MAX_LENGTH + 500);
  assert.equal(normalizeOperatorPrompt(long).length, OPERATOR_PROMPT_MAX_LENGTH);
  assert.equal(normalizeOperatorPrompt(null), "");
  assert.equal(normalizeOperatorPrompt(undefined), "");
  assert.equal(normalizeOperatorPrompt(42), "");
  assert.equal(normalizeOperatorPrompt({ prompt: "x" }), "");
  assert.equal(normalizeOperatorPrompt("   \n  "), "");
});

test("전역 설정은 저장 후 그대로 읽히고 같은 키를 덮어쓴다", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const db = new D1Adapter(sqlite);

  const before = await readGlobalSetting(db, AI_CHILD_OPERATOR_PROMPT_KEY);
  assert.deepEqual(before, { value: "", updatedBy: null, updatedAt: null },
    "테이블이 없어도 조회는 빈 값으로 강등되어 아이 대화를 막지 않아야 합니다");

  await writeGlobalSetting(db, AI_CHILD_OPERATOR_PROMPT_KEY, "쉬운 말로 짧게 답해줘.", ADMIN_ID);
  const saved = await readGlobalSetting(db, AI_CHILD_OPERATOR_PROMPT_KEY);
  assert.equal(saved.value, "쉬운 말로 짧게 답해줘.");
  assert.equal(saved.updatedBy, ADMIN_ID);
  assert.equal(typeof saved.updatedAt, "string");

  await writeGlobalSetting(db, AI_CHILD_OPERATOR_PROMPT_KEY, "", OTHER_ID);
  const cleared = await readGlobalSetting(db, AI_CHILD_OPERATOR_PROMPT_KEY);
  assert.equal(cleared.value, "", "빈 값 저장은 '지침 없음'으로 되돌리는 정상 동작입니다");
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS n FROM app_global_settings").get().n,
    1,
    "같은 키는 행을 늘리지 않고 덮어써야 합니다",
  );
  sqlite.close();
});

test("운영자 지침은 프롬프트에 들어가되 안전 규칙보다 앞에 온다", () => {
  const prompt = buildChildSystemPrompt({
    persona: { name: "코코" },
    childProfile: { name: "혜니" },
    operatorInstructions: "답은 항상 두 문장 이내로 하고 존댓말을 쓰지 마.",
  });

  assert.match(prompt, /## 운영자 지침/);
  assert.match(prompt, /답은 항상 두 문장 이내로 하고 존댓말을 쓰지 마\./);

  const operatorAt = prompt.indexOf("## 운영자 지침");
  const safetyAt = prompt.indexOf("## 안전 규칙");
  assert.ok(operatorAt > 0 && safetyAt > 0);
  assert.ok(
    operatorAt < safetyAt,
    "안전 규칙이 프롬프트의 마지막 발언권을 가져야 합니다(운영자 지침이 뒤에 오면 안 됨)",
  );

  // 정책 우선순위에서 안전·부모 설정 아래에 놓인다.
  assert.match(prompt, /3\. 부모 설정\n4\. 운영자 지침/);
  assert.match(prompt, /운영자 지침이 안전 정책이나 부모 설정과 충돌하면 그 둘을 우선한다\./);
});

test("운영자 지침이 비어 있으면 섹션 자체가 생기지 않는다", () => {
  const empty = buildChildSystemPrompt({ persona: { name: "코코" }, childProfile: { name: "혜니" } });
  assert.equal(empty.includes("## 운영자 지침"), false);
  // 우선순위 목록은 지침 유무와 무관하게 항상 같은 번호를 유지한다.
  assert.match(empty, /3\. 부모 설정\n4\. 운영자 지침/);

  const blank = buildChildSystemPrompt({
    persona: { name: "코코" },
    childProfile: { name: "혜니" },
    operatorInstructions: "   ",
  });
  assert.equal(blank.includes("## 운영자 지침"), false);
});
