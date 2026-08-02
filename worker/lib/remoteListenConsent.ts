const REMOTE_LISTEN_DURATION_MS = 60_000;

function pgTs(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "+00");
}

function pgNow(): string {
  return pgTs(new Date());
}

function pgToMs(value: string | null | undefined): number {
  const raw = String(value ?? "").trim();
  if (!raw) return Number.NaN;
  let normalized = raw.replace(" ", "T");
  if (/[+-]\d{2}$/.test(normalized)) normalized += ":00";
  else if (/[+-]\d{4}$/.test(normalized)) {
    normalized = `${normalized.slice(0, -2)}:${normalized.slice(-2)}`;
  } else if (!/[+-]\d{2}:\d{2}$/.test(normalized) && !normalized.endsWith("Z")) {
    normalized += "Z";
  }
  return Date.parse(normalized);
}

export type RemoteListenConsentResult =
  | {
      ok: true;
      consentedAt: string;
      captureExpiresAt: string;
      captureExpiresAtMs: number;
    }
  | {
      ok: false;
      status: 403 | 409;
      error:
        | "remote_listen_consent_forbidden"
        | "remote_listen_consent_expired"
        | "remote_listen_consent_already_used";
    };

interface RemoteListenConsentInput {
  requestId: string;
  childUserId: string;
  now?: string;
}

interface ConsentCandidate {
  id: string;
  consented_at: string | null;
  capture_expires_at: string | null;
  expires_at: string | null;
}

/** 활성 아이가 실제 요청을 1회 동의한 서버 시각부터 60초 캡처 창을 원자적으로 연다. */
export async function authorizeRemoteListenConsent(
  db: D1Database,
  input: RemoteListenConsentInput,
): Promise<RemoteListenConsentResult> {
  const requestId = input.requestId.trim();
  const childUserId = input.childUserId.trim();
  if (!requestId || !childUserId) {
    return { ok: false, status: 403, error: "remote_listen_consent_forbidden" };
  }

  const now = input.now ?? pgNow();
  const nowMs = pgToMs(now);
  if (!Number.isFinite(nowMs)) {
    return { ok: false, status: 409, error: "remote_listen_consent_expired" };
  }

  const candidate = await db.prepare(
    `SELECT r.id, r.consented_at, r.capture_expires_at, p.expires_at
       FROM remote_listen_sessions r
       JOIN family_members child
         ON child.family_id = r.family_id
        AND child.user_id = r.child_user_id
        AND child.role = 'child'
        AND child.is_active = 1
       JOIN pending_notifications p
         ON p.family_id = r.family_id
        AND json_valid(p.data)
        AND json_extract(p.data, '$.type') = 'remote_listen'
        AND json_extract(p.data, '$.requestId') = r.id
        AND json_extract(p.data, '$.targetUserId') = r.child_user_id
        AND json_extract(p.data, '$.senderUserId') = r.initiator_user_id
      WHERE r.id = ?1
        AND r.child_user_id = ?2
        AND r.ended_at IS NULL
        AND substr(COALESCE(r.started_at, ''), 1, 19)
            <= substr(COALESCE(p.created_at, ''), 1, 19)
      ORDER BY substr(p.created_at, 1, 23) DESC, p.id DESC
      LIMIT 1`,
  )
    .bind(requestId, childUserId)
    .first<ConsentCandidate>();

  if (!candidate?.id) {
    return { ok: false, status: 403, error: "remote_listen_consent_forbidden" };
  }
  if (candidate.consented_at) {
    // 창이 이미 열려 있는 경우(위급 청취 모델에서 부모 명령이 선-확정, 또는 앞선 동의).
    // 창이 아직 유효하면 409 가 아니라 기존 창을 멱등 반환해, 구버전 아이 앱의 탭-동의도
    // 명령이 연 캡처 창으로 그대로 캡처를 시작하게 한다. 만료됐으면 fail-closed(409).
    const openExpMs = pgToMs(candidate.capture_expires_at);
    if (Number.isFinite(openExpMs) && openExpMs > nowMs) {
      return {
        ok: true,
        consentedAt: candidate.consented_at,
        captureExpiresAt: candidate.capture_expires_at as string,
        captureExpiresAtMs: openExpMs,
      };
    }
    return { ok: false, status: 409, error: "remote_listen_consent_already_used" };
  }
  const requestExpiresAtMs = pgToMs(candidate.expires_at);
  if (!Number.isFinite(requestExpiresAtMs) || requestExpiresAtMs <= nowMs) {
    return { ok: false, status: 409, error: "remote_listen_consent_expired" };
  }

  const consentedAt = pgTs(new Date(nowMs));
  const captureExpiresAt = pgTs(new Date(nowMs + REMOTE_LISTEN_DURATION_MS));
  const updated = await db.prepare(
    `UPDATE remote_listen_sessions
        SET consented_at = ?, capture_expires_at = ?
      WHERE id = ?
        AND child_user_id = ?
        AND consented_at IS NULL
        AND ended_at IS NULL`,
  )
    .bind(consentedAt, captureExpiresAt, requestId, childUserId)
    .run();
  if ((updated.meta.changes ?? 0) !== 1) {
    // 창이 이미 열려 있으면(위급 청취 모델에서 부모 명령이 선-확정) 멱등 성공으로 기존 창을 반환한다.
    // 구버전 아이 앱이 탭-동의를 보내도 명령이 이미 연 창을 되돌려줘 캡처를 그대로 시작하게 한다.
    const existing = await db
      .prepare(
        `SELECT consented_at, capture_expires_at
           FROM remote_listen_sessions
          WHERE id = ? AND child_user_id = ? AND ended_at IS NULL
          LIMIT 1`,
      )
      .bind(requestId, childUserId)
      .first<{ consented_at: string | null; capture_expires_at: string | null }>();
    const existingExpMs = pgToMs(existing?.capture_expires_at ?? "");
    if (existing?.consented_at && Number.isFinite(existingExpMs) && existingExpMs > nowMs) {
      return {
        ok: true,
        consentedAt: existing.consented_at,
        captureExpiresAt: existing.capture_expires_at as string,
        captureExpiresAtMs: existingExpMs,
      };
    }
    return { ok: false, status: 409, error: "remote_listen_consent_already_used" };
  }

  return { ok: true, consentedAt, captureExpiresAt, captureExpiresAtMs: nowMs + REMOTE_LISTEN_DURATION_MS };
}

