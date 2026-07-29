import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(rootDir, path), "utf8");

const helper = read("android/app/src/main/java/com/hyeni/calendar/NotificationHelper.java");
const layout = read("android/app/src/main/java/com/hyeni/calendar/NotificationLargeIconLayout.java");

test("알림 큰 아이콘은 원본을 자르지 않고 정사각형으로 맞춘 뒤 쓴다", () => {
  const largeIcon = helper.slice(
    helper.indexOf("public static Bitmap largeIcon(Context context)"),
    helper.indexOf("private static int largeIconCanvasPx("),
  );

  assert.notEqual(largeIcon, "");
  // 원본 비율 그대로 정사각 캔버스에 담는다(center-crop 금지 — 머리 위/옷 아래가 잘렸다).
  assert.match(largeIcon, /squareLargeIcon\(source, canvasPx\)/);
  assert.match(helper, /NotificationLargeIconLayout\.contain\(/);
  assert.match(helper, /NotificationLargeIconLayout\.SAFE_RATIO/);
  assert.doesNotMatch(helper, /createScaledBitmap/);
  // 정규화 실패 시에도 알림은 뜬다(원본으로 폴백).
  assert.match(largeIcon, /if \(squared == null\) return source;/);
});

test("큰 아이콘은 알림마다 다시 디코딩하지 않고 크기별로 캐시한다", () => {
  assert.match(helper, /private static Bitmap largeIconCache;/);
  assert.match(helper, /largeIconCacheCanvasPx == canvasPx/);
  assert.match(helper, /synchronized \(LARGE_ICON_LOCK\)/);
  // 큰 원본을 통째로 올리지 않는다.
  assert.match(helper, /inJustDecodeBounds = true/);
  assert.match(helper, /NotificationLargeIconLayout\.sampleSize\(/);
});

test("정사각 맞춤 기하는 Android 프레임워크에 의존하지 않아 JVM 단위 테스트로 검증한다", () => {
  assert.doesNotMatch(layout, /^import android\./m);
  assert.match(layout, /static Box contain\(int sourceWidth, int sourceHeight, int canvasSize, float safeRatio\)/);
  assert.match(layout, /static int clampCanvasSize\(int px\)/);
  assert.match(layout, /static int sampleSize\(int sourceWidth, int sourceHeight, int targetPx\)/);

  const unitTest = read("android/app/src/test/java/com/hyeni/calendar/NotificationLargeIconLayoutTest.java");
  assert.match(unitTest, /portraitSourceIsContainedWithoutCropping/);
  assert.match(unitTest, /canvasSizeIsClampedToSafeRange/);
  assert.match(unitTest, /sampleSizeShrinksLargeSourcesByPowersOfTwo/);
});

test("작은 아이콘은 24dp 뷰포트 안에 원형 마스크가 잘라도 남는 실루엣이다", () => {
  const small = read("android/app/src/main/res/drawable/ic_hyeni_notification.xml");
  assert.match(small, /android:width="24dp"/);
  assert.match(small, /android:viewportWidth="24"/);
  assert.match(small, /android:viewportHeight="24"/);
  // 단색 실루엣만 쓴다(상태바에서 시스템이 tint 하므로 여러 색은 뭉개진다).
  const fills = [...small.matchAll(/android:fillColor="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(new Set(fills), new Set(["#FFFFFFFF"]));
});
