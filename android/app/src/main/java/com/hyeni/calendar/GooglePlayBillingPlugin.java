package com.hyeni.calendar;

import android.app.Activity;
import android.text.TextUtils;
import android.util.Log;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ConsumeParams;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.ProductDetailsResponseListener;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryProductDetailsResult;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(name = "GooglePlayBilling")
public class GooglePlayBillingPlugin extends Plugin implements PurchasesUpdatedListener {
    private static final String TAG = "HyeniBilling";

    private BillingClient billingClient;
    private boolean connecting = false;
    private final List<Runnable> readyQueue = new ArrayList<>();
    private PluginCall pendingPurchaseCall;

    @Override
    public void load() {
        ensureClient();
    }

    @Override
    protected void handleOnDestroy() {
        if (billingClient != null && billingClient.isReady()) {
            billingClient.endConnection();
        }
        billingClient = null;
        super.handleOnDestroy();
    }

    private void ensureClient() {
        if (billingClient != null) return;
        PendingPurchasesParams pendingPurchasesParams = PendingPurchasesParams
                .newBuilder()
                .enableOneTimeProducts()
                .build();
        billingClient = BillingClient.newBuilder(getContext())
                .setListener(this)
                .enablePendingPurchases(pendingPurchasesParams)
                .enableAutoServiceReconnection()
                .build();
    }

