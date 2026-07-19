package com.hyeni.calendar;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import org.junit.Test;

public class NotificationDeliveryReceiptTest {

    @Test
    public void postedAndPreviouslyPostedReceiptsCanBeAcknowledged() {
        assertTrue(NotificationHelper.DeliveryReceipt.forStatus(
            NotificationHelper.DeliveryStatus.POSTED
        ).shouldAcknowledge());
        assertTrue(NotificationHelper.DeliveryReceipt.forStatus(
            NotificationHelper.DeliveryStatus.ALREADY_POSTED
        ).shouldAcknowledge());
    }

    @Test
    public void blockedOrFailedReceiptsNeverAcknowledge() {
        NotificationHelper.DeliveryStatus[] failures = {
            NotificationHelper.DeliveryStatus.APP_NOTIFICATIONS_DISABLED,
            NotificationHelper.DeliveryStatus.POST_NOTIFICATIONS_PERMISSION_DENIED,
            NotificationHelper.DeliveryStatus.CHANNEL_DISABLED,
            NotificationHelper.DeliveryStatus.CHANNEL_UNAVAILABLE,
            NotificationHelper.DeliveryStatus.MANAGER_UNAVAILABLE,
            NotificationHelper.DeliveryStatus.NOTIFY_FAILED
        };

        for (NotificationHelper.DeliveryStatus status : failures) {
            assertFalse(NotificationHelper.DeliveryReceipt.forStatus(status).shouldAcknowledge());
        }
    }

    @Test
    public void onlyFreshPostReportsDisplayedNow() {
        assertTrue(NotificationHelper.DeliveryReceipt.forStatus(
            NotificationHelper.DeliveryStatus.POSTED
        ).wasPostedNow());
        assertFalse(NotificationHelper.DeliveryReceipt.forStatus(
            NotificationHelper.DeliveryStatus.ALREADY_POSTED
        ).wasPostedNow());
    }

    @Test
    public void quietSuppressionAcknowledgesWithoutPosting() {
        NotificationHelper.DeliveryReceipt receipt = NotificationHelper.DeliveryReceipt.forStatus(
            NotificationHelper.DeliveryStatus.QUIET_HOURS_SUPPRESSED
        );

        assertTrue(receipt.shouldAcknowledge());
        assertFalse(receipt.wasPostedNow());
    }

    @Test
    public void quietDecisionRunsBeforeAnyDisplaySideEffect() throws IOException {
        String source = readMainSource("NotificationHelper.java");
        int overload = source.indexOf("NotificationQuietHoursPolicy.NotificationIdentity identity");
        int createChannels = source.indexOf("createChannels(context)", overload);
        int quietDecision = source.indexOf("NotificationQuietHoursStore.decide(", overload);
        int permission = source.indexOf("ContextCompat.checkSelfPermission", overload);
        int channelState = source.indexOf("NotificationManagerCompat.from(context)", overload);
        int dedupe = source.indexOf("wasRecentlyPosted(context, requestCode)", overload);
        int wakeLock = source.indexOf("if (wakeScreen)", overload);
        int notify = source.indexOf("nm.notify(requestCode", overload);
        int markPosted = source.indexOf("markPosted(context, requestCode)", overload);

        assertTrue("identity overload가 있어야 합니다", overload >= 0);
        assertTrue("quiet 정책은 채널 생성보다 먼저 실행해야 합니다", quietDecision >= 0 && quietDecision < createChannels);
        assertTrue("quiet 정책은 권한 확인보다 먼저 실행해야 합니다", quietDecision < permission);
        assertTrue("quiet 정책은 채널 상태 확인보다 먼저 실행해야 합니다", quietDecision < channelState);
        assertTrue("quiet 정책은 중복 확인보다 먼저 실행해야 합니다", quietDecision < dedupe);
        assertTrue("quiet 정책은 wake lock보다 먼저 실행해야 합니다", quietDecision < wakeLock);
        assertTrue("quiet 정책은 notify보다 먼저 실행해야 합니다", quietDecision < notify);
        assertTrue("quiet 정책은 게시 기록보다 먼저 실행해야 합니다", quietDecision < markPosted);
    }

    private static String readMainSource(String fileName) throws IOException {
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
