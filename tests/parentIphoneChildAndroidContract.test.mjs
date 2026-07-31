import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("부모 iPhone PWA는 아이 Android의 원격 기능을 서버 경로로 제어한다", () => {
  const location = read("src/screens/parent/ParentLocation.tsx");
  const home = read("src/screens/parent/ParentHome.tsx");
  const ring = read("src/screens/feature/RemoteRing.tsx");
  const audio = read("src/screens/feature/RemoteAudio.tsx");
  const remoteEndpoint = read("src/lib/api/endpoints/remote.ts");

  assert.match(location, /requestLocationRefresh\(familyId,\s*targetUserId\)/);
  assert.match(home, /requestDeviceStatus\(familyId/);
  assert.match(ring, /useTriggerForceRing\(\)/);
  assert.match(audio, /useRequestRemoteListen\(\)/);
  assert.match(remoteEndpoint, /action:\s*"request_location"/);
  assert.match(remoteEndpoint, /action:\s*"request_device_status"/);
  assert.match(remoteEndpoint, /action:\s*"force_ring"/);
  assert.match(remoteEndpoint, /action:\s*"remote_listen"/);
});

test("부모 주변 소리 화면은 부모 기기의 네이티브 여부로 시작 기능을 막지 않는다", () => {
  const audio = read("src/screens/feature/RemoteAudio.tsx");

  assert.doesNotMatch(audio, /isRemoteListenNativeSupported/);
  assert.doesNotMatch(audio, /\{native\s*\?\s*\(/);
  assert.doesNotMatch(audio, /주변 소리 듣기는 안드로이드 앱에서 지원돼요/);
  assert.match(audio, /preferWebAudioForWav:\s*!isNativePlatform\(\)/);

  const start = audio.indexOf("const startListen = async");
  const playerStart = audio.indexOf("preparedPlayer.start()", start);
  const firstNetworkAwait = audio.indexOf("await isRemoteListenAllowed", start);
  assert.ok(start >= 0 && playerStart > start, "사용자 탭에서 오디오 플레이어를 준비해야 합니다");
  assert.ok(
    firstNetworkAwait > playerStart,
    "iPhone 오디오 권한을 잃지 않도록 첫 네트워크 await 전에 플레이어를 시작해야 합니다",
  );
});

test("부모 위치 설정은 부모 iPhone이 아니라 활성 아이 Android의 보고 상태를 보여준다", () => {
  const settings = read("src/screens/feature/LocationSettings.tsx");

  assert.match(settings, /useActiveChild\(\)/);
  assert.match(settings, /deviceLocationHealthView\(activeChild\?\.device_health/);
  assert.match(settings, /아이 기기 위치 상태/);
  assert.doesNotMatch(settings, /navigator\.geolocation/);
  assert.doesNotMatch(settings, /navigator\.permissions/);
  assert.doesNotMatch(settings, /이 휴대폰의 위치 권한/);
});

test("iPhone Safari에서 웹 푸시가 없으면 홈 화면 앱 설치 방법을 안내한다", () => {
  const settings = read("src/screens/feature/NotificationSettings.tsx");
  const webPush = read("src/lib/webPush.ts");
  const view = read("src/transform/notificationDeliveryView.ts");

  assert.match(webPush, /isIosHomeScreenInstallRequired/);
  assert.match(settings, /isIosHomeScreenInstallRequired\(\)/);
  assert.match(view, /iosHomeScreenInstallRequired/);
  assert.match(view, /Safari 공유 버튼/);
  assert.match(view, /홈 화면에 추가/);
});

test("iPhone 웹 푸시는 사용자 탭에서 권한을 먼저 요청하고 active Worker만 구독한다", () => {
  const webPush = read("src/lib/webPush.ts");
  const ensureStart = webPush.indexOf("export async function ensureWebPushSubscription");
  const permissionCall = webPush.indexOf("Notification.requestPermission()", ensureStart);
  const firstAwait = webPush.indexOf("await ", ensureStart);

  assert.ok(ensureStart >= 0 && permissionCall > ensureStart);
  assert.ok(permissionCall < firstAwait, "iPhone 권한 요청은 첫 await보다 먼저 호출해야 합니다");
  assert.match(webPush, /if \(current\?\.active\) return current/);
  assert.match(webPush, /return ready\?\.active \? ready : null/);
});
