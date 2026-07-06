// android/app/src/main/java/com/hyeni/calendar/InAppReviewPlugin.java
package com.hyeni.calendar;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Task;
import com.google.android.play.core.review.ReviewInfo;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

@CapacitorPlugin(name = "InAppReview")
public class InAppReviewPlugin extends Plugin {

    // best-effort: Play 가 실제 표시 여부/결과를 결정하며, 앱은 결과를 알 수 없다.
    // 어떤 실패도 사용자 오류로 노출하지 않고 resolve 한다.
    @PluginMethod
    public void requestReview(final PluginCall call) {
        try {
            final ReviewManager manager = ReviewManagerFactory.create(getContext());
            final Task<ReviewInfo> request = manager.requestReviewFlow();
            request.addOnCompleteListener(task -> {
                if (task.isSuccessful() && getActivity() != null) {
                    ReviewInfo reviewInfo = task.getResult();
                    manager.launchReviewFlow(getActivity(), reviewInfo)
                            .addOnCompleteListener(flow -> call.resolve());
                } else {
                    call.resolve();
                }
            });
        } catch (Exception e) {
            call.resolve();
        }
    }
}
