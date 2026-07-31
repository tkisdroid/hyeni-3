/**
 * 원격 청취 오디오 플레이어 — 아이 기기가 broadcast 로 보내는 WAV 청크를 순차 재생.
 *
 * 파이프라인:
 *   아이 네이티브(AmbientListenService) → POST /realtime/v1/api/broadcast (WAV base64)
 *   → FamilyRoom DO fan-out → 부모 familySocket broadcast { event:"audio_chunk", payload:{ data, mimeType } }
 *   → 이 플레이어가 순차 재생.
 *
 * Android 네이티브는 WAV 청크를 보낸다. Capacitor WebView 에서는 WebAudio BufferSource 가
 * 스케줄은 되지만 실제 미디어 볼륨 경로를 타지 않아 무음이 될 수 있어, hyeni-1 과 동일하게
 * WAV 는 HTMLAudioElement 로 재생한다.
 */

type ManagedAudio = {
  audio: HTMLAudioElement;
  url: string;
  finish: (ok: boolean) => void;
};

type StartResolver = (ok: boolean) => void;

export interface RemoteAudioPlayerOptions {
  /**
   * iPhone PWA처럼 지연 생성한 HTMLAudioElement의 autoplay가 차단되는 환경에서는
   * 사용자 탭에서 미리 연 AudioContext로 WAV를 재생한다.
   * Android WebView는 미디어 볼륨 경로 안정성을 위해 기존 <audio> 방식을 유지한다.
   */
  preferWebAudioForWav?: boolean;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function looksLikeWav(bytes: Uint8Array, mimeType?: string): boolean {
  return (
    (typeof mimeType === "string" && mimeType.includes("wav")) ||
    (bytes.length > 44 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46)
  );
}

export class RemoteAudioPlayer {
  private readonly preferWebAudioForWav: boolean;
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private nextTime = 0;
  private muted = false;
  private closed = true;
  private generation = 0;
  private playback: Promise<boolean> = Promise.resolve(true);
  private activeSources = new Set<AudioBufferSourceNode>();
  private activeAudios = new Set<ManagedAudio>();
  /** 재생한 청크 수(디버그·상태 표시용). */
  public playedChunks = 0;

  constructor(options: RemoteAudioPlayerOptions = {}) {
    this.preferWebAudioForWav = options.preferWebAudioForWav === true;
  }

  /** 재생 세션 시작 — Android WAV는 <audio>, iPhone PWA WAV와 비-WAV는 AudioContext를 우선한다. */
  start(): void {
    this.stop();
    this.closed = false;
    this.generation += 1;
    this.playback = Promise.resolve(true);
    this.playedChunks = 0;

    // webkitAudioContext 폴백(구 WebView 호환).
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
    if (!Ctor) {
      console.warn("[remoteAudio] AudioContext 미지원 — WAV <audio> 재생만 사용");
      return;
    }
    try {
      this.ctx = new Ctor();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.muted ? 0 : 1;
      this.gain.connect(this.ctx.destination);
      this.nextTime = 0;
      // iPhone은 첫 사용자 탭 안에서 AudioContext를 열어야 이후 도착한 WAV도 재생할 수 있다.
      // 일부 WebView도 suspended로 시작하므로 같은 시점에 명시적으로 resume한다.
      void this.ctx.resume?.().catch(() => {});
    } catch (error) {
      console.warn("[remoteAudio] AudioContext 준비 실패 — WAV <audio> 재생만 사용:", error);
      this.ctx = null;
      this.gain = null;
    }
  }

