/**
 * 아이 AI 답변 읽기(TTS). Web Speech Synthesis 만 사용한다.
 * 네이티브 전용 플러그인이 없고, Android WebView 도 같은 API 를 제공한다.
 */
type SpeechSynthesisLike = {
  cancel: () => void;
  speak: (utterance: SpeechSynthesisUtterance) => void;
  getVoices: () => SpeechSynthesisVoice[];
};

function synthesis(): SpeechSynthesisLike | null {
  if (typeof window === "undefined") return null;
  const api = window.speechSynthesis;
  return api ?? null;
}

export function isChildAiSpeechSupported(): boolean {
  return !!synthesis() && typeof SpeechSynthesisUtterance === "function";
}

export function cancelChildAiSpeech(): void {
  try {
    synthesis()?.cancel();
  } catch {
    /* 이미 끝난 발화 */
  }
}

function pickKoreanVoice(api: SpeechSynthesisLike): SpeechSynthesisVoice | null {
  try {
    const voices = api.getVoices();
    return voices.find((voice) => /^ko(-|_|$)/i.test(voice.lang))
      ?? voices.find((voice) => /korean|한국어/i.test(voice.name))
      ?? null;
  } catch {
    return null;
  }
}

/** 아이 반말 답변을 소리로 읽어 준다. 미지원·빈 문장은 조용히 넘어간다. */
export function speakChildAiReply(text: string): boolean {
  const api = synthesis();
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!api || !clean || typeof SpeechSynthesisUtterance !== "function") return false;
  try {
    api.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = "ko-KR";
    utterance.rate = 1;
    utterance.pitch = 1.05;
    const voice = pickKoreanVoice(api);
    if (voice) utterance.voice = voice;
    api.speak(utterance);
    return true;
  } catch {
    return false;
  }
}
