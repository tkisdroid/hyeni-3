import assert from "node:assert/strict";
import test from "node:test";

test("iPhone용 WAV 재생은 사용자 탭에서 resume한 AudioContext를 지연 청크에도 재사용한다", async () => {
  const originalWindow = globalThis.window;
  const originalAudio = globalThis.Audio;
  let htmlAudioConstructed = 0;
  let sourceStarted = 0;
  let resumeCalls = 0;
  let releaseResume = () => {};
  const resumeGate = new Promise((resolve) => {
    releaseResume = resolve;
  });

  class FakeAudioContext {
    state = "suspended";
    currentTime = 0;
    destination = {};

    createGain() {
      return {
        gain: {
          value: 1,
          setValueAtTime() {},
        },
        connect() {},
      };
    }

    createBufferSource() {
      return {
        buffer: null,
        connect() {},
        start() {
          sourceStarted += 1;
        },
        stop() {},
        onended: null,
      };
    }

    async decodeAudioData() {
      return { duration: 0.25 };
    }

    async resume() {
      resumeCalls += 1;
      await resumeGate;
      this.state = "running";
    }

    async close() {
      this.state = "closed";
    }
  }

  globalThis.window = { AudioContext: FakeAudioContext };
  globalThis.Audio = class {
    constructor() {
      htmlAudioConstructed += 1;
    }
  };

  try {
    const { RemoteAudioPlayer } = await import("../src/lib/remoteAudioPlayer.ts");
    const player = new RemoteAudioPlayer({ preferWebAudioForWav: true });
    player.start();
    assert.equal(resumeCalls, 1);

    releaseResume();
    await resumeGate;
    await Promise.resolve();

    const wav = Buffer.alloc(48);
    wav.write("RIFF", 0, "ascii");
    const played = await player.enqueueBase64Wav(wav.toString("base64"), "audio/wav");

    assert.equal(played, true);
    assert.equal(sourceStarted, 1);
    assert.equal(htmlAudioConstructed, 0);
    assert.equal(resumeCalls, 1);
    player.stop();
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = originalAudio;
  }
});

test("iPhone용 WAV는 AudioContext resume과 HTMLAudio 폴백이 모두 실패하면 재생 성공으로 표시하지 않는다", async () => {
  const originalWindow = globalThis.window;
  const originalAudio = globalThis.Audio;
  const originalWarn = console.warn;
  let htmlAudioConstructed = 0;
  let sourceStarted = 0;
  let resumeCalls = 0;

  class FakeAudioContext {
    state = "suspended";
    currentTime = 0;
    destination = {};

    createGain() {
      return {
        gain: {
          value: 1,
          setValueAtTime() {},
        },
        connect() {},
      };
    }

    createBufferSource() {
      return {
        buffer: null,
        connect() {},
        start() {
          sourceStarted += 1;
        },
        stop() {},
        onended: null,
      };
    }

    async decodeAudioData() {
      return { duration: 0.25 };
    }

    async resume() {
      resumeCalls += 1;
      throw new Error("autoplay_blocked");
    }

    async close() {
      this.state = "closed";
    }
  }

  globalThis.window = { AudioContext: FakeAudioContext };
  globalThis.Audio = class {
    constructor() {
      htmlAudioConstructed += 1;
    }

    play() {
      return Promise.reject(new Error("html_audio_blocked"));
    }

    pause() {}
    load() {}
  };
  console.warn = () => {};

  try {
    const { RemoteAudioPlayer } = await import("../src/lib/remoteAudioPlayer.ts");
    const player = new RemoteAudioPlayer({ preferWebAudioForWav: true });
    player.start();

    const wav = Buffer.alloc(48);
    wav.write("RIFF", 0, "ascii");
    const played = await player.enqueueBase64Wav(wav.toString("base64"), "audio/wav");

    assert.equal(played, false);
    assert.equal(player.playedChunks, 0);
    assert.equal(sourceStarted, 0);
    assert.equal(htmlAudioConstructed, 1);
    assert.ok(resumeCalls >= 2);
    player.stop();
  } finally {
    console.warn = originalWarn;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = originalAudio;
  }
});
