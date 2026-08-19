/**
 * 음성 파형에 쓰는 입력 크기 계산(순수, 2026-08-19 TK 지시).
 *
 * 아이가 말로 이야기할 때 화면 파형은 **실제 목소리**로 움직여야 한다.
 * 그래야 "지금 내 말이 들어가고 있구나"를 글을 읽지 않고도 안다.
 * Android SpeechRecognizer 가 알려 주는 RMS(dB)를 화면이 쓸 0~1 로 좁히는 것이 여기 일이다.
 */

/** 실측 RMS 범위(dB). 이 구간을 펴서 0~1 로 쓴다. */
export const SPEECH_RMS_MIN_DB = -2;
export const SPEECH_RMS_MAX_DB = 10;

/**
 * RMS(dB) → 0~1.
 * 숫자가 아니면 0(조용함)이다 — `Number(null) === 0` 함정을 typeof 로 먼저 막는다
 * (문자열이 0 으로 둔갑하면 파형이 조용한 척하거나 튄다).
 */
export function normalizeSpeechRms(rmsDb: unknown): number {
  if (typeof rmsDb !== "number" || !Number.isFinite(rmsDb)) return 0;
  const ratio = (rmsDb - SPEECH_RMS_MIN_DB) / (SPEECH_RMS_MAX_DB - SPEECH_RMS_MIN_DB);
  return Math.min(1, Math.max(0, ratio));
}
