/**
 * 원격 청취 오디오 플레이어 — 아이 기기가 broadcast 로 보내는 WAV 청크를 순차 재생.
 *
 * 파이프라인:
 *   아이 네이티브(AmbientListenService) → POST /realtime/v1/api/broadcast (WAV base64)
 *   → FamilyRoom DO fan-out → 부모 familySocket broadcast { event:"audio_chunk", payload:{ data, mimeType } }
 *   → 이 플레이어가 decode + 스케줄 재생.
 *
 * 청크를 currentTime 기준으로 이어 붙여(gap 없이) 재생하고, 음소거는 gain 으로 처리한다.
 * decode 실패한 청크는 조용히 버린다(스트림 연속성 우선).
 */

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export class RemoteAudioPlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private nextTime = 0;
  private muted = false;
  private closed = true;
  /** 재생한 청크 수(디버그·상태 표시용). */
  public playedChunks = 0;

  /** 재생 세션 시작 — AudioContext 를 열고 게인 노드를 준비한다. */
  start(): void {
    this.stop();
    // webkitAudioContext 폴백(구 WebView 호환).
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
    if (!Ctor) {
      console.warn("[remoteAudio] AudioContext 미지원 — 재생 불가");
      return;
    }
    this.ctx = new Ctor();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.muted ? 0 : 1;
    this.gain.connect(this.ctx.destination);
    this.nextTime = 0;
    this.closed = false;
    this.playedChunks = 0;
    // 일부 WebView 는 사용자 제스처 이후에도 suspended 로 시작 → 명시적 resume.
    void this.ctx.resume?.().catch(() => {});
  }

  /** WAV(base64) 청크를 디코드해 스트림 끝에 이어 재생. 실패 청크는 버린다. */
  async enqueueBase64Wav(base64: string): Promise<void> {
    if (this.closed || !this.ctx || !this.gain || !base64) return;
    try {
      const arrayBuffer = base64ToArrayBuffer(base64);
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      if (this.closed || !this.ctx || !this.gain) return;
      const source = this.ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.gain);
      const now = this.ctx.currentTime;
      // 이전 청크가 끝난 시점(nextTime)과 현재 시각 중 늦은 쪽에서 시작 → 끊김 없이 이어 붙임.
      const startAt = Math.max(now, this.nextTime);
      source.start(startAt);
      this.nextTime = startAt + audioBuffer.duration;
      this.playedChunks += 1;
    } catch (error) {
      // 손상/부분 청크는 스트림 연속성을 위해 조용히 버린다.
      console.warn("[remoteAudio] 청크 디코드/재생 실패(건너뜀):", error);
    }
  }

  /** 음소거 토글 — 재생은 계속하되 게인만 0/1. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.gain && this.ctx) {
      this.gain.gain.setValueAtTime(muted ? 0 : 1, this.ctx.currentTime);
    }
  }

  /** 세션 종료 — AudioContext 를 닫고 상태를 초기화. */
  stop(): void {
    this.closed = true;
    if (this.ctx) {
      try {
        void this.ctx.close();
      } catch {
        /* 이미 닫힘 */
      }
    }
    this.ctx = null;
    this.gain = null;
    this.nextTime = 0;
  }
}
