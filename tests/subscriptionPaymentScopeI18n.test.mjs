import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const expected = {
  ko: {
    noGooglePlay: "웹/PWA에서는 Google Play 결제와 구독 복원을 이용할 수 없어요. 해외 발급 결제 수단은 Android 앱의 Google Play를 이용해 주세요. PWA 자동결제는 대한민국에서 발급된 카드만 지원해요.",
    card: "웹 자동결제는 대한민국에서 발급된 카드만 지원해요.",
  },
  en: {
    noGooglePlay: "Google Play payments and subscription restoration aren't available on web/PWA. For payment methods issued overseas, use Google Play in the Android app; PWA auto-renewal supports only cards issued in South Korea.",
    card: "Web auto-renewal supports only cards issued in South Korea.",
  },
  ja: {
    noGooglePlay: "Web/PWAではGoogle Play決済と定期購入の復元は利用できません。海外発行の支払い方法はAndroidアプリのGoogle Playを利用してください。PWAの自動決済は韓国発行カードのみ対応しています。",
    card: "Webの自動決済は韓国で発行されたカードのみ利用できます。",
  },
  "zh-CN": {
    noGooglePlay: "网页/PWA 无法使用 Google Play 付款和订阅恢复。海外发行的付款方式请使用 Android 应用中的 Google Play；PWA 自动续费仅支持韩国发行的银行卡。",
    card: "网页自动续费仅支持韩国发行的银行卡。",
  },
  "zh-TW": {
    noGooglePlay: "網頁/PWA 無法使用 Google Play 付款與訂閱恢復。海外發行的付款方式請使用 Android 應用程式中的 Google Play；PWA 自動續訂僅支援韓國發行的卡片。",
    card: "網頁自動續訂僅支援韓國發行的卡片。",
  },
  vi: {
    noGooglePlay: "Thanh toán Google Play và khôi phục gói đăng ký không có trên web/PWA. Với phương thức thanh toán phát hành ở nước ngoài, hãy dùng Google Play trong ứng dụng Android; tự động gia hạn trên PWA chỉ hỗ trợ thẻ phát hành tại Hàn Quốc.",
    card: "Tự động gia hạn trên web chỉ hỗ trợ thẻ được phát hành tại Hàn Quốc.",
  },
  th: {
    noGooglePlay: "เว็บ/PWA ไม่รองรับการชำระเงินผ่าน Google Play หรือการกู้คืนการสมัครสมาชิก หากใช้วิธีชำระเงินที่ออกในต่างประเทศ โปรดใช้ Google Play ในแอป Android ส่วนการต่ออายุอัตโนมัติบน PWA รองรับเฉพาะบัตรที่ออกในเกาหลีใต้",
    card: "การต่ออายุอัตโนมัติบนเว็บรองรับเฉพาะบัตรที่ออกในเกาหลีใต้เท่านั้น",
  },
  id: {
    noGooglePlay: "Pembayaran Google Play dan pemulihan langganan tidak tersedia di web/PWA. Untuk metode pembayaran yang diterbitkan di luar negeri, gunakan Google Play di aplikasi Android; perpanjangan otomatis PWA hanya mendukung kartu yang diterbitkan di Korea Selatan.",
    card: "Perpanjangan otomatis di web hanya mendukung kartu yang diterbitkan di Korea Selatan.",
  },
  ms: {
    noGooglePlay: "Pembayaran Google Play dan pemulihan langganan tidak tersedia di web/PWA. Untuk kaedah pembayaran yang dikeluarkan di luar negara, gunakan Google Play dalam apl Android; pembaharuan automatik PWA hanya menyokong kad yang dikeluarkan di Korea Selatan.",
    card: "Pembaharuan automatik web hanya menyokong kad yang dikeluarkan di Korea Selatan.",
  },
  fil: {
    noGooglePlay: "Hindi available sa web/PWA ang pagbabayad sa Google Play at pagpapanumbalik ng subscription. Para sa paraan ng pagbabayad na inisyu sa ibang bansa, gamitin ang Google Play sa Android app; mga card na inisyu sa South Korea lang ang sinusuportahan ng awtomatikong pag-renew sa PWA.",
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
