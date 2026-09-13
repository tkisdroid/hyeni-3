import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const service = readFileSync(new URL("../android/app/src/main/java/com/hyeni/calendar/LocationService.java", import.meta.url), "utf8");

test("첫 위치 HTTP가 예외로 끝나도 그 전에 실측 원본을 파일 큐에 저장한다", () => {
  const upload = service.slice(service.indexOf("private void uploadLocation("), service.indexOf("private String formatIsoUtc("));
  assert.ok(upload.indexOf("LocationBuffer.append(") < upload.indexOf(".execute()"));
  const historyRequest = upload.slice(upload.indexOf("historyRecorded = uploaded"));
  assert.ok(historyRequest.indexOf("shouldRecordLocationHistory(") < historyRequest.indexOf("uploadLocationHistory("));
  assert.match(upload.slice(upload.lastIndexOf("} finally {")), /if \(queued \|\| historyRecorded\)/);
});

test("출발 재시도는 디스크의 최초 payload를 전송하고 성공 후 다음 상태와 큐 삭제를 함께 저장한다", () => {
  const dispatch = service.slice(service.indexOf("private void dispatchPendingPlaceAlert("), service.indexOf("private String childDisplayName("));
  assert.ok(dispatch.indexOf("retry.serialize()") < dispatch.indexOf("sendPlaceAlert(retry.payload)"));
  assert.match(dispatch, /isPendingPlaceAlertActive\(placeKey, retry, lifecycleEpoch\)/);
  assert.match(dispatch, /putString\(PLACE_STATE_PREFIX[\s\S]*?remove\(PLACE_RETRY_PREFIX \+ placeKey\)\.commit\(\)/);
  assert.doesNotMatch(dispatch, /placeEpisodeBucket|placePresenceIdempotencyKey/);
});

test("이동 감지 등록은 비동기 성공 후 확정하고 실패한 구독은 heartbeat에서 재시도할 수 있다", () => {
  const registration = service.slice(service.indexOf("private void requestActivityTransitionUpdates("), service.indexOf("private void teardownActivityTransitionTracking("));
  assert.ok(registration.indexOf("activityTransitionRegistered = true") > registration.indexOf(".addOnSuccessListener("));
  assert.match(registration, /addOnFailureListener[\s\S]*?teardownActivityTransitionTracking\(\)/);
  assert.match(registration, /generation != activityTransitionGeneration \|\| serviceStopping/);
  const setup = service.slice(service.indexOf("private void setupActivityTransitionTracking("), service.indexOf("private void requestActivityTransitionUpdates("));
  assert.doesNotMatch(setup, /\.setData\(/);
  assert.match(setup, /activityTransitionRequestCodes\.incrementAndGet\(\)/);
});
