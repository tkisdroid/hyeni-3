/**
 * 음성 인식(STT) 단발 캡처 — hyeni-1 AiScheduleModal 패턴 이관.
 * 네이티브 커스텀 플러그인 "SpeechRecognition"(SpeechPlugin.java) 우선,
 * 미지원(웹 등)이면 Web Speech API(SpeechRecognition/webkitSpeechRecognition) 폴백.
 * voice-parse 엔드포인트는 텍스트를 받으므로 STT 는 클라에서 처리한다.
 */
import { getNativePlugin } from "./plugins";

interface SpeechResult {
  transcript?: string;
  matches?: string[];
  value?: string[];
  success?: boolean;
}

interface NativeSpeechPlugin {
  start(opts: { language?: string }): Promise<SpeechResult>;
  stop(): Promise<{ status?: string }>;
  isAvailable(): Promise<{ available?: boolean }>;
}

// lib.dom 의 SpeechRecognition 타입에 의존하지 않도록 최소 형태만 정의(웹뷰/브라우저 공용).
type WebSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type WebSpeechCtor = new () => WebSpeechRecognition;

function webSpeechCtor(): WebSpeechCtor | null {
  const w = window as unknown as { SpeechRecognition?: WebSpeechCtor; webkitSpeechRecognition?: WebSpeechCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function extractTranscript(result: SpeechResult | null | undefined): string {
  if (!result) return "";
  if (typeof result.transcript === "string") return result.transcript.trim();
  if (Array.isArray(result.matches) && result.matches[0]) return String(result.matches[0]).trim();
  if (Array.isArray(result.value) && result.value[0]) return String(result.value[0]).trim();
  return "";
}

/** Web Speech API 단발 인식(웹/폴백). 미지원·오류·무음이면 "". */
let activeWebRecognition: WebSpeechRecognition | null = null;

function startWebSpeech(lang: string): Promise<string> {
  return new Promise((resolve) => {
    const SR = webSpeechCtor();
    if (!SR) {
      resolve("");
      return;
    }
    let done = false;
    const finish = (v: string) => {
      if (!done) {
        done = true;
        activeWebRecognition = null;
        resolve(v);
      }
    };
    try {
      const rec = new SR();
      rec.lang = lang;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => finish((e.results?.[0]?.[0]?.transcript || "").trim());
      rec.onerror = () => finish("");
      rec.onend = () => finish("");
      activeWebRecognition = rec;
      rec.start();
    } catch {
      finish("");
    }
  });
}

/** 이 기기에서 음성 인식이 가능한지(네이티브 플러그인 또는 Web Speech API). */
export function isSpeechCaptureSupported(): boolean {
  if (getNativePlugin("SpeechRecognition")) return true;
  return !!webSpeechCtor();
}

/**
 * 음성 인식 단발 캡처. 네이티브 플러그인 우선, 웹 Speech API 폴백.
 * 성공 시 인식 텍스트, 실패/무음/미지원이면 "".
 */
export async function captureSpeech(language = "ko-KR"): Promise<string> {
  try {
    const plugin = getNativePlugin<NativeSpeechPlugin>("SpeechRecognition");
    if (plugin?.start) {
      const t = extractTranscript(await plugin.start({ language }));
      if (t) return t;
    }
  } catch {
    /* 네이티브 실패 → 웹 폴백 시도 */
  }
  return (await startWebSpeech(language)).trim();
}

/**
 * 진행 중인 음성 인식을 중단한다(탭 전환·화면 이탈 등).
 * 진행 중이던 captureSpeech Promise 는 빈 문자열로 끝난다(호출부는 세대 카운터로 무시).
 */
export function cancelSpeechCapture(): void {
  try {
    const plugin = getNativePlugin<NativeSpeechPlugin>("SpeechRecognition");
    void plugin?.stop?.().catch(() => undefined);
  } catch {
    /* 네이티브 미지원 — 무시 */
  }
  try {
    activeWebRecognition?.stop();
  } catch {
    /* 이미 종료 — 무시 */
  }
}
