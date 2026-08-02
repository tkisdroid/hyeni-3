// Pure, runtime-agnostic helpers for the location-staleness detector.
// No Supabase/Deno imports here so the logic stays unit-testable under Vitest
// while the edge function imports the same module under Deno.

export const STALENESS_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
export const RECENT_LOCATION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// 위치가 끊긴 직후에는 5분 간격으로 빠르게 복구하고, 무진전이 길어지면
// 15→30→60분으로 백오프한다. 부모 수동 request_location은 이 정책과 무관하게 즉시 발송된다.
export function shouldAutoWakeForStaleAge(ageMs, cronTickMs = 5 * 60 * 1000) {
  if (!(ageMs > STALENESS_THRESHOLD_MS) || !(cronTickMs > 0)) return false;
  let intervalMs;
  if (ageMs <= 25 * 60 * 1000) intervalMs = 5 * 60 * 1000;
  else if (ageMs <= 60 * 60 * 1000) intervalMs = 15 * 60 * 1000;
  else if (ageMs <= 3 * 60 * 60 * 1000) intervalMs = 30 * 60 * 1000;
  else intervalMs = 60 * 60 * 1000;

  const previousAgeMs = Math.max(STALENESS_THRESHOLD_MS, ageMs - cronTickMs);
  return Math.floor(ageMs / intervalMs) > Math.floor(previousAgeMs / intervalMs);
}

// Milliseconds since the child's most recent location fix.
// Returns Infinity when the timestamp is missing/invalid (treated as "no signal").
export function computeAgeMs(lastLocationAtIso, nowMs) {
  const t = Date.parse(String(lastLocationAtIso || ""));
  if (!Number.isFinite(t)) return Infinity;
  return nowMs - t;
}

// Decide the link-state transition for one child.
// currentState: 'connected' | 'stale' | undefined (no row yet → treated as connected).
// Strict `>` so exactly-at-threshold is still connected.
export function decideLinkTransition({ currentState, ageMs, thresholdMs = STALENESS_THRESHOLD_MS }) {
  const isStaleNow = ageMs > thresholdMs;
  const normalized = currentState === "stale" ? "stale" : "connected";
  if (normalized === "connected" && isStaleNow) {
    return { action: "alert", nextState: "stale" };
  }
  if (normalized === "stale" && !isStaleNow) {
    return { action: "recover", nextState: "connected" };
  }
  return { action: "none", nextState: normalized };
}

// cyrb128: compact non-cryptographic hash → four 32-bit unsigned ints (128 bits).
function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

