import assert from "node:assert/strict";
import test from "node:test";

function projectionDatabase(rows) {
  return {
    prepare(sql) {
      assert.match(sql, /family_id=\?1/);
      assert.match(sql, /id=\?2/);
      assert.match(sql, /role='child'/);
      assert.match(sql, /is_active=1/);
      return {
        bind(familyId, memberId) {
          return {
            async first() {
              return rows.find((row) => row.family_id === familyId && row.id === memberId && row.role === "child" && row.is_active === 1) ?? null;
            },
          };
        },
      };
    },
  };
}

test("자녀 projection은 정확한 활성 family/member만 반환한다", async () => {
  const { getActiveChildProjection } = await import("../lib/studyCalendarProjection.ts");
  const db = projectionDatabase([
    {
      id: "active-child",
      family_id: "family-a",
      role: "child",
      is_active: 1,
      name: "활성 아이",
      photo_url: "family-a/uploads/active-child/private-photo-key.webp",
      created_at: "2026-08-27T00:00:00.000Z",
      birthdate: "2015-05-01",
      user_id: "child-user-id",
    },
    {
      id: "inactive-child",
      family_id: "family-a",
      role: "child",
      is_active: 0,
      name: "비활성 아이",
      photo_url: null,
      created_at: "2026-08-26T00:00:00.000Z",
    },
    {
      id: "other-family-child",
      family_id: "family-b",
      role: "child",
      is_active: 1,
      name: "다른 가족 아이",
      photo_url: null,
      created_at: "2026-08-25T00:00:00.000Z",
    },
  ]);

  const active = await getActiveChildProjection(db, "family-a", "active-child");
  assert.deepEqual(active, {
    apiVersion: "2026-08-27",
    status: "active",
    memberId: "active-child",
    displayName: "활성 아이",
    hasAvatar: true,
    revision: "2026-08-27T00:00:00.000Z",
  });
  assert.equal("birthdate" in active, false);
  assert.equal("userId" in active, false);
  assert.equal("photoUrl" in active, false);

  assert.deepEqual(await getActiveChildProjection(db, "family-a", "inactive-child"), {
    apiVersion: "2026-08-27",
    status: "inactive_or_missing",
    memberId: "inactive-child",
  });
  assert.deepEqual(await getActiveChildProjection(db, "family-a", "other-family-child"), {
    apiVersion: "2026-08-27",
    status: "inactive_or_missing",
    memberId: "other-family-child",
  });
});
