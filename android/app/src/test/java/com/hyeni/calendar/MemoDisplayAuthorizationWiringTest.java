package com.hyeni.calendar;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import org.junit.Test;

public class MemoDisplayAuthorizationWiringTest {

    @Test
    public void newMemoRequiresServerAuthorizationBeforeNotificationDisplay() throws Exception {
        String source = readMainSource("MyFirebaseMessagingService.java");

        int targetPolicy = source.indexOf("NotificationTargetPolicy.evaluate(");
        int typeGuard = source.indexOf("if (\"new_memo\".equals(type))");
        int permitRead = source.indexOf("data.get(\"memoDisplayPermit\")", typeGuard);
        int authorization = source.indexOf("MemoDisplayAuthorizationClient.authorize", permitRead);
        int display = source.indexOf(
            "showNotification(title, body, type, isEmergency, stableId, data)",
            authorization
        );

        assertTrue("기존 target/family/role 검사가 재인가보다 먼저 실행돼야 합니다",
            targetPolicy >= 0 && targetPolicy < typeGuard);
        assertTrue("new_memo 전용 재인가 분기가 필요합니다", typeGuard >= 0);
        assertTrue("memoDisplayPermit을 정확한 키로 읽어야 합니다", permitRead > typeGuard);
        assertTrue("서버 재인가 호출이 필요합니다", authorization > permitRead);
        assertTrue("재인가가 알림 표시보다 먼저 실행돼야 합니다", display > authorization);

        String authorizationGuard = source.substring(typeGuard, display);
        assertTrue("재인가 거부 시 표시 분기를 종료해야 합니다", authorizationGuard.contains("return;"));
        assertFalse("재인가 전에 표시 ACK를 남기면 안 됩니다",
            authorizationGuard.contains("PolledNotificationStore.markAck"));
    }

    @Test
    public void authorizationClientDoesNotLogPermitOrSessionToken() throws Exception {
        String source = readMainSource("MemoDisplayAuthorizationClient.java");

        assertFalse("재인가 클라이언트는 민감값을 로그에 남기면 안 됩니다", source.contains("Log."));
        assertFalse("재인가 공개 endpoint에 access token을 보내면 안 됩니다",
            source.contains(".header(\"Authorization\"")
                || source.contains("Bearer ")
                || source.contains("accessToken"));
    }

    private static String readMainSource(String fileName) throws Exception {
        Path current = Paths.get(System.getProperty("user.dir", ".")).toAbsolutePath();
        for (int depth = 0; depth < 5 && current != null; depth++) {
            Path candidate = current.resolve(
                "app/src/main/java/com/hyeni/calendar/" + fileName
            );
            if (Files.isRegularFile(candidate)) {
                return new String(Files.readAllBytes(candidate), StandardCharsets.UTF_8);
            }
            current = current.getParent();
        }
        throw new AssertionError("Android main source를 찾지 못했습니다: " + fileName);
    }
}
