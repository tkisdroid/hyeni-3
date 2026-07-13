package com.hyeni.calendar;

import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.QueryProductDetailsResult;
import com.android.billingclient.api.UnfetchedProduct;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

final class BillingProductQueryDiagnostics {
    private BillingProductQueryDiagnostics() {}

    static ArrayList<String> normalizeProductIds(List<String> productIds) {
        ArrayList<String> normalized = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        if (productIds == null) return normalized;
        for (String productId : productIds) {
            if (productId == null || productId.isEmpty() || !seen.add(productId)) continue;
            normalized.add(productId);
        }
        return normalized;
    }

    static JSObject serialize(BillingResult billingResult, int requestedCount, QueryProductDetailsResult result) {
        List<ProductDetails> productDetailsList = result != null && result.getProductDetailsList() != null
                ? result.getProductDetailsList()
                : java.util.Collections.emptyList();
        JSArray unfetchedProducts = new JSArray();
        List<UnfetchedProduct> unfetchedProductList = result != null ? result.getUnfetchedProductList() : null;
        if (unfetchedProductList != null) {
            for (UnfetchedProduct unfetchedProduct : unfetchedProductList) {
                if (unfetchedProduct == null) continue;
                unfetchedProducts.put(new JSObject()
                        .put("productId", unfetchedProduct.getProductId())
                        .put("productType", unfetchedProduct.getProductType())
                        .put("statusCode", unfetchedProduct.getStatusCode()));
            }
        }
        return new JSObject()
                .put("billingResult", billingResult(billingResult))
                .put("requestedCount", requestedCount)
                .put("returnedCount", productDetailsList.size())
                .put("unfetchedProducts", unfetchedProducts);
    }

    static JSObject responsePayload(JSArray subscriptions, JSArray inAppProducts, JSObject diagnostics) {
        return new JSObject()
                .put("subscriptions", subscriptions != null ? subscriptions : new JSArray())
                .put("inAppProducts", inAppProducts != null ? inAppProducts : new JSArray())
                .put("diagnostics", diagnostics != null ? diagnostics : new JSObject());
    }

    static JSObject errorPayload(String code, BillingResult billingResult, JSObject diagnostics) {
        JSObject payload = billingResult(billingResult).put("code", code);
        if (diagnostics != null) payload.put("diagnostics", diagnostics);
        return payload;
    }

    static JSObject billingResult(BillingResult billingResult) {
        return new JSObject()
                .put("responseCode", billingResult != null ? billingResult.getResponseCode() : -1)
                .put("debugMessage", billingResult != null ? billingResult.getDebugMessage() : "");
    }
}
