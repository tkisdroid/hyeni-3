export const REMOTE_AUDIO_REQUEST_TIMEOUT_MS = 60_000;
export const REMOTE_AUDIO_CONSENT_SETTLE_GRACE_MS = 5_000;

/**
 * 상태 조회가 일시 실패해도, 마지막 순간의 동의 + 전체 캡처 창을 조기 종료하지 않는 상한.
 * 서버 상태가 정상 조회되면 65초 시점의 동의 여부로 즉시 더 정확하게 판정한다.
 */
export const REMOTE_LISTEN_HARD_FALLBACK_MS =
  REMOTE_AUDIO_REQUEST_TIMEOUT_MS
  + REMOTE_AUDIO_CONSENT_SETTLE_GRACE_MS
  + 60_000;

export type RemoteListenSessionPhase =
  | "waiting_for_consent"
  | "request_expired"
  | "consented"
  | "capture_expired"
  | "ended";

export interface RemoteListenSessionTimingInput {
  clientNowMs: number;
  localRequestStartedAtMs: number;
  /** 마지막 상태 응답의 서버 시각에 클라이언트 경과시간을 더한 추정 현재 서버 시각. */
  serverNowMs: number | null;
  serverStartedAtMs: number | null;
  /** 서버가 실제로 동의 없음 상태를 확인한 시각. */
  serverCheckedAtMs: number | null;
  consentedAtMs: number | null;
  captureExpiresAtMs: number | null;
  endedAtMs: number | null;
}

export interface RemoteListenSessionTiming {
  phase: RemoteListenSessionPhase;
  remainingSeconds: number | null;
}

const finite = (value: number | null): value is number =>
  value !== null && Number.isFinite(value);

export function resolveRemoteListenSessionTiming(
  input: RemoteListenSessionTimingInput,
): RemoteListenSessionTiming {
  if (finite(input.endedAtMs)) {
    return { phase: "ended", remainingSeconds: 0 };
  }

  if (finite(input.consentedAtMs)) {
    if (!finite(input.captureExpiresAtMs)) {
      return { phase: "capture_expired", remainingSeconds: 0 };
    }
    const authoritativeNowMs = finite(input.serverNowMs)
      ? input.serverNowMs
      : input.clientNowMs;
    const remainingMs = input.captureExpiresAtMs - authoritativeNowMs;
    if (remainingMs <= 0) {
      return { phase: "capture_expired", remainingSeconds: 0 };
    }
    return {
      phase: "consented",
      remainingSeconds: Math.ceil(remainingMs / 1000),
    };
  }

  const serverConfirmedNoConsent = finite(input.serverStartedAtMs)
    && finite(input.serverCheckedAtMs)
    && input.serverCheckedAtMs
      >= input.serverStartedAtMs
        + REMOTE_AUDIO_REQUEST_TIMEOUT_MS
        + REMOTE_AUDIO_CONSENT_SETTLE_GRACE_MS;
  if (serverConfirmedNoConsent) {
    return { phase: "request_expired", remainingSeconds: null };
  }

  if (
    Number.isFinite(input.clientNowMs)
    && Number.isFinite(input.localRequestStartedAtMs)
    && input.clientNowMs - input.localRequestStartedAtMs >= REMOTE_LISTEN_HARD_FALLBACK_MS
  ) {
    return { phase: "request_expired", remainingSeconds: null };
  }

  return { phase: "waiting_for_consent", remainingSeconds: null };
}
