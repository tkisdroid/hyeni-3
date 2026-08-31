import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const source = read("src/screens/feature/AiCredit.tsx");
const nativeBilling = read("src/lib/native/billing.ts");
const aiEndpoint = read("src/lib/api/endpoints/ai.ts");
const koBilling = JSON.parse(read("locales/ko/billing.json"));
const locales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

function variables(message) {
  return [...message.matchAll(/\{\s*([A-Za-z][A-Za-z0-9_]*)/g)]
    .map((match) => match[1])
    .sort();
}

function koreanStringLiterals(code) {
  const file = ts.createSourceFile("AiCredit.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values = [];
  const visit = (node) => {
    if (ts.isJsxText(node) && /[가-힣]/.test(node.text)) values.push(node.text.trim());
    if (ts.isStringLiteralLike(node) && /[가-힣]/.test(node.text)) values.push(node.text);
    if (ts.isTemplateExpression(node)) {
      const text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");
      if (/[가-힣]/.test(text)) values.push(text.trim());
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return values;
}

test("AI 크레딧 화면은 사용자 문구를 billing Intl 경계로만 렌더링한다", () => {
  assert.match(source, /const intl = useIntl\(\)/);
  assert.deepEqual(koreanStringLiterals(source), []);
  assert.equal(koBilling["billing.aiCredit.title"], "AI 크레딧");
  assert.equal(
    koBilling["billing.aiCredit.creditUse"],
    "AI가 도울 때 크레딧 1회를 써요.",
  );
});

test("AI 크레딧 가격은 Android Google Play 확인 화면만 정본으로 사용한다", () => {
  assert.match(source, /launchCreditPurchase/);
  assert.match(source, /billing\.aiCredit\.packs\.pricePending/);
  assert.doesNotMatch(source, /serverCatalogPrice|catalogPrice|startTossOneTimePayment/);
  assert.doesNotMatch(source, /(?:₩|\bKRW\b|\d[\d,]*원)/);
  assert.doesNotMatch(
    Object.entries(koBilling)
      .filter(([id]) => id.startsWith("billing.aiCredit."))
      .map(([, value]) => value)
      .join("\n"),
    /(?:₩|\bKRW\b|\d[\d,]*원|purchase[_ ]?token|order[_ ]?token)/i,
  );
});

test("iPhone·웹과 Android의 크레딧 구매 한계를 결제 채널별로 정직하게 안내한다", () => {
  assert.match(source, /billing\.aiCredit\.web\.androidOnly/);
  assert.match(source, /billing\.aiCredit\.native\.providerNotice/);
  assert.equal(
    koBilling["billing.aiCredit.web.androidOnly"],
    "AI 크레딧 구매는 Android 앱에서만 가능해요. iPhone·웹에서는 무료 제공량을 이용할 수 있어요.",
  );
  assert.equal(
    koBilling["billing.aiCredit.native.providerNotice"],
    "Android 앱에서는 Google Play가 실제 가격과 결제 가능 여부를 확인해요.",
  );
});

test("결제 완료는 서버가 확인한 같은 주문·팩·수량일 때만 잔액 정본을 다시 읽는다", () => {
  assert.match(source, /isCompletedWebAiCredit\(result\)/);
  assert.match(source, /result\.orderId === input\.pending\.orderId/);
  assert.match(source, /result\.productCode === input\.pending\.productCode/);
  assert.match(source, /result\.credits === input\.pending\.credits/);
  const completed = source.indexOf("isCompletedWebAiCredit(result)");
  const invalidate = source.indexOf("qc.invalidateQueries({ queryKey: qk.aiCredits", completed);
  assert.ok(completed >= 0 && invalidate > completed);
  assert.match(source, /shouldRetainWebAiCreditPending\(error\)/);
  assert.match(source, /savePendingWebAiCreditCheckout\(input\.storage, input\.pending\)/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^\n]*(?:paymentKey|orderId|customerKey|purchaseToken)/);
});

test("Play purchase event claim과 수동 grant는 멱등이고 consume 재시도가 크레딧을 중복 가산하지 않는다", () => {
  const purchaseStart = nativeBilling.indexOf("export async function launchCreditPurchase");
  const verify = nativeBilling.indexOf("const verification = await verifyPurchase", purchaseStart);
  const validate = nativeBilling.indexOf("validateAiCreditGrantImpact(verification, amount)", verify);
  const consume = nativeBilling.indexOf("if (verification.needsClientConsume)", validate);
  assert.ok(purchaseStart >= 0 && verify > purchaseStart && validate > verify && consume > validate);
  assert.match(nativeBilling.slice(consume), /consumePurchase\(\{ purchaseToken: purchase\.purchaseToken \}\)/);
  assert.match(aiEndpoint, /transactionId\?: string/);
  assert.match(aiEndpoint, /input\.transactionId \? \{ transactionId: input\.transactionId \} : \{\}/);
  assert.doesNotMatch(source, /purchaseAiCreditsGrant/);
});

test("아이 이름·서버 잔액·상계량·사용자 설정 원문은 번역하지 않고 ICU 값으로 보존한다", () => {
  assert.match(source, /\{ childName \}/);
  assert.match(source, /\{ count: heroAmount \}/);
  assert.match(source, /\{ debtApplied: result\.debtApplied, available: result\.availableCreditsAdded \}/);
  assert.match(source, /value=\{forbiddenTopicsText\}/);
  assert.doesNotMatch(source, /formatMessage\([^\n]*forbiddenTopicsText/);
});

test("AI 크레딧 billing 문구는 10개 locale에 완전하고 영어 원문 fallback이 없다", () => {
  const catalogs = Object.fromEntries(
    locales.map((locale) => [locale, JSON.parse(read(`locales/${locale}/billing.json`))]),
  );
  const english = catalogs.en;
  const ids = Object.keys(english).filter((id) => id.startsWith("billing.aiCredit.")).sort();
  assert.ok(ids.length >= 70, "AI 크레딧 화면 전체 문구가 필요합니다");
  for (const locale of locales) {
    const localeIds = Object.keys(catalogs[locale]).filter((id) => id.startsWith("billing.aiCredit.")).sort();
    assert.deepEqual(localeIds, ids, `${locale} AI 크레딧 ID가 다릅니다`);
    for (const id of ids) {
      const value = catalogs[locale][id];
      assert.equal(typeof value, "string", `${locale}:${id}`);
      assert.ok(value.trim(), `${locale}:${id}가 비었습니다`);
      assert.deepEqual(variables(value), variables(english[id]), `${locale}:${id} ICU 변수가 다릅니다`);
      const languageBearingEnglish = english[id].replace(/\{[^{}]+\}/g, "");
      if (locale !== "en" && /[A-Za-z]{3}/.test(languageBearingEnglish) && !/Google Play|Android|PWA|AI/i.test(english[id])) {
        assert.notEqual(value, english[id], `${locale}:${id}가 영어 fallback입니다`);
      }
    }
  }
});

test("AI 크레딧 번역은 Premium을 보험·호텔로 오역하거나 claim·결제 토큰을 노출하지 않는다", () => {
  for (const locale of locales) {
    const catalog = JSON.parse(read(`locales/${locale}/billing.json`));
    const values = Object.entries(catalog)
      .filter(([id]) => id.startsWith("billing.aiCredit."))
      .map(([, value]) => value)
      .join("\n");
    assert.doesNotMatch(
      values,
      /(?:insurance|hotel|保费|保費|高级酒店|高級飯店|보험|호텔|bảo hiểm|asuransi|insurans|ประกัน)/iu,
      `${locale}: Premium 보험·호텔 오역`,
    );
    assert.doesNotMatch(
      values,
      /(?:purchase[_ -]?token|order[_ -]?token|구매 토큰|주문 토큰|購入トークン|购买令牌|購買權杖|token pembelian|token pesanan|โทเค็น)/iu,
      `${locale}: 결제 토큰 노출`,
    );
    assert.doesNotMatch(
      values,
      /(?:\bclaim\b|청구|索赔|索賠|理賠|เรียกร้อง|tuntutan|klaim|yêu cầu bồi thường)/iu,
      `${locale}: 내부 claim 의미 노출`,
    );
  }
});