export interface RemoteListenCaptureWindow {
  capturedAt: string;
  captureExpiresAt: string;
  captureExpiresAtMs: number;
}

/**
 * 위급 청취 핵심 기능(아이 동의 불요): 부모 명령이 서버 권한 검증(주보호자·프리미엄·킬스위치·세션 소유)을
 * 통과한 시각부터 60초 캡처 창을 연다. 아이가 별도로 탭/허용하지 않아도 오디오 게이트가 통과하도록,
 * 기존 consented_at/capture_expires_at 컬럼을 "권한 확인 시각 기준 캡처 창"으로 재사용한다(스키마 무변경).
 * 이미 창이 열려 있으면 그대로 유지한다(멱등 — 명령 재시도가 창을 뒤로 밀지 않는다).
 * 반환값은 이 세션의 확정된 캡처 창(신규 또는 기존). 세션이 없거나 이미 종료됐으면 null.
 */
export async function authorizeRemoteListenCaptureWindow(
  db: D1Database,
  input: { requestId: string; childUserId: string; now?: string },
): Promise<RemoteListenCaptureWindow | null> {
  const requestId = input.requestId.trim();
  const childUserId = input.childUserId.trim();
  if (!requestId || !childUserId) return null;

  const now = input.now ?? pgNow();
  const nowMs = pgToMs(now);
  if (!Number.isFinite(nowMs)) return null;

  const capturedAt = pgTs(new Date(nowMs));
  const captureExpiresAt = pgTs(new Date(nowMs + REMOTE_LISTEN_DURATION_MS));
  await db
    .prepare(
      `UPDATE remote_listen_sessions
          SET consented_at = ?, capture_expires_at = ?
        WHERE id = ?
          AND child_user_id = ?
          AND consented_at IS NULL
          AND ended_at IS NULL`,
    )
    .bind(capturedAt, captureExpiresAt, requestId, childUserId)
    .run();

  // 위 UPDATE 가 0행이면 이미 창이 열려 있던 것 — 기존 값을 정본으로 읽어 반환한다.
  const row = await db
    .prepare(
      `SELECT consented_at, capture_expires_at
         FROM remote_listen_sessions
        WHERE id = ? AND child_user_id = ? AND ended_at IS NULL
        LIMIT 1`,
    )
    .bind(requestId, childUserId)
    .first<{ consented_at: string | null; capture_expires_at: string | null }>();
  if (!row?.consented_at || !row.capture_expires_at) return null;

  const expMs = pgToMs(row.capture_expires_at);
  return {
    capturedAt: row.consented_at,
    captureExpiresAt: row.capture_expires_at,
    captureExpiresAtMs: Number.isFinite(expMs) ? expMs : nowMs + REMOTE_LISTEN_DURATION_MS,
  };
}
