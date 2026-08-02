// 구독(subscriptions) read API. childSubscriptions.js useChildSubscriptions 의
// `from("subscriptions").select("*").eq("family_id", ...)` 를 D1 로 직역.
// RLS(가족 단위 select)는 assertFamilyAccess 로 대체. timestamptz 컬럼은 클라가
// new Date() 로 파싱하므로 pg COPY 형식('공백 + +00')을 ISO 로 정규화해 돌려준다.
import { Hono } from "hono";
import type { Env, Vars } from "../types";
import { requireAuth } from "../middleware/auth";
import { assertFamilyAccess } from "../db/authz";
import { pgToIso } from "../lib/time";

const subs = new Hono<{ Bindings: Env; Variables: Vars }>();

const TS_COLS = ["expires_at", "created_at", "updated_at"] as const;

// GET /api/subscriptions?family_id=... — 가족의 자녀별 구독 행 전체
subs.get("/", requireAuth, async (c) => {
  const uid = c.get("user").sub;
  const familyId = c.req.query("family_id") ?? "";
  if (!(await assertFamilyAccess(c.env.DB, uid, familyId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM subscriptions WHERE family_id = ?`,
  )
    .bind(familyId)
    .all<Record<string, unknown>>();

  const out = (results ?? []).map((row) => {
    const next = { ...row };
    for (const col of TS_COLS) {
      if (next[col] != null) next[col] = pgToIso(next[col] as string);
    }
    return next;
  });
  return c.json(out);
});

export default subs;
