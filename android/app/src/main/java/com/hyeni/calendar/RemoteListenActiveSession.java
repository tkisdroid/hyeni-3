package com.hyeni.calendar;

/**
 * 실행 중인 주변 소리 캡처를 서비스 재기동 없이 찾고 중지하는 세션 게이트.
 *
 * <p>부팅 뒤 복구된 {@link LocationService}가 원격 중지 명령을 받았을 때
 * microphone FGS 컴포넌트에 새 Intent를 보내면 Play가
 * {@code BOOT_COMPLETED -> AmbientListenService.onStartCommand} 경로로 판정한다.
 * 현재 프로세스에 실제로 살아 있는 캡처 소유자만 원자적으로 claim해 호출자가
 * 그 인스턴스를 직접 중지하게 하면 새 서비스 시작 없이 같은 보안 검사를 유지할 수 있다.
 */
final class RemoteListenActiveSession<T> {

    static final class StopRequest<T> {
        private final T owner;
        private final String requestId;
        private final String targetUserId;
        private final String sessionNonce;
        private final boolean shouldDispatch;

        private StopRequest(
                T owner,
                String requestId,
                String targetUserId,
                String sessionNonce,
                boolean shouldDispatch
        ) {
            this.owner = owner;
            this.requestId = requestId;
            this.targetUserId = targetUserId;
            this.sessionNonce = sessionNonce;
            this.shouldDispatch = shouldDispatch;
        }

        T owner() {
            return owner;
        }

        boolean shouldDispatch() {
            return shouldDispatch;
        }
    }

    private T owner;
    private String requestId = "";
    private String targetUserId = "";
    private String sessionNonce = "";
    private boolean stopRequested;

    synchronized boolean reserve(
            T nextOwner,
            String nextRequestId,
            String nextTargetUserId,
            String nextSessionNonce
    ) {
        if (owner != null || nextOwner == null) return false;
        String cleanRequestId = clean(nextRequestId);
        String cleanTargetUserId = clean(nextTargetUserId);
        String cleanSessionNonce = clean(nextSessionNonce);
        if (cleanRequestId.isEmpty() || cleanTargetUserId.isEmpty() || cleanSessionNonce.isEmpty()) {
            return false;
        }
        owner = nextOwner;
        requestId = cleanRequestId;
        targetUserId = cleanTargetUserId;
        sessionNonce = cleanSessionNonce;
        stopRequested = false;
        return true;
    }

    synchronized String activeRequestId() {
        return requestId;
    }

    synchronized boolean hasActive() {
        return owner != null && !requestId.isEmpty();
    }

    synchronized StopRequest<T> requestStopIfMatches(
            String stopRequestId,
            String stopTargetUserId,
            String stopSessionNonce
    ) {
        if (!matchesLocked(stopRequestId, stopTargetUserId, stopSessionNonce)) return null;
        return claimStopLocked();
    }

    synchronized StopRequest<T> requestStopForSession(String retiringSessionNonce) {
        String nonce = clean(retiringSessionNonce);
        if (owner == null || nonce.isEmpty() || !nonce.equals(sessionNonce)) return null;
        return claimStopLocked();
    }

    synchronized boolean isCurrent(StopRequest<T> stop) {
        return stop != null
            && owner == stop.owner
            && requestId.equals(stop.requestId)
            && targetUserId.equals(stop.targetUserId)
            && sessionNonce.equals(stop.sessionNonce);
    }

    synchronized void cancelStop(StopRequest<T> stop) {
        if (isCurrent(stop)) stopRequested = false;
    }

    synchronized void clear(T currentOwner, String currentRequestId) {
        if (owner != currentOwner) return;
        String cleanRequestId = clean(currentRequestId);
        if (!cleanRequestId.isEmpty() && !cleanRequestId.equals(requestId)) return;
        owner = null;
        requestId = "";
        targetUserId = "";
        sessionNonce = "";
        stopRequested = false;
    }

    private boolean matchesLocked(
            String stopRequestId,
            String stopTargetUserId,
            String stopSessionNonce
    ) {
        return owner != null && RemoteListenRequestPolicy.matchesStop(
            requestId,
            stopRequestId,
            targetUserId,
            stopTargetUserId,
            sessionNonce,
            stopSessionNonce
        );
    }

    private StopRequest<T> claimStopLocked() {
        boolean shouldDispatch = !stopRequested;
        stopRequested = true;
        return new StopRequest<>(
            owner,
            requestId,
            targetUserId,
            sessionNonce,
            shouldDispatch
        );
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
