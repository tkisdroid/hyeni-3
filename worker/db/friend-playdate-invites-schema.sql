-- Friend playdate accept handshake.
-- Apply before deploying Worker routes that call /api/playdate/invites.

CREATE TABLE IF NOT EXISTS friend_playdate_invites (
  id TEXT PRIMARY KEY,
  public_place_id TEXT NOT NULL,
  requester_family_id TEXT NOT NULL,
  receiver_family_id TEXT NOT NULL,
  requester_child_id TEXT NOT NULL,
  receiver_child_id TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  session_id TEXT,
  requested_at TEXT NOT NULL,
  responded_at TEXT,
  responded_by TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (requester_family_id <> receiver_family_id),
  CHECK (status IN ('pending', 'accepted', 'declined', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_friend_playdate_invites_requester_status
  ON friend_playdate_invites(requester_family_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_friend_playdate_invites_receiver_status
  ON friend_playdate_invites(receiver_family_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_friend_playdate_invites_requester_child_status
  ON friend_playdate_invites(requester_child_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_friend_playdate_invites_receiver_child_status
  ON friend_playdate_invites(receiver_child_id, status, expires_at);
