-- One-time cleanup for the active-device isolation fix.
-- Existing families may already have DUPLICATE child members from prior re-pairs
-- (Path C created "혜니 2" and left the old "혜니" row intact). This picks ONE active
-- member per (family, name-slot) — the one with the most-recent location — and marks
-- the rest is_active=0 so they stop leaking alerts / map / route to the parent.
--
-- Slot key = rtrim(name, ' 0123456789') strips the trailing " N" suffix
-- (혜니 2 -> 혜니). Caveat: a legitimate name ending in digits WITHOUT a space
-- (e.g. 아이2) also collapses to its base — RUN THE DIAGNOSTIC FIRST and eyeball.
--
-- ORDER: run AFTER family-members-is-active.sql (needs the is_active column).
-- Run (prod):
--   cd worker && npx wrangler d1 execute hyeni-calendar --remote --file db/family-members-active-cleanup.sql
-- Idempotent: re-running reproduces the same winners unless locations change.
--
-- ── DIAGNOSTIC (run this SEPARATELY first, read-only) ──────────────────────────
-- SELECT fm.family_id,
--        rtrim(fm.name, ' 0123456789') AS slot,
--        COUNT(*) AS members,
--        GROUP_CONCAT(fm.name || '#' || fm.user_id || '#active=' || fm.is_active, ' | ') AS rows
-- FROM family_members fm
-- WHERE fm.role='child' AND fm.user_id IS NOT NULL
-- GROUP BY fm.family_id, rtrim(fm.name, ' 0123456789')
-- HAVING COUNT(*) > 1
-- ORDER BY fm.family_id;

WITH slotted AS (
  SELECT fm.id, fm.family_id,
         rtrim(fm.name, ' 0123456789') AS slot,
         COALESCE(
           (SELECT MAX(substr(cl.updated_at, 1, 19))
              FROM child_locations cl WHERE cl.user_id = fm.user_id),
           (SELECT MAX(substr(ls.last_location_at, 1, 19))
              FROM child_location_link_state ls
             WHERE ls.child_user_id = fm.user_id AND ls.family_id = fm.family_id),
           substr(fm.created_at, 1, 19)
         ) AS rank_ts
  FROM family_members fm
  WHERE fm.role='child' AND fm.user_id IS NOT NULL
),
ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY family_id, slot
           ORDER BY rank_ts DESC, id DESC
         ) AS rn
  FROM slotted
)
UPDATE family_members
   SET is_active = CASE WHEN id IN (SELECT id FROM ranked WHERE rn = 1) THEN 1 ELSE 0 END
 WHERE role='child' AND user_id IS NOT NULL;