  private async ensureRunning(): Promise<boolean> {
    if (!this.ctx) return false;
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        return false;
      }
    }
    return this.ctx.state !== "suspended";
  }

  /** WAV(base64) 청크를 순차 재생. 반환값은 실제 재생 시작 여부다. */
  async enqueueBase64Wav(base64: string, mimeType = "audio/wav"): Promise<boolean> {
    if (this.closed || !base64) return false;
    const generation = this.generation;
    let resolveStarted: StartResolver = () => {};
    const started = new Promise<boolean>((resolve) => {
      let settled = false;
      resolveStarted = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
    });

    this.playback = this.playback
      .catch(() => false)
      .then(() => this.playBase64Chunk(base64, mimeType, generation, resolveStarted))
      .then(
        (ok) => {
          resolveStarted(ok);
          return ok;
        },
        (error) => {
          console.warn("[remoteAudio] 청크 재생 실패(건너뜀):", error);
          resolveStarted(false);
          return false;
        },
      );

    return started;
  }

  private async playBase64Chunk(
    base64: string,
    mimeType: string,
    generation: number,
    resolveStarted: StartResolver,
  ): Promise<boolean> {
    if (this.closed || generation !== this.generation) return false;
    const bytes = base64ToBytes(base64);
    if (looksLikeWav(bytes, mimeType)) {
      if (this.preferWebAudioForWav) {
        const played = await this.playWithWebAudio(bytes, generation, resolveStarted);
        if (played) return true;
      }
      return this.playWithAudioElement(bytes, "audio/wav", generation, resolveStarted);
    }

    const played = await this.playWithWebAudio(bytes, generation, resolveStarted);
    if (played) return true;
    return this.playWithAudioElement(bytes, mimeType || "audio/webm", generation, resolveStarted);
  }

  private async playWithWebAudio(
    bytes: Uint8Array,
    generation: number,
    resolveStarted: StartResolver,
  ): Promise<boolean> {
    if (this.closed || generation !== this.generation || !this.ctx || !this.gain) return false;
    try {
      if (!(await this.ensureRunning())) return false;
      if (this.closed || generation !== this.generation || !this.ctx || !this.gain) return false;
      const audioBuffer = await this.ctx.decodeAudioData(bytesToArrayBuffer(bytes));
      if (this.closed || generation !== this.generation || !this.ctx || !this.gain) return false;
      const source = this.ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.gain);
      this.activeSources.add(source);
      source.onended = () => this.activeSources.delete(source);
      const now = this.ctx.currentTime;
      const startAt = Math.max(now, this.nextTime);
      source.start(startAt);
      this.nextTime = startAt + audioBuffer.duration;
      this.playedChunks += 1;
      resolveStarted(true);
      return true;
    } catch (error) {
      console.warn("[remoteAudio] WebAudio 재생 실패(HTMLAudio 폴백):", error);
      return false;
    }
  }

  private async playWithAudioElement(
    bytes: Uint8Array,
    mimeType: string,
    generation: number,
    resolveStarted: StartResolver,
  ): Promise<boolean> {
    if (this.closed || generation !== this.generation) return false;
    const blob = new Blob([bytesToArrayBuffer(bytes)], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.preload = "auto";
    audio.muted = this.muted;
    audio.volume = this.muted ? 0 : 1;
    audio.src = url;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let started = false;
      let entry: ManagedAudio;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        this.activeAudios.delete(entry);
        audio.onended = null;
        audio.onerror = null;
        try {
          audio.pause();
          audio.src = "";
          audio.load?.();
        } catch {
          /* 이미 정리됨 */
        }
        URL.revokeObjectURL(url);
        if (!started) resolveStarted(ok);
        resolve(ok);
      };
      entry = { audio, url, finish };
      this.activeAudios.add(entry);

      audio.onended = () => finish(started);
      audio.onerror = (event) => {
        console.warn("[remoteAudio] <audio> 재생 오류:", event);
        finish(false);
      };

      if (this.closed || generation !== this.generation) {
        finish(false);
        return;
      }

      const markStarted = () => {
        if (started || this.closed || generation !== this.generation) return;
        started = true;
        this.playedChunks += 1;
        resolveStarted(true);
      };

      const playPromise = audio.play();
      if (playPromise?.then) {
        playPromise.then(markStarted).catch((error) => {
          console.warn("[remoteAudio] <audio>.play() 실패:", error);
          finish(false);
        });
      } else {
        markStarted();
      }
    });
  }

  /** 음소거 토글 — 재생은 계속하되 게인만 0/1. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.gain && this.ctx) {
      this.gain.gain.setValueAtTime(muted ? 0 : 1, this.ctx.currentTime);
    }
    for (const entry of this.activeAudios) {
      entry.audio.muted = muted;
      entry.audio.volume = muted ? 0 : 1;
    }
  }

  /** 세션 종료 — AudioContext 를 닫고 상태를 초기화. */
  stop(): void {
    this.closed = true;
    this.generation += 1;
    for (const source of this.activeSources) {
      try {
        source.stop(0);
      } catch {
        /* 이미 종료됨 */
      }
    }
    this.activeSources.clear();
    for (const entry of Array.from(this.activeAudios)) {
      entry.finish(false);
    }
    this.activeAudios.clear();
    this.playback = Promise.resolve(true);
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