    private void withReady(PluginCall call, Runnable action) {
        ensureClient();
        if (billingClient.isReady()) {
            action.run();
            return;
        }
        readyQueue.add(action);
        if (connecting) return;
        connecting = true;
        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult billingResult) {
                connecting = false;
                if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    rejectCall(call, "billing_unavailable", billingResult);
                    flushReadyQueueWithError("billing_unavailable", billingResult);
                    return;
                }
                List<Runnable> queue = new ArrayList<>(readyQueue);
                readyQueue.clear();
                for (Runnable queuedAction : queue) queuedAction.run();
            }

            @Override
            public void onBillingServiceDisconnected() {
                connecting = false;
                Log.w(TAG, "Billing service disconnected");
            }
        });
    }

    private void flushReadyQueueWithError(String code, BillingResult billingResult) {
        readyQueue.clear();
        if (pendingPurchaseCall != null) {
            rejectCall(pendingPurchaseCall, code, billingResult);
            pendingPurchaseCall = null;
        }
    }

    private void rejectCall(PluginCall call, String code, BillingResult billingResult) {
        if (call == null) return;
        JSObject data = billingResultToJson(billingResult);
        data.put("code", code);
        call.reject(code, code, null, data);
    }

    private JSObject billingResultToJson(BillingResult billingResult) {
        JSObject object = new JSObject();
        object.put("responseCode", billingResult != null ? billingResult.getResponseCode() : -1);
        object.put("debugMessage", billingResult != null ? billingResult.getDebugMessage() : "");
        return object;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        withReady(call, () -> {
            JSObject result = new JSObject();
            result.put("available", true);
            result.put("connected", billingClient.isReady());
            call.resolve(result);
        });
    }

    @PluginMethod
    public void queryProducts(PluginCall call) {
        withReady(call, () -> {
            ArrayList<String> subscriptionIds = readStringArray(call.getArray("subscriptionProductIds"));
            ArrayList<String> inAppIds = readStringArray(call.getArray("inAppProductIds"));
            JSObject response = new JSObject();
            response.put("subscriptions", new JSArray());
            response.put("inAppProducts", new JSArray());
            queryProductType(subscriptionIds, BillingClient.ProductType.SUBS, response, call, () ->
                    queryProductType(inAppIds, BillingClient.ProductType.INAPP, response, call, () -> call.resolve(response))
            );
        });
    }

    @PluginMethod
    public void purchaseSubscription(PluginCall call) {
        String productId = call.getString("productId", "");
        String basePlanId = call.getString("basePlanId", "");
        if (TextUtils.isEmpty(productId)) {
            call.reject("product_required");
            return;
        }
        launchPurchase(call, productId, BillingClient.ProductType.SUBS, basePlanId);
    }

    @PluginMethod
    public void purchaseInAppProduct(PluginCall call) {
        String productId = call.getString("productId", "");
        if (TextUtils.isEmpty(productId)) {
            call.reject("product_required");
            return;
        }
        launchPurchase(call, productId, BillingClient.ProductType.INAPP, null);
    }

    @PluginMethod
    public void acknowledgePurchase(PluginCall call) {
        String purchaseToken = call.getString("purchaseToken", "");
        if (TextUtils.isEmpty(purchaseToken)) {
            call.reject("purchase_token_required");
            return;
        }
        withReady(call, () -> {
            AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
                    .setPurchaseToken(purchaseToken)
                    .build();
            billingClient.acknowledgePurchase(params, billingResult -> {
                if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    call.resolve(new JSObject().put("acknowledged", true));
                } else {
                    rejectCall(call, "acknowledge_failed", billingResult);
                }
            });
        });
    }

    @PluginMethod
    public void consumePurchase(PluginCall call) {
        String purchaseToken = call.getString("purchaseToken", "");
        if (TextUtils.isEmpty(purchaseToken)) {
            call.reject("purchase_token_required");
            return;
        }
        withReady(call, () -> {
            ConsumeParams params = ConsumeParams.newBuilder()
                    .setPurchaseToken(purchaseToken)
                    .build();
            billingClient.consumeAsync(params, (billingResult, token) -> {
                if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    call.resolve(new JSObject().put("consumed", true).put("purchaseToken", token));
                } else {
                    rejectCall(call, "consume_failed", billingResult);
                }
            });
        });
    }

    @PluginMethod
    public void queryPurchases(PluginCall call) {
        withReady(call, () -> {
            JSArray purchases = new JSArray();
            queryPurchasesForType(BillingClient.ProductType.SUBS, purchases, call, () ->
                    queryPurchasesForType(BillingClient.ProductType.INAPP, purchases, call, () ->
                            call.resolve(new JSObject().put("purchases", purchases))
                    )
            );
        });
    }

    private void launchPurchase(PluginCall call, String productId, String productType, String basePlanId) {
        withReady(call, () -> queryProduct(productId, productType, call, productDetails -> {
            String offerToken = pickOfferToken(productDetails, productType, basePlanId);
            if (TextUtils.isEmpty(offerToken)) {
                call.reject("product_offer_unavailable");
                return;
            }

            BillingFlowParams.ProductDetailsParams.Builder detailsBuilder =
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                            .setProductDetails(productDetails)
                            .setOfferToken(offerToken);

            BillingFlowParams flowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(java.util.Collections.singletonList(detailsBuilder.build()))
                    .build();

            Activity activity = getActivity();
            if (activity == null) {
                call.reject("activity_unavailable");
                return;
            }

            if (pendingPurchaseCall != null) {
                call.reject("purchase_already_in_progress");
                return;
            }

            pendingPurchaseCall = call;
            call.setKeepAlive(true);
            BillingResult result = billingClient.launchBillingFlow(activity, flowParams);
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                pendingPurchaseCall = null;
                call.setKeepAlive(false);
                rejectCall(call, "launch_billing_flow_failed", result);
            }
        }));
    }

    private interface ProductDetailsConsumer {
        void accept(ProductDetails productDetails);
    }

    private void queryProduct(String productId, String productType, PluginCall call, ProductDetailsConsumer consumer) {
        ArrayList<String> ids = new ArrayList<>();
        ids.add(productId);
        queryProductDetails(ids, productType, (billingResult, result) -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                rejectCall(call, "query_product_failed", billingResult);
                return;
            }
            List<ProductDetails> detailsList = result.getProductDetailsList();
            if (detailsList == null || detailsList.isEmpty()) {
                call.reject("product_unavailable");
                return;
            }
            consumer.accept(detailsList.get(0));
        });
    }

    private interface ProductQueryDone {
        void run();
    }

    private void queryProductType(ArrayList<String> productIds, String productType, JSObject response, PluginCall call, ProductQueryDone done) {
        if (productIds.isEmpty()) {
            done.run();
            return;
        }
        queryProductDetails(productIds, productType, (billingResult, result) -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                rejectCall(call, "query_products_failed", billingResult);
                return;
            }
            JSArray products = new JSArray();
            for (ProductDetails productDetails : result.getProductDetailsList()) {
                products.put(serializeProduct(productDetails));
            }
            if (BillingClient.ProductType.SUBS.equals(productType)) {
                response.put("subscriptions", products);
            } else {
                response.put("inAppProducts", products);
            }
            done.run();
        });
    }

    private void queryProductDetails(ArrayList<String> productIds, String productType, ProductDetailsResponseListener listener) {
        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (String productId : productIds) {
            if (TextUtils.isEmpty(productId) || seen.contains(productId)) continue;
            seen.add(productId);
            products.add(QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(productId)
                    .setProductType(productType)
                    .build());
        }
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(products)
                .build();
        billingClient.queryProductDetailsAsync(params, listener);
    }

    private void queryPurchasesForType(String productType, JSArray purchases, PluginCall call, Runnable done) {
        QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                .setProductType(productType)
                .build();
        billingClient.queryPurchasesAsync(params, (billingResult, purchaseList) -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                rejectCall(call, "query_purchases_failed", billingResult);
                return;
            }
            if (purchaseList != null) {
                for (Purchase purchase : purchaseList) {
                    purchases.put(serializePurchase(purchase, productType));
                }
            }
            done.run();
        });
    }

    private String pickOfferToken(ProductDetails productDetails, String productType, String basePlanId) {
        if (BillingClient.ProductType.SUBS.equals(productType)) {
            List<ProductDetails.SubscriptionOfferDetails> offers = productDetails.getSubscriptionOfferDetails();
            if (offers == null || offers.isEmpty()) return null;
            for (ProductDetails.SubscriptionOfferDetails offer : offers) {
                if (!TextUtils.isEmpty(basePlanId) && basePlanId.equals(offer.getBasePlanId())) {
                    return offer.getOfferToken();
                }
            }
            return offers.get(0).getOfferToken();
        }

        List<ProductDetails.OneTimePurchaseOfferDetails> offers = productDetails.getOneTimePurchaseOfferDetailsList();
        if (offers == null || offers.isEmpty()) return null;
        return offers.get(0).getOfferToken();
    }

    private JSObject serializeProduct(ProductDetails productDetails) {
        JSObject object = new JSObject();
        object.put("productId", productDetails.getProductId());
        object.put("productType", productDetails.getProductType());
        object.put("title", productDetails.getTitle());
        object.put("name", productDetails.getName());
        object.put("description", productDetails.getDescription());

        JSArray subscriptionOffers = new JSArray();
        List<ProductDetails.SubscriptionOfferDetails> offers = productDetails.getSubscriptionOfferDetails();
        if (offers != null) {
            for (ProductDetails.SubscriptionOfferDetails offer : offers) {
                JSObject offerJson = new JSObject();
                offerJson.put("basePlanId", offer.getBasePlanId());
                offerJson.put("offerId", offer.getOfferId());
                offerJson.put("offerToken", offer.getOfferToken());
                JSArray phases = new JSArray();
                List<ProductDetails.PricingPhase> pricingPhases = offer.getPricingPhases().getPricingPhaseList();
                for (ProductDetails.PricingPhase phase : pricingPhases) {
                    phases.put(new JSObject()
                            .put("formattedPrice", phase.getFormattedPrice())
                            .put("priceAmountMicros", phase.getPriceAmountMicros())
                            .put("priceCurrencyCode", phase.getPriceCurrencyCode())
                            .put("billingPeriod", phase.getBillingPeriod())
                            .put("recurrenceMode", phase.getRecurrenceMode()));
                }
                offerJson.put("pricingPhases", phases);
                subscriptionOffers.put(offerJson);
            }
        }
        object.put("subscriptionOfferDetails", subscriptionOffers);

        JSArray oneTimeOffers = new JSArray();
        List<ProductDetails.OneTimePurchaseOfferDetails> oneTimeOfferDetails = productDetails.getOneTimePurchaseOfferDetailsList();
        if (oneTimeOfferDetails != null) {
            for (ProductDetails.OneTimePurchaseOfferDetails offer : oneTimeOfferDetails) {
                oneTimeOffers.put(new JSObject()
                        .put("offerToken", offer.getOfferToken())
                        .put("formattedPrice", offer.getFormattedPrice())
                        .put("priceAmountMicros", offer.getPriceAmountMicros())
                        .put("priceCurrencyCode", offer.getPriceCurrencyCode()));
            }
        }
        object.put("oneTimePurchaseOfferDetails", oneTimeOffers);
        return object;
    }

    private JSObject serializePurchase(Purchase purchase, String productType) {
        JSObject object = new JSObject();
        JSArray products = new JSArray();
        for (String product : purchase.getProducts()) products.put(product);
        object.put("products", products);
        object.put("productType", productType);
        object.put("purchaseToken", purchase.getPurchaseToken());
        object.put("orderId", purchase.getOrderId());
        object.put("packageName", purchase.getPackageName());
        object.put("purchaseTime", purchase.getPurchaseTime());
        object.put("purchaseState", purchaseStateToString(purchase.getPurchaseState()));
        object.put("acknowledged", purchase.isAcknowledged());
        object.put("quantity", purchase.getQuantity());
        object.put("originalJson", purchase.getOriginalJson());
        object.put("signature", purchase.getSignature());
        return object;
    }

    private String purchaseStateToString(int state) {
        if (state == Purchase.PurchaseState.PURCHASED) return "PURCHASED";
        if (state == Purchase.PurchaseState.PENDING) return "PENDING";
        return "UNSPECIFIED";
    }

    private ArrayList<String> readStringArray(JSArray array) {
        ArrayList<String> values = new ArrayList<>();
        if (array == null) return values;
        for (int index = 0; index < array.length(); index++) {
            String value = array.optString(index, "");
            if (!TextUtils.isEmpty(value)) values.add(value);
        }
        return values;
    }

    @Override
    public void onPurchasesUpdated(BillingResult billingResult, List<Purchase> purchases) {
        PluginCall call = pendingPurchaseCall;
        pendingPurchaseCall = null;
        if (call == null) {
            Log.i(TAG, "Purchase update without pending call: " + billingResult.getResponseCode());
            return;
        }
        call.setKeepAlive(false);

        int code = billingResult.getResponseCode();
        if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
            rejectCall(call, "purchase_canceled", billingResult);
            return;
        }
        if (code != BillingClient.BillingResponseCode.OK || purchases == null || purchases.isEmpty()) {
            rejectCall(call, "purchase_failed", billingResult);
            return;
        }

        Purchase purchase = purchases.get(0);
        if (purchase.getPurchaseState() == Purchase.PurchaseState.PENDING) {
            call.reject("purchase_pending", "purchase_pending", null,
                    new JSObject().put("purchase", serializePurchase(purchase, "")));
            return;
        }
        if (purchase.getPurchaseState() != Purchase.PurchaseState.PURCHASED) {
            call.reject("purchase_not_completed", "purchase_not_completed", null,
                    new JSObject().put("purchase", serializePurchase(purchase, "")));
            return;
        }

        call.resolve(new JSObject().put("purchase", serializePurchase(purchase, "")));
    }
}
