import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import test from "node:test";

const safety = await import("../lib/contentSafety.ts");
const memoSource = await readFile(new URL("../routes/memos.ts", import.meta.url), "utf8");
const aiSource = await readFile(new URL("../routes/ai-chat-data.ts", import.meta.url), "utf8");
const pushSource = await readFile(new URL("../routes/push-notify.ts", import.meta.url), "utf8");

class Statement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }
  bind(...bindings) { return new Statement(this.db, this.sql, bindings); }
  async first() { return this.db.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.bindings) }; }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.bindings);
    return { meta: { changes: Number(result.changes) } };
  }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE user_interaction_blocks(
      family_id TEXT NOT NULL,
      blocker_user_id TEXT NOT NULL,
      blocked_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(family_id, blocker_user_id, blocked_user_id)
    );
    CREATE TABLE user_feedback(
      id TEXT PRIMARY KEY,
      family_id TEXT,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      error_logs TEXT,
      device_info TEXT,
      current_screen TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL
    );
  `);
  return {
    sqlite,
    db: { prepare: (sql) => new Statement(sqlite, sql) },
  };
}

test("신고 사유는 유형별 allowlist와 길이 제한으로 정규화한다", () => {
  assert.deepEqual(
    safety.normalizeContentReportInput("ai", { reason: "asks_personal_info", detail: "  전화번호를 물었어  " }),
    { reason: "asks_personal_info", detail: "전화번호를 물었어" },
  );
  assert.equal(safety.normalizeContentReportInput("ai", { reason: "harassment" }), null);
  assert.equal(safety.normalizeContentReportInput("memo", { reason: "asks_personal_info" }), null);
  assert.equal(safety.normalizeContentReportInput("memo", { reason: "harassment", detail: "x".repeat(501) }), null);
});

test("콘텐츠 신고는 원문 없이 결정적 ID로 한 번만 운영 큐에 저장한다", async () => {
  const { db, sqlite } = createDb();
  const first = await safety.insertContentReport(db, {
    kind: "ai",
    familyId: "family-a",
    reporterUserId: "child-a",
    contentId: "message-a",
    reportedUserId: null,
    reason: "inaccurate",
    detail: "답이 달라",
    currentScreen: "/child/ai-friend",
  });
  const second = await safety.insertContentReport(db, {
    kind: "ai",
    familyId: "family-a",
    reporterUserId: "child-a",
    contentId: "message-a",
    reportedUserId: null,
    reason: "other",
    detail: "중복",
    currentScreen: "/child/ai-friend",
  });
  assert.deepEqual(first, { id: "ai-report:child-a:message-a", duplicate: false });
  assert.deepEqual(second, { id: "ai-report:child-a:message-a", duplicate: true });
  const row = sqlite.prepare("SELECT * FROM user_feedback").get();
  assert.equal(row.type, "ai_content_report");
  assert.equal(row.status, "new");
  const payload = JSON.parse(row.message);
  assert.deepEqual(payload, {
    kind: "ai",
    contentId: "message-a",
    reportedUserId: null,
    reason: "inaccurate",
    detail: "답이 달라",
  });
  assert.equal("content" in payload, false);
});

test("메모 차단은 양 방향 상호작용에서 해당 상대만 제외하고 안전 수신자는 유지한다", async () => {
  const { db, sqlite } = createDb();
  sqlite.prepare("INSERT INTO user_interaction_blocks VALUES (?,?,?,?)")
    .run("family-a", "parent-a", "child-a", "2026-07-14T00:00:00.000Z");
  sqlite.prepare("INSERT INTO user_interaction_blocks VALUES (?,?,?,?)")
    .run("family-a", "child-b", "parent-a", "2026-07-14T00:00:00.000Z");

  assert.deepEqual(
    await safety.filterMemoRecipientIdsByBlocks(db, "family-a", "parent-a", ["child-a", "child-b", "parent-b"]),
    ["parent-b"],
  );
  assert.deepEqual(
    await safety.filterMemoRecipientIdsByBlocks(db, "family-a", "parent-b", ["child-a", "child-b"]),
    ["child-a", "child-b"],
  );
});

test("내가 차단한 사용자만 목록으로 돌려주고 상대의 차단 여부는 노출하지 않는다", async () => {
  const { db, sqlite } = createDb();
  sqlite.prepare("INSERT INTO user_interaction_blocks VALUES (?,?,?,?)")
    .run("family-a", "parent-a", "child-a", "2026-07-14T00:00:00.000Z");
  sqlite.prepare("INSERT INTO user_interaction_blocks VALUES (?,?,?,?)")
    .run("family-a", "child-b", "parent-a", "2026-07-14T00:00:00.000Z");
  assert.deepEqual(await safety.listBlockedUserIds(db, "family-a", "parent-a"), ["child-a"]);
});

test("self 계정 삭제는 차단 관계·본인 신고를 지우고 타인 신고의 피신고자 ID를 익명화한다", async () => {
  const { db, sqlite } = createDb();
  sqlite.prepare("INSERT INTO user_interaction_blocks VALUES (?,?,?,?)")
    .run("family-a", "parent-a", "child-a", "2026-07-14T00:00:00.000Z");
  sqlite.prepare("INSERT INTO user_interaction_blocks VALUES (?,?,?,?)")
    .run("family-a", "child-b", "parent-a", "2026-07-14T00:00:00.000Z");
  sqlite.prepare("INSERT INTO user_feedback VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run("own-report", "family-a", "parent-a", "memo_content_report", JSON.stringify({ reportedUserId: "child-a" }), null, null, "/memo", "new", "2026-07-14");
  sqlite.prepare("INSERT INTO user_feedback VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run("other-report", "family-a", "child-b", "memo_content_report", JSON.stringify({ reportedUserId: "parent-a", reason: "harassment" }), null, null, "/memo", "new", "2026-07-14");

  for (const statement of safety.deleteUserContentSafetyStateStmts(db, "parent-a")) {
    await statement.run();
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM user_interaction_blocks").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM user_feedback WHERE id='own-report'").get().count, 0);
  const retained = JSON.parse(sqlite.prepare("SELECT message FROM user_feedback WHERE id='other-report'").get().message);
  assert.equal(retained.reportedUserId, null);
  assert.equal(retained.reason, "harassment");
});

test("AI와 메모 신고 route는 인증·소유권을 검사하고 원문을 신고 행에 복제하지 않는다", () => {
  assert.match(aiSource, /aiData\.post\("\/messages\/:id\/report", requireAuth/);
  assert.match(aiSource, /role = 'assistant'/);
  assert.match(aiSource, /insertContentReport/);
  assert.match(memoSource, /memos\.post\("\/replies\/:id\/report", requireAuth/);
  assert.match(memoSource, /resolveMemoThreadScope/);
  assert.match(memoSource, /row\.user_id === user\.sub/);
  assert.doesNotMatch(memoSource, /insertContentReport\([\s\S]{0,500}content:\s*row\.content/);
});

test("메모 조회·푸시·pending은 차단 관계를 공통 helper로 적용하고 SOS에는 적용하지 않는다", () => {
  assert.match(memoSource, /user_interaction_blocks/);
  assert.match(memoSource, /UPDATE pending_notifications[\s\S]{0,500}'new_memo'/);
  assert.match(memoSource, /delivered = 1, delivered_at = \?/);
  assert.match(pushSource, /loadUnblockedMemoRecipientIds/);
  const memoBlockIndex = pushSource.indexOf("const unblockedRecipientIds = await loadUnblockedMemoRecipientIds");
  const parentAlertIndex = pushSource.indexOf("let parentRecipientIds");
  assert.ok(memoBlockIndex >= 0 && memoBlockIndex < parentAlertIndex);
  assert.doesNotMatch(pushSource.slice(parentAlertIndex), /loadUnblockedMemoRecipientIds/);
});

test("레거시 메모 쓰기는 read-only로 폐쇄해 차단·신고를 우회하지 않는다", () => {
  const legacyStart = memoSource.indexOf('memos.put("/"');
  const repliesStart = memoSource.indexOf('memos.post("/replies"');
  assert.ok(legacyStart >= 0 && repliesStart > legacyStart);
  const legacyPut = memoSource.slice(legacyStart, repliesStart);
  assert.match(legacyPut, /legacy_memo_read_only/);
  assert.match(legacyPut, /410/);
  assert.doesNotMatch(legacyPut, /notifyPg/);
  assert.doesNotMatch(legacyPut, /INSERT INTO memos|UPDATE memos/);
});

test("메모 차단·해제는 원문 없는 정책 변경 이벤트로 양쪽 캐시를 즉시 무효화한다", () => {
  const blockStart = memoSource.indexOf('memos.post("/blocks"');
  const unblockStart = memoSource.indexOf('memos.delete("/blocks/:targetUserId"');
  assert.ok(blockStart >= 0 && unblockStart > blockStart);
  const blockRoute = memoSource.slice(blockStart, unblockStart);
  const unblockRoute = memoSource.slice(unblockStart, memoSource.indexOf('memos.post("/replies/:id/read"'));
  for (const route of [blockRoute, unblockRoute]) {
    assert.match(route, /notifyPg[\s\S]*"memo_replies"[\s\S]*"UPDATE"/);
    assert.match(route, /family_id:\s*familyId/);
    assert.doesNotMatch(route, /notifyPg[\s\S]{0,250}content:/);
  }
});
