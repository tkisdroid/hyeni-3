import assert from "node:assert/strict";
import test from "node:test";

test("iPhone용 WAV 재생은 사용자 탭에서 연 WebAudio 경로를 재사용한다", async () => {
  const originalWindow = globalThis.window;
  const originalAudio = globalThis.Audio;
  let htmlAudioConstructed = 0;
  let sourceStarted = 0;
  let resumeCalls = 0;

  class FakeAudioContext {
    state = "running";
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

    const wav = Buffer.alloc(48);
    wav.write("RIFF", 0, "ascii");
    const played = await player.enqueueBase64Wav(wav.toString("base64"), "audio/wav");

    assert.equal(played, true);
    assert.equal(sourceStarted, 1);
    assert.equal(htmlAudioConstructed, 0);
    assert.ok(resumeCalls >= 1);
    player.stop();
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = originalAudio;
  }
});
