import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../capacitor.config.json", import.meta.url), "utf8"));
const mainActivity = readFileSync(
  new URL("../android/app/src/main/java/com/hyeni/calendar/MainActivity.java", import.meta.url),
  "utf8",
);

test("외부 도메인은 Capacitor WebView navigation·native bridge 허용 목록에 넣지 않는다", () => {
  assert.equal(config.server?.allowNavigation, undefined);
});

test("카메라·마이크·위치 WebView 권한은 앱 자체 origin만 통과시킨다", () => {
  assert.match(mainActivity, /WebViewOriginPolicy\.isTrusted\(request\.getOrigin\(\)\.toString\(\)\)/);
  assert.match(mainActivity, /WebViewOriginPolicy\.isTrusted\(origin\)/);
  assert.match(mainActivity, /request\.deny\(\)/);
  assert.match(mainActivity, /callback\.invoke\(origin, false, false\)/);
});
