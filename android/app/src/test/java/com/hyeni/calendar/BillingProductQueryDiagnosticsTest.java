package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.QueryProductDetailsResult;
import com.android.billingclient.api.UnfetchedProduct;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public class BillingProductQueryDiagnosticsTest {
    @Test
    public void successfulQuerySerializesBillingResultAndCounts() throws Exception {
        BillingResult billingResult = BillingResult.newBuilder()
                .setResponseCode(BillingClient.BillingResponseCode.OK)
                .setDebugMessage("query ok")
                .build();
        QueryProductDetailsResult result = QueryProductDetailsResult.create(
                Collections.singletonList((ProductDetails) null),
                Collections.emptyList()
        );

        JSObject json = BillingProductQueryDiagnostics.serialize(billingResult, 1, result);
        JSObject diagnostics = new JSObject().put("subscriptions", json);
        JSArray subscriptions = new JSArray();
        subscriptions.put(new JSObject().put("productId", "hyeni_premium"));
        JSObject response = BillingProductQueryDiagnostics.responsePayload(
                subscriptions,
                new JSArray(),
                diagnostics
        );

        assertEquals(0, json.getJSObject("billingResult").getInt("responseCode"));
        assertEquals("query ok", json.getJSObject("billingResult").getString("debugMessage"));
        assertEquals(1, json.getInt("requestedCount"));
        assertEquals(1, json.getInt("returnedCount"));
        assertEquals(0, json.getJSONArray("unfetchedProducts").length());
        assertEquals("hyeni_premium", response.getJSONArray("subscriptions")
                .getJSONObject(0).getString("productId"));
        assertEquals(0, response.getJSONArray("inAppProducts").length());
        assertEquals(1, response.getJSObject("diagnostics")
                .getJSObject("subscriptions").getInt("returnedCount"));
        assertNoSensitiveFields(response);
    }

    @Test
    public void partialQuerySerializesUnfetchedProductStatus() throws Exception {
        BillingResult billingResult = BillingResult.newBuilder()
                .setResponseCode(BillingClient.BillingResponseCode.OK)
                .setDebugMessage("")
                .build();
        UnfetchedProduct unfetchedProduct = UnfetchedProduct.fromJson(new JSONObject()
                .put("productId", "hyeni_missing")
                .put("type", BillingClient.ProductType.SUBS)
                .put("statusCode", UnfetchedProduct.StatusCode.NO_ELIGIBLE_OFFER)
                .toString());
        QueryProductDetailsResult result = QueryProductDetailsResult.create(
                Collections.singletonList((ProductDetails) null),
                Collections.singletonList(unfetchedProduct)
        );

        JSObject json = BillingProductQueryDiagnostics.serialize(billingResult, 2, result);
        JSONObject unfetchedJson = json.getJSONArray("unfetchedProducts").getJSONObject(0);

        assertEquals(2, json.getInt("requestedCount"));
        assertEquals(1, json.getInt("returnedCount"));
        assertEquals("hyeni_missing", unfetchedJson.getString("productId"));
        assertEquals(BillingClient.ProductType.SUBS, unfetchedJson.getString("productType"));
        assertEquals(UnfetchedProduct.StatusCode.NO_ELIGIBLE_OFFER, unfetchedJson.getInt("statusCode"));
        assertNoSensitiveFields(json);
    }

    @Test
    public void duplicateAndEmptyProductIdsAreRemovedBeforeQuery() {
        List<String> normalized = BillingProductQueryDiagnostics.normalizeProductIds(Arrays.asList(
                "",
                null,
                "hyeni_premium",
                "hyeni_premium",
                "hyeni_ai_credits_30"
        ));

        assertEquals(Arrays.asList("hyeni_premium", "hyeni_ai_credits_30"), normalized);
    }

    @Test
    public void errorPayloadKeepsTopLevelResultAndNestedDiagnostics() throws Exception {
        BillingResult billingResult = BillingResult.newBuilder()
                .setResponseCode(BillingClient.BillingResponseCode.ITEM_UNAVAILABLE)
                .setDebugMessage("product unavailable")
                .build();
        UnfetchedProduct unfetchedProduct = UnfetchedProduct.fromJson(new JSONObject()
                .put("productId", "hyeni_missing")
                .put("type", BillingClient.ProductType.SUBS)
                .put("statusCode", UnfetchedProduct.StatusCode.PRODUCT_NOT_FOUND)
                .toString());
        JSObject queryDiagnostics = BillingProductQueryDiagnostics.serialize(
                billingResult,
                1,
                QueryProductDetailsResult.create(
                        Collections.emptyList(),
                        Collections.singletonList(unfetchedProduct)
                )
        );
        JSObject diagnostics = new JSObject().put("subscriptions", queryDiagnostics);

        JSObject payload = BillingProductQueryDiagnostics.errorPayload(
                "query_products_failed",
                billingResult,
                diagnostics
        );

        assertEquals(BillingClient.BillingResponseCode.ITEM_UNAVAILABLE, payload.getInt("responseCode"));
        assertEquals("product unavailable", payload.getString("debugMessage"));
        assertEquals("query_products_failed", payload.getString("code"));
        assertEquals(
                UnfetchedProduct.StatusCode.PRODUCT_NOT_FOUND,
                payload.getJSObject("diagnostics")
                        .getJSObject("subscriptions")
                        .getJSONArray("unfetchedProducts")
                        .getJSONObject(0)
                        .getInt("statusCode")
        );
        assertNoSensitiveFields(payload);
    }

    private static void assertNoSensitiveFields(JSObject json) {
        String serialized = json.toString();
        assertFalse(serialized.contains("purchaseToken"));
        assertFalse(serialized.contains("orderId"));
        assertFalse(serialized.contains("originalJson"));
        assertFalse(serialized.contains("signature"));
    }
}
