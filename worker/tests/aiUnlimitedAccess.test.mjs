// AI 친구 대화 무제한 가족 회귀(2026-08-17 TK 지시 — 운영자 본인 계정).
//
// 계약:
//  · secret 미설정이면 아무도 무제한이 아니다(fail-closed).
//  · 판정 기준은 가족을 소유한 부모 계정이다(재페어링해도 유효).
//  · 결제 상태(family_subscription)를 조작하지 않는다.
import "./helpers/tsModuleResolve.mjs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { isAiUnlimitedFamily, parseAiUnlimitedOwnerIds } = await import("../lib/aiUnlimitedAccess.ts");

const OWNER = "a41278ce-82f4-4d5d-9285-fd049565827f";
const FAMILY = "f9a75cb4-07e5-4597-b090-526e9ea4ab4e";

function fakeDb(parentIdByFamily) {
  return {
    prepare() {
      return {
        bind(id) {
          return { first: async () => (id in parentIdByFamily ? { parent_id: parentIdByFamily[id] } : null) };
        },
      };
    },
  };
}

test("목록 파서는 콤마·공백·줄바꿈을 받고 대소문자를 무시한다", () => {
  const parsed = parseAiUnlimitedOwnerIds(` ${OWNER.toUpperCase()} , x-1\ny-2;z-3 `);
  assert.equal(parsed.has(OWNER), true);
  assert.deepEqual([...parsed].sort(), [OWNER, "x-1", "y-2", "z-3"].sort());
  for (const bad of [undefined, null, "", "   ", 42]) {
    assert.equal(parseAiUnlimitedOwnerIds(bad).size, 0);
  }
});

test("secret 미설정이면 아무도 무제한이 아니다(fail-closed)", async () => {
  const db = fakeDb({ [FAMILY]: OWNER });
  for (const env of [{}, { AI_UNLIMITED_OWNER_IDS: "" }, { AI_UNLIMITED_OWNER_IDS: "   " }]) {
    assert.equal(await isAiUnlimitedFamily(env, db, FAMILY), false);
  }
});

test("소유 부모가 목록에 있는 가족만 무제한이다", async () => {
  const env = { AI_UNLIMITED_OWNER_IDS: OWNER };
  const db = fakeDb({ [FAMILY]: OWNER, "other-family": "someone-else" });
  assert.equal(await isAiUnlimitedFamily(env, db, FAMILY), true);
  // 대소문자가 달라도 같은 계정으로 본다.
  assert.equal(await isAiUnlimitedFamily({ AI_UNLIMITED_OWNER_IDS: OWNER.toUpperCase() }, db, FAMILY), true);
  // 남의 가족은 열리지 않는다.
  assert.equal(await isAiUnlimitedFamily(env, db, "other-family"), false);
  // 없는 가족·빈 값도 닫는다.
  assert.equal(await isAiUnlimitedFamily(env, db, "no-such-family"), false);
  assert.equal(await isAiUnlimitedFamily(env, db, ""), false);
});

test("조회 실패는 무제한으로 열지 않는다", async () => {
  const env = { AI_UNLIMITED_OWNER_IDS: OWNER };
  const brokenDb = { prepare() { throw new Error("d1 down"); } };
  assert.equal(await isAiUnlimitedFamily(env, brokenDb, FAMILY), false);
});

test("무제한은 한도 통과와 차감 생략을 함께 적용하고 결제 상태를 건드리지 않는다", async () => {
  const [route, lib] = await Promise.all([
    readFile(resolve(workerDir, "routes/ai-child-chat.ts"), "utf8"),
    readFile(resolve(workerDir, "lib/aiUnlimitedAccess.ts"), "utf8"),
  ]);
  // 한도 게이트 통과
  assert.match(route, /shouldBypassAiCreditLimit\(\{ safety: agentPlan\.safety \}\) \|\| aiUnlimited/);
  // 차감 생략
  assert.match(route, /const shouldChargeCredit =\s*\r?\n?\s*!aiUnlimited/);
  // 화면이 무제한을 알 수 있어야 한다
  assert.match(route, /unlimited: aiUnlimited/);
  // 구독·결제 테이블을 쓰지 않는다(스토어 결제 정본과 어긋나면 안 된다).
  // 주석 언급까지 잡지 않도록 실제 SQL 문자열만 본다.
  const sql = [...lib.matchAll(/\.prepare\(\s*(["'`])([\s\S]*?)\1\s*\)/g)].map((m) => m[2]);
  assert.equal(sql.length, 1, "쿼리는 소유 계정 조회 하나여야 한다");
  assert.match(sql[0], /^SELECT parent_id FROM families WHERE id = \? LIMIT 1$/);
  for (const statement of sql) {
    assert.doesNotMatch(statement, /\b(INSERT|UPDATE|DELETE)\b/i, "무제한 판정은 읽기 전용이다");
    assert.doesNotMatch(statement, /family_subscription|user_tier/i);
  }
});

test("공개 상태 endpoint 도 무제한을 내려준다", async () => {
  const data = await readFile(resolve(workerDir, "routes/ai-chat-data.ts"), "utf8");
  assert.match(data, /isAiUnlimitedFamily\(c\.env, c\.env\.DB, familyId\)/);
  assert.match(data, /^\s*unlimited,$/m);
});
