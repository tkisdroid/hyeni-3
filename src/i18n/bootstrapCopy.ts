import {
  localeDirection,
  localizedBrandName,
  type SupportedLocale,
} from "./locale.ts";

export interface LocaleBootstrapCopy {
  title: string;
  body: string;
  retry: string;
}

const COPY: Readonly<Record<SupportedLocale, LocaleBootstrapCopy>> = Object.freeze({
  ko: { title: "언어 정보를 불러오지 못했어요", body: "연결을 확인한 뒤 다시 시도해 주세요.", retry: "다시 시도" },
  en: { title: "Couldn't load your language", body: "Check your connection and try again.", retry: "Try again" },
  ja: { title: "言語情報を読み込めませんでした", body: "接続を確認して、もう一度お試しください。", retry: "再試行" },
  "zh-CN": { title: "无法加载语言信息", body: "请检查网络连接后重试。", retry: "重试" },
  "zh-TW": { title: "無法載入語言資訊", body: "請檢查網路連線後再試一次。", retry: "再試一次" },
  vi: { title: "Không thể tải thông tin ngôn ngữ", body: "Hãy kiểm tra kết nối rồi thử lại.", retry: "Thử lại" },
  th: { title: "โหลดข้อมูลภาษาไม่ได้", body: "ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง", retry: "ลองอีกครั้ง" },
  id: { title: "Bahasa tidak dapat dimuat", body: "Periksa koneksi, lalu coba lagi.", retry: "Coba lagi" },
  ms: { title: "Maklumat bahasa tidak dapat dimuatkan", body: "Semak sambungan, kemudian cuba lagi.", retry: "Cuba lagi" },
  fil: { title: "Hindi ma-load ang wika", body: "Tingnan ang koneksyon, pagkatapos ay subukan ulit.", retry: "Subukan ulit" },
});

export function localeBootstrapCopy(locale: SupportedLocale): LocaleBootstrapCopy {
  return COPY[locale];
}

export interface BootstrapDocumentTarget {
  documentElement: { lang: string; dir: string };
  title: string;
  querySelector(selector: string): { setAttribute(name: string, value: string): void } | null;
}

/** core catalog을 읽기 전에도 보조 기술이 감지 locale과 안전한 브랜드 title을 사용하게 한다. */
export function applyBootstrapDocumentLocale(
  locale: SupportedLocale,
  target?: BootstrapDocumentTarget,
): void {
  const documentTarget = target
    ?? (typeof document === "undefined" ? undefined : document);
  if (!documentTarget) return;
  const brand = localizedBrandName(locale);
  documentTarget.documentElement.lang = locale;
  documentTarget.documentElement.dir = localeDirection(locale);
  documentTarget.title = brand;
  documentTarget.querySelector('meta[name="apple-mobile-web-app-title"]')
    ?.setAttribute("content", brand);
}