// Deterministic RFC-4122-shaped UUID (v4 layout) for one staleness episode.
// Same (kind, child, lastLocationAt) → same key, so cron retries dedup at
// push_idempotency. The column is `uuid`, so the format must be valid;
// cryptographic strength is not required for an idempotency key.
export function episodeIdempotencyKey(kind, childUserId, lastLocationAtIso) {
  const [a, b, c, d] = cyrb128(`${kind}:${childUserId}:${lastLocationAtIso}`);
  const hex = [a, b, c, d].map((n) => n.toString(16).padStart(8, "0")).join(""); // 32 chars
  const timeHiVer = "4" + hex.slice(13, 16);
  const variantNibble = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const clockSeq = variantNibble + hex.slice(17, 20);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${timeHiVer}-${clockSeq}-${hex.slice(20, 32)}`;
}

// 주격 조사 이/가 — 한글 받침 여부로 분기 (클라 withParticle 과 동일 규칙).
function subjectParticle(word) {
  const s = String(word || "");
  if (!s) return "이";
  const last = s.charCodeAt(s.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return "이"; // 한글 음절이 아니면 기본값
  return (last - 0xac00) % 28 !== 0 ? "이" : "가";
}

// Parent-facing copy → 존댓말 (copy-tone rule).
// (staleness reliability Phase 1) reason 별로 톤·문구를 분기한다:
//   power_save  등록장소 정지(절전 추정) → info, 정직·행동유도 톤
//   device_off  배터리 방전 직후         → warning, 기기 확인
//   unstable    등록장소 밖 끊김          → warning, 연결 불안정
//   unknown     좌표 미상(기본, 현행)     → warning, 기존 문구 (2-arg 하위호환)
//
// ⚠️ power_save 문구 정직성(2026-06-10 사건 회귀 방지): 끊김의 본질은 "마지막
// 으로 알려진 좌표가 frozen" 이라는 것뿐, "지금 아이가 거기 있다" 가 아니다.
// 등록장소 앞에서 피드가 죽고 아이가 떠나면(=실사건) 마지막 좌표는 집 근처이지만
// 실제 위치는 미상이다. 따라서 "한곳에 머물러 있어요 / 움직이면 다시 연결돼요"
// 같은 안심 단정은 금지 — frozen 좌표를 "지금 거기 있음" 으로 오인시킨다. 대신
// "위치가 갱신되지 않음 + 마지막 위치 + 지금 확인하려면 새로고침" 으로 정직하게.
// 야간 정상 Doze 피로를 막기 위해 severity 는 info 유지(소리/중요도 톤), 단 문구는
// 거짓 안심을 제거한다. 서버 자동 웨이크(location-staleness-check)가 능동 복구를
// 병행한다.
export function buildStaleAlert(childName, ageMinutes, reason = "unknown", placeName = null) {
  const name = (childName || "아이").trim() || "아이";
  const subject = `${name}${subjectParticle(name)}`;
  const place = (placeName || "").trim();
  const mins = Math.max(1, Math.round(Number(ageMinutes) || 1));
  if (reason === "power_save") {
    return {
      alertType: "location_stale",
      severity: "info",
      title: "아이 위치가 업데이트되지 않아요",
      message: place
        ? `${subject} ${mins}분째 위치가 갱신되지 않아요. 마지막 확인은 '${place}' 부근이에요.`
        : `${subject} ${mins}분째 위치가 갱신되지 않아요. 새로고침하면 지금 위치를 확인해요.`,
    };
  }
  // power_off: 기기가 '전원 종료' 신호(ShutdownReceiver 마커)를 남기고 꺼진 경우 —
  // 배터리 방전(device_off)과 달리 '의도적으로 껐다'가 확실하므로 정직하게 그렇게 알린다.
  // (2026-06-10: 학교 규칙으로 아이가 등교 시 폰을 끄는 케이스. 부모가 "꺼짐"을 분명히
  // 알고, 다시 켜지면 즉시 복구 알림을 받게 한다.)
  if (reason === "power_off") {
    return {
      alertType: "location_stale",
      severity: "warning",
      title: "아이가 기기 전원을 껐어요",
      message: place
        ? `${subject} 기기 전원을 껐어요. 마지막 확인은 '${place}' 부근이에요.`
        : `${subject} 기기 전원을 껐어요. 다시 켜지면 바로 알려드릴게요.`,
    };
  }
  if (reason === "device_off") {
    return {
      alertType: "location_stale",
      severity: "warning",
      title: "아이 기기 연결이 끊겼어요",
      message: `${subject} ${mins}분째 위치가 끊겼어요. 배터리가 부족했던 것 같아요.`,
    };
  }
  if (reason === "unstable") {
    return {
      alertType: "location_stale",
      severity: "warning",
      title: "아이 위치 연결이 불안정해요",
      message: `${subject} ${mins}분째 위치가 업데이트되지 않아요. 기기를 확인해 주세요.`,
    };
  }
  return {
    alertType: "location_stale",
    severity: "warning",
    title: "아이 위치가 끊겼어요",
    message: `${subject} ${mins}분째 위치가 업데이트되지 않아요. 기기를 확인해 주세요.`,
  };
}

export function buildRecoveredAlert(childName) {
  const name = (childName || "아이").trim() || "아이";
  return {
    alertType: "location_recovered",
    severity: "info",
    title: "아이 위치가 다시 연결됐어요",
    message: `${name}의 위치가 다시 정상적으로 업데이트되고 있어요.`,
  };
}

// ── 24h+ unrecovered → unpair-suspected 격상 ────────────────────────────
// Phase 2 D: stale 진입 후 24h 가 넘게 복구되지 않으면 부모에게 'unpair 가설'
// 알림. 24h 마다 최대 1회 재발사 (스팸 방지).

export const UNPAIR_SUSPECTED_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h
export const UNPAIR_ALERT_REPEAT_MS = 24 * 60 * 60 * 1000;        // 24h (#2 발사 전 간격)

// 백오프: 한 stale 에피소드당 최대 발사 횟수 + 점증 간격. 수일째 끊김인 자녀에게
// 매일 영구 반복하면(기존 동작) 부모 알림 피로가 크다. 첫 알림(24h) 후 간격을
// 늘려가며 최대 3회로 제한 → 그 뒤엔 침묵(복구 시 카운트 reset → 다음 에피소드 부활).
export const UNPAIR_ALERT_MAX = 3;
// 발사 #2 전 필요한 간격(직전 발사로부터), 발사 #3 전 간격. #3 초과는 cap 으로 차단.
export const UNPAIR_REPEAT_GAPS_MS = [24 * 60 * 60 * 1000, 48 * 60 * 60 * 1000];

// Decide whether to emit a child_unpair_suspected alert for one child.
// ageMs: ms since the child's most recent location fix (Infinity = no signal).
// lastUnpairAlertedAt: ISO string from child_location_link_state, or null.
// alertCount: 이 에피소드에서 이미 보낸 unpair 알림 수 (child_location_link_state
//   .unpair_alert_count). 기본 0. (legacy: count 미추적 행은 lastUnpairAlertedAt
//   가 있으면 최소 1회 보낸 것으로 간주해 기존 24h 동작을 보존.)
// nowMs: current time in ms (injected for testability).
export function shouldEmitUnpairAlert({ ageMs, lastUnpairAlertedAt, alertCount = 0, nowMs }) {
  if (!(ageMs >= UNPAIR_SUSPECTED_THRESHOLD_MS)) return false;
  const sent = alertCount > 0 ? alertCount : (lastUnpairAlertedAt ? 1 : 0);
  if (sent >= UNPAIR_ALERT_MAX) return false; // 백오프 cap 도달 → 침묵
  if (sent <= 0) return true;                 // 첫 발사
  const lastMs = Date.parse(String(lastUnpairAlertedAt));
  if (!Number.isFinite(lastMs)) return true;
  const gap = UNPAIR_REPEAT_GAPS_MS[Math.min(sent - 1, UNPAIR_REPEAT_GAPS_MS.length - 1)];
  return (nowMs - lastMs) >= gap;
}

// Parent-facing copy → 존댓말, 부드러운 어조 (강한 빨강·과장 금지).
export function buildUnpairSuspectedAlert(childName, hoursStale) {
  const name = (childName || "아이").trim() || "아이";
  const hours = Math.max(24, Math.round(Number(hoursStale) || 24));
  return {
    alertType: "child_unpair_suspected",
    severity: "warning",
    title: "아이 기기 끊김이 길어지고 있어요",
    message: `${name}의 기기와 ${hours}시간 이상 연결되지 않았어요. 기기가 정상인지 확인해 주세요.`,
  };
}
