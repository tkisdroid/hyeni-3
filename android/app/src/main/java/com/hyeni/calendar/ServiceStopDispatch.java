package com.hyeni.calendar;

/**
 * 서비스 중지 의도를 크래시 없이 전달하는 순수 정책.
 *
 * <p>중지 액션은 서비스의 {@code onStartCommand} 정리 분기를 타야 하므로 {@code startService}로
 * 보내야 한다. 그런데 Android 12+는 앱이 백그라운드일 때 그 호출에
 * {@code BackgroundServiceStartNotAllowedException}을 던지고, 잡지 않으면 앱이 죽는다.
 * 실제로 부모 기기에서 백그라운드 전환 중 위치 서비스 중지가 앱을 종료시켰다.
 *
 * <p>그래서 전달이 막히면 정리 분기를 포기하는 대신 서비스 자체를 중지해 닫는다. 중지마저
 * 실패해도 예외를 밖으로 내보내지 않는다 — 중지 실패는 크래시보다 언제나 낫다.
 */
final class ServiceStopDispatch {

    /** {@code Context.startService} 호출부. */
    interface Starter {
        void start();
    }

    /** {@code Context.stopService} 호출부. */
    interface Stopper {
        void stop();
    }

    enum Outcome {
        /** 중지 액션이 서비스에 전달됐다(정리 분기 실행). */
        DELIVERED("stopped"),
        /** 전달이 막혀 서비스를 직접 중지했다(정리 분기 미실행). */
        FORCE_STOPPED("force_stopped"),
        /** 전달과 중지가 모두 실패했다. */
        FAILED("stop_failed");

        private final String status;

        Outcome(String status) {
            this.status = status;
        }

        /** JS 계약에 그대로 나가는 상태 문자열. */
        String status() {
            return status;
        }
    }

    private ServiceStopDispatch() {}

    static Outcome deliver(Starter starter, Stopper stopper) {
        try {
            starter.start();
            return Outcome.DELIVERED;
        } catch (RuntimeException startError) {
            try {
                stopper.stop();
                return Outcome.FORCE_STOPPED;
            } catch (RuntimeException stopError) {
                return Outcome.FAILED;
            }
        }
    }
}
