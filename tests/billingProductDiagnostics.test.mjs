import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const transformPath = resolve(rootDir, "src/transform/billingProductDiagnostics.ts");
const billingPath = resolve(rootDir, "src/lib/native/billing.ts");
const javaPath = resolve(
  rootDir,
  "android/app/src/main/java/com/hyeni/calendar/GooglePlayBillingPlugin.java",
);
const javaHelperPath = resolve(
  rootDir,
  "android/app/src/main/java/com/hyeni/calendar/BillingProductQueryDiagnostics.java",
);

test("구독 상품 조회 결과는 기존 상품과 해당 타입 진단을 함께 선택한다", async () => {
  assert.equal(existsSync(transformPath), true, "결제 상품 진단 변환기가 아직 없습니다");
  const { resolveSubscriptionProductQuery } = await import(pathToFileURL(transformPath).href);

  const result = resolveSubscriptionProductQuery({
    subscriptions: [
      { productId: "other" },
      { productId: "hyeni_premium", name: "혜니 프리미엄" },
    ],
    inAppProducts: [],
    diagnostics: {
      subscriptions: {
        billingResult: { responseCode: 0, debugMessage: "" },
        requestedCount: 2,
        returnedCount: 2,
        unfetchedProducts: [],
      },
    },
  }, "hyeni_premium");

  assert.deepEqual(result, {
    product: { productId: "hyeni_premium", name: "혜니 프리미엄" },
    diagnostics: {
      billingResult: { responseCode: 0, debugMessage: "" },
      requestedCount: 2,
      returnedCount: 2,
      unfetchedProducts: [],
    },
  });
});

test("구버전 네이티브 응답처럼 진단이 없어도 기존 상품 선택은 유지한다", async () => {
  assert.equal(existsSync(transformPath), true, "결제 상품 진단 변환기가 아직 없습니다");
  const { resolveSubscriptionProductQuery } = await import(pathToFileURL(transformPath).href);

  assert.deepEqual(resolveSubscriptionProductQuery({
    subscriptions: [{ productId: "hyeni_premium" }],
  }, "hyeni_premium"), {
    product: { productId: "hyeni_premium" },
    diagnostics: null,
  });
});

test("구독 상품 조회 경계는 상품·빈 결과를 반환하고 네이티브 rejection을 그대로 전파한다", async () => {
  const { querySubscriptionProductWithDiagnostics } = await import(pathToFileURL(transformPath).href);
  assert.equal(
    typeof querySubscriptionProductWithDiagnostics,
    "function",
    "비동기 구독 상품 조회 경계가 아직 없습니다",
  );
  const calls = [];

  const found = await querySubscriptionProductWithDiagnostics(async (options) => {
    calls.push(options);
    return { subscriptions: [{ productId: "hyeni_premium" }] };
  }, "hyeni_premium");
  assert.deepEqual(found, {
    product: { productId: "hyeni_premium" },
    diagnostics: null,
  });

  const missing = await querySubscriptionProductWithDiagnostics(async () => ({
    subscriptions: [],
    diagnostics: {
      subscriptions: {
        billingResult: { responseCode: 4, debugMessage: "unavailable" },
        requestedCount: 1,
        returnedCount: 0,
        unfetchedProducts: [{
          productId: "hyeni_premium",
          productType: "subs",
          statusCode: 3,
        }],
      },
    },
  }), "hyeni_premium");
  assert.equal(missing.product, null);
  assert.equal(missing.diagnostics?.unfetchedProducts[0]?.statusCode, 3);
  assert.deepEqual(calls, [{
    subscriptionProductIds: ["hyeni_premium"],
    inAppProductIds: [],
  }]);

  const nativeError = new Error("native query failed");
  await assert.rejects(
    querySubscriptionProductWithDiagnostics(async () => {
      throw nativeError;
    }, "hyeni_premium"),
    (error) => error === nativeError,
  );
});

test("Billing Client 9의 미조회 상품 상태와 조회 건수를 토큰 없이 직렬화한다", () => {
  const java = readFileSync(javaPath, "utf8");
  const helper = readFileSync(javaHelperPath, "utf8");

  assert.match(java, /BillingProductQueryDiagnostics\.serialize\(/);
  assert.match(java, /BillingProductQueryDiagnostics\.responsePayload\(/);
  assert.match(java, /BillingProductQueryDiagnostics\.errorPayload\(/);
  assert.match(helper, /result\.getUnfetchedProductList\(\)/);
  assert.doesNotMatch(helper, /purchaseToken|orderId|originalJson|signature/);
});

test("TypeScript는 기존 조회 함수와 별도의 진단 조회 함수를 제공한다", () => {
  const billing = readFileSync(billingPath, "utf8");

  assert.match(billing, /export async function fetchSubscriptionProductDetailsWithDiagnostics/);
  assert.match(
    billing,
    /export async function fetchSubscriptionProductDetails\(\): Promise<BillingProductDetails \| null>/,
  );
  assert.match(billing, /querySubscriptionProductWithDiagnostics\(/);
  assert.match(billing, /await fetchSubscriptionProductDetailsWithDiagnostics\(\)/);
});
