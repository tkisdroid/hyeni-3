import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const expected = {
  ko: {
    noGooglePlay: "웹에서는 Google Play 결제·복원을 쓸 수 없어요. 해외 카드는 Android 앱에서 결제해 주세요.",
    card: "웹 자동결제는 대한민국에서 발급된 카드만 지원해요.",
  },
  en: {
    noGooglePlay: "Google Play purchase and restore aren't available on the web. Use the Android app for cards issued outside Korea.",
    card: "Web auto-renewal supports only cards issued in South Korea.",
  },
  ja: {
    noGooglePlay: "ウェブでは Google Play の購入・復元は使えません。海外発行カードは Android アプリで決済してください。",
    card: "Webの自動決済は韓国で発行されたカードのみ利用できます。",
  },
  "zh-CN": {
    noGooglePlay: "网页版无法使用 Google Play 付款与恢复。海外发行的卡请在 Android 应用内付款。",
    card: "网页自动续费仅支持韩国发行的银行卡。",
  },
  "zh-TW": {
    noGooglePlay: "網頁版無法使用 Google Play 付款與恢復。海外發行的卡請在 Android 應用程式內付款。",
    card: "網頁自動續訂僅支援韓國發行的卡片。",
  },
  vi: {
    noGooglePlay: "Trên web không dùng được thanh toán và khôi phục Google Play. Thẻ phát hành ngoài Hàn Quốc hãy thanh toán trong ứng dụng Android.",
    card: "Tự động gia hạn trên web chỉ hỗ trợ thẻ được phát hành tại Hàn Quốc.",
  },
  th: {
    noGooglePlay: "บนเว็บใช้การชำระเงินและกู้คืน Google Play ไม่ได้ บัตรที่ออกนอกเกาหลีให้ชำระในแอป Android",
    card: "การต่ออายุอัตโนมัติบนเว็บรองรับเฉพาะบัตรที่ออกในเกาหลีใต้เท่านั้น",
  },
  id: {
    noGooglePlay: "Pembayaran dan pemulihan Google Play tidak tersedia di web. Gunakan aplikasi Android untuk kartu terbitan luar Korea.",
    card: "Perpanjangan otomatis di web hanya mendukung kartu yang diterbitkan di Korea Selatan.",
  },
  ms: {
    noGooglePlay: "Pembayaran dan pemulihan Google Play tiada di web. Guna aplikasi Android untuk kad terbitan luar Korea.",
    card: "Pembaharuan automatik web hanya menyokong kad yang dikeluarkan di Korea Selatan.",
  },
  fil: {
    noGooglePlay: "Hindi available sa web ang bayad at restore ng Google Play. Gamitin ang Android app para sa card na inisyu sa ibang bansa.",
    card: "Mga card na inisyu sa South Korea lang ang sinusuportahan ng awtomatikong pag-renew sa web.",
  },
};

test("PWA 구독 결제는 10개 locale에서 대한민국 발급 카드 범위를 명시한다", () => {
  for (const [locale, copy] of Object.entries(expected)) {
    const catalog = JSON.parse(readFileSync(resolve(rootDir, `locales/${locale}/billing.json`), "utf8"));
    assert.equal(catalog["billing.subscription.web.domesticCardOnly"], copy.card, locale);
    assert.equal(catalog["billing.subscription.web.noGooglePlay"], copy.noGooglePlay, locale);
  }
});

test("구독 웹 안내는 Google Play 경로와 PWA 카드 발급국 제한을 인접하게 렌더한다", () => {
  const source = readFileSync(resolve(rootDir, "src/screens/feature/Subscription.tsx"), "utf8");
  const googlePlayIndex = source.indexOf('id: "billing.subscription.web.noGooglePlay"');
  const cardIndex = source.indexOf('id: "billing.subscription.web.domesticCardOnly"');

  assert.ok(googlePlayIndex >= 0);
  assert.ok(cardIndex > googlePlayIndex);
  assert.ok(cardIndex - googlePlayIndex < 500, "두 결제 범위 안내는 같은 웹 결제 사실 영역에 있어야 합니다");
});
