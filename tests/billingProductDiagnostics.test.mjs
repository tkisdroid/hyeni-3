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

test("Billing Client 9의 미조회 상품 상태와 조회 건수를 토큰 없이 직렬화한다", () => {
  const java = readFileSync(javaPath, "utf8");

  assert.match(java, /import com\.android\.billingclient\.api\.UnfetchedProduct;/);
  assert.match(java, /result\.getUnfetchedProductList\(\)/);
  assert.match(java, /put\("billingResult",\s*billingResultToJson\(billingResult\)\)/);
  assert.match(java, /put\("requestedCount",\s*requestedCount\)/);
  assert.match(java, /put\("returnedCount",\s*productDetailsList\.size\(\)\)/);
  assert.match(java, /put\("unfetchedProducts",\s*unfetchedProducts\)/);
  assert.match(java, /put\("productId",\s*unfetchedProduct\.getProductId\(\)\)/);
  assert.match(java, /put\("productType",\s*unfetchedProduct\.getProductType\(\)\)/);
  assert.match(java, /put\("statusCode",\s*unfetchedProduct\.getStatusCode\(\)\)/);

  const serializer = java.match(
    /private JSObject serializeProductQueryDiagnostics[\s\S]*?\n    }\n\n/,
  )?.[0] ?? "";
  assert.notEqual(serializer, "", "진단 직렬화 메서드를 찾지 못했습니다");
  assert.doesNotMatch(serializer, /purchaseToken|orderId|originalJson|signature/);
});

test("TypeScript는 기존 조회 함수와 별도의 진단 조회 함수를 제공한다", () => {
  const billing = readFileSync(billingPath, "utf8");

  assert.match(billing, /export async function fetchSubscriptionProductDetailsWithDiagnostics/);
  assert.match(
    billing,
    /export async function fetchSubscriptionProductDetails\(\): Promise<BillingProductDetails \| null>/,
  );
  assert.match(billing, /resolveSubscriptionProductQuery\(result, SUBSCRIPTION_PRODUCT_ID\)/);
});
