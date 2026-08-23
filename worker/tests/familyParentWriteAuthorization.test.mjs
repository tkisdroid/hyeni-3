import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const typeScriptResolutionHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !extname(specifier)) {
      const base = new URL(specifier, context.parentURL);
      for (const extension of [".ts", ".js"]) {
        const candidate = new URL(`${base.href}${extension}`);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

after(() => typeScriptResolutionHook.deregister());

const authz = await import(pathToFileURL(resolve(workerDir, "db/authz.ts")).href);

class D1StatementAdapter {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new D1StatementAdapter(this.db, this.sql, bindings);
  }

  async first() {
    return this.db.prepare(this.sql).get(...this.bindings) ?? null;
  }
}

class D1DatabaseAdapter {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new D1StatementAdapter(this.db, sql);
  }
}

test("가족 쓰기 권한은 주 보호자와 활성 공동 보호자에게만 열린다", async () => {
  assert.equal(typeof authz.assertFamilyParent, "function");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE families(id TEXT PRIMARY KEY, parent_id TEXT NOT NULL);
    CREATE TABLE family_members(
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      user_id TEXT,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );
    INSERT INTO families VALUES ('family-a', 'parent-primary');
    INSERT INTO family_members VALUES ('parent-active', 'family-a', 'parent-coparent', 'parent', 1);
    INSERT INTO family_members VALUES ('parent-inactive', 'family-a', 'parent-old', 'parent', 0);
    INSERT INTO family_members VALUES ('child-active', 'family-a', 'child-a', 'child', 1);
  `);
  const db = new D1DatabaseAdapter(sqlite);

  assert.equal(await authz.assertFamilyParent(db, "parent-primary", "family-a"), true);
  assert.equal(await authz.assertFamilyParent(db, "parent-coparent", "family-a"), true);
  assert.equal(await authz.assertFamilyParent(db, "parent-old", "family-a"), false);
  assert.equal(await authz.assertFamilyParent(db, "child-a", "family-a"), false);
  assert.equal(await authz.assertFamilyParent(db, "parent-coparent", "family-b"), false);
  sqlite.close();
});
