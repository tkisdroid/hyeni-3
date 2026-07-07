import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const locationService = read("android/app/src/main/java/com/hyeni/calendar/LocationService.java");
assert.match(
  locationService,
  /int\s+monthIndex\s*=\s*kst\.get\(Calendar\.MONTH\)/,
  "Android 일정 조회 date_key는 앱 규칙과 같은 0-index 월을 써야 합니다.",
);
assert.doesNotMatch(
  locationService,
  /int\s+month\s*=\s*kst\.get\(Calendar\.MONTH\)\s*\+\s*1/,
  "Android 미도착 조회에 1-index 월 date_key가 남아 있으면 안 됩니다.",
);
assert.match(
  locationService,
  /body\.put\("p_child_user_id",\s*userId\)/,
  "네이티브 parent_alert에는 child_user_id가 포함되어야 합니다.",
);

const visitVerify = read("src/transform/visitVerify.ts");
assert.match(
  visitVerify,
  /VISIT_REQUIRED_COVERAGE\s*=\s*0\.8/,
  "다녀옴 판정은 일정 지속시간의 80% 이상 체류 기준이어야 합니다.",
);
assert.match(
  visitVerify,
  /estimateVisitCoverage/,
  "방문 판정은 단일 포인트가 아니라 체류 커버리지를 계산해야 합니다.",
);

const eventForm = read("src/screens/parent/EventForm.tsx");
assert.match(eventForm, /DURATION_OPTIONS/, "일정 폼에는 지속시간 선택 옵션이 있어야 합니다.");
assert.match(eventForm, /end_time:\s*endTimeValue/, "일정 저장 시 end_time을 함께 저장해야 합니다.");

const parentLocation = read("src/screens/parent/ParentLocation.tsx");
assert.match(parentLocation, /pl-scrub/, "오늘 경로에는 시간대 드래그 슬라이더가 있어야 합니다.");
assert.match(parentLocation, /scheduleMapPlaces/, "오늘 경로 지도에는 오늘 일정 핀이 함께 표시되어야 합니다.");

const placeForm = read("src/screens/feature/PlaceForm.tsx");
assert.match(placeForm, /category:\s*placeType/, "장소 저장 시 선택한 카테고리를 location JSON에 저장해야 합니다.");
assert.match(placeForm, /e\.currentTarget\.setPointerCapture/, "장소 지도 드래그 핸들은 currentTarget pointer capture를 사용해야 합니다.");

const sosReceive = read("src/screens/feature/SosReceive.tsx");
assert.match(sosReceive, /KakaoMap/, "긴급 수신 화면 최상단에는 지도 컴포넌트가 있어야 합니다.");
assert.match(sosReceive, /not_arrived|missed_arrival/, "긴급 수신 화면은 미도착 알림도 처리해야 합니다.");

console.log("hyeni-3 safety regression checks passed");
