package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.net.SocketTimeoutException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;

import org.junit.Test;

public class MemoDisplayAuthorizationClientTest {

    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    @Test
    public void strictAllowedResponseUsesExactPublicEndpointAndPermitBody() throws Exception {
        AtomicReference<Request> captured = new AtomicReference<>();
        OkHttpClient client = responseClient(200, "{\"allowed\":true}", captured);

        assertTrue(MemoDisplayAuthorizationClient.authorize(
            client,
            "https://api.example.test/",
            "signed-permit"
        ));

        Request request = captured.get();
        assertEquals("POST", request.method());
        assertEquals(
            "https://api.example.test/api/push-notify/memo-display-authorize",
            request.url().toString()
        );
        assertEquals("application/json", request.header("Content-Type"));
        assertNull("서명 permit 공개 endpoint에는 bearer token이 필요하지 않습니다",
            request.header("Authorization"));

        Buffer body = new Buffer();
        request.body().writeTo(body);
        assertEquals("{\"permit\":\"signed-permit\"}", body.readUtf8());
    }

    @Test
    public void anythingExceptBooleanTrueOnSuccessfulJsonFailsClosed() {
        Object[][] rejected = {
            {200, "{\"allowed\":false}"},
            {200, "{}"},
            {200, "{\"allowed\":\"true\"}"},
            {200, "{\"allowed\":true,\"extra\":1}"},
            {200, "not-json"},
            {503, "{\"allowed\":true}"},
            {204, ""}
        };

        for (Object[] item : rejected) {
            assertFalse(MemoDisplayAuthorizationClient.authorize(
                responseClient((Integer) item[0], (String) item[1], null),
                "https://api.example.test",
                "signed-permit"
            ));
        }
    }

    @Test
    public void unsafeBackendUrlsFailBeforePermitLeavesTheDevice() {
        AtomicInteger calls = new AtomicInteger();
        OkHttpClient client = new OkHttpClient.Builder()
            .addInterceptor(chain -> {
                calls.incrementAndGet();
                return new Response.Builder()
                    .request(chain.request())
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("test")
                    .body(ResponseBody.create("{\"allowed\":true}", JSON))
                    .build();
            })
            .build();
        String[] rejectedUrls = {
            "http://api.example.test",
            "https://user:pass@api.example.test",
            "https://api.example.test?next=https://other.example",
            "https://api.example.test/#fragment"
        };

        for (String rejectedUrl : rejectedUrls) {
            assertFalse(MemoDisplayAuthorizationClient.authorize(
                client,
                rejectedUrl,
                "signed-permit"
            ));
        }
        assertEquals(0, calls.get());
    }

    @Test
    public void missingContextOrPermitFailsBeforeNetwork() {
        AtomicInteger calls = new AtomicInteger();
        OkHttpClient client = new OkHttpClient.Builder()
            .addInterceptor(chain -> {
                calls.incrementAndGet();
                throw new IOException("호출되면 안 됩니다");
            })
            .build();

        assertFalse(MemoDisplayAuthorizationClient.authorize(client, "", "signed-permit"));
        assertFalse(MemoDisplayAuthorizationClient.authorize(client, "https://api.example.test", ""));
        assertFalse(MemoDisplayAuthorizationClient.authorize(
            client,
            "https://api.example.test",
            "x".repeat(3_073)
        ));
        assertFalse(MemoDisplayAuthorizationClient.authorize(null, "https://api.example.test", "signed-permit"));
        assertEquals(0, calls.get());
    }

    @Test
    public void networkAndTimeoutFailuresFailClosed() {
        OkHttpClient networkFailure = new OkHttpClient.Builder()
            .addInterceptor(chain -> {
                throw new IOException("network unavailable");
            })
            .build();
        OkHttpClient timeout = new OkHttpClient.Builder()
            .addInterceptor(chain -> {
                throw new SocketTimeoutException("deadline");
            })
            .build();

        assertFalse(MemoDisplayAuthorizationClient.authorize(
            networkFailure,
            "https://api.example.test",
            "signed-permit"
        ));
        assertFalse(MemoDisplayAuthorizationClient.authorize(
            timeout,
            "https://api.example.test",
            "signed-permit"
        ));
    }

    @Test
    public void productionClientHasFiveSecondOverallDeadline() {
        OkHttpClient client = MemoDisplayAuthorizationClient.newHttpClient();

        assertEquals(5_000, client.connectTimeoutMillis());
        assertEquals(5_000, client.readTimeoutMillis());
        assertEquals(5_000, client.writeTimeoutMillis());
        assertEquals(5_000, client.callTimeoutMillis());
    }

    private static OkHttpClient responseClient(
            int statusCode,
            String responseBody,
            AtomicReference<Request> captured
    ) {
        return new OkHttpClient.Builder()
            .callTimeout(5, TimeUnit.SECONDS)
            .addInterceptor(chain -> {
                Request request = chain.request();
                if (captured != null) captured.set(request);
                return new Response.Builder()
                    .request(request)
                    .protocol(Protocol.HTTP_1_1)
                    .code(statusCode)
                    .message("test")
                    .body(ResponseBody.create(responseBody, JSON))
                    .build();
            })
            .build();
    }
}
