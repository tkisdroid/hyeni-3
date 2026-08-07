import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const memoSource = readFileSync(
  new URL("../src/screens/shared/MemoChat.tsx", import.meta.url),
  "utf8",
);
const clientSource = readFileSync(
  new URL("../src/lib/api/client.ts", import.meta.url),
  "utf8",
);
const privateObjectCacheSource = readFileSync(
  new URL("../src/lib/api/privateObjectUrlCache.ts", import.meta.url),
  "utf8",
);
const sessionSource = readFileSync(
  new URL("../src/lib/api/session.ts", import.meta.url),
  "utf8",
);
const avatarSource = readFileSync(
  new URL("../src/lib/avatar.ts", import.meta.url),
  "utf8",
);
const kakaoMapSource = readFileSync(
  new URL("../src/components/KakaoMap.tsx", import.meta.url),
  "utf8",
);
const profileEditSource = readFileSync(
  new URL("../src/screens/feature/ProfileEdit.tsx", import.meta.url),
  "utf8",
);
const familyEndpointSource = readFileSync(
  new URL("../src/lib/api/endpoints/family.ts", import.meta.url),
  "utf8",
);
const familyQuerySource = readFileSync(
  new URL("../src/queries/useFamily.ts", import.meta.url),
  "utf8",
);
const longPressSource = readFileSync(
  new URL("../src/lib/useLongPress.ts", import.meta.url),
  "utf8",
);

test("비공개 사진은 JWT query URL 없이 Authorization fetch와 blob URL로 표시한다", () => {
  assert.doesNotMatch(clientSource, /childPhotoProxyUrl|teacherNoticeFileProxyUrl|\?token=/);
  assert.match(clientSource, /headers: \{ Accept: "image\/\*,application\/pdf" \}/);
  assert.match(clientSource, /Authorization:\s*`Bearer \$\{accessToken\}`/);
  assert.match(clientSource, /URL\.createObjectURL\(blob\)/);
  assert.match(clientSource, /acquirePrivateObjectUrl\(\s*`child:\$\{normalized\}`/);
  assert.match(clientSource, /acquirePrivateObjectUrl\(\s*`teacher:\$\{relativePath\}`/);
  assert.match(clientSource, /validatePrivateObjectPath\(path\)/);
  assert.match(clientSource, /validatePrivateObjectPath\(teacherNoticeRelativeKey/);
  assert.match(clientSource, /new AbortController\(\)/);
  assert.match(clientSource, /leaseSignal\.addEventListener\("abort", abortForRetiredLease/);
  assert.match(clientSource, /fetchPrivateObjectUrl\(apiPath, signal\)/);
  assert.match(clientSource, /cache: "no-store"/);
  assert.match(clientSource, /private_object_timeout/);
  assert.match(clientSource, /Promise\.race\(\[requestPromise, timeout\]\)/);
  assert.match(privateObjectCacheSource, /loader: \(signal: AbortSignal\) => Promise<string>/);
  assert.match(privateObjectCacheSource, /entry\.controller\.abort\(\)/);
  assert.match(sessionSource, /clearPrivateObjectUrlCache\(\)/);

  assert.doesNotMatch(memoSource, /childPhotoProxyUrl|\?token=/);
  assert.match(memoSource, /setPreviewImagePath\(m\.imagePath \?\? null\)/);
  assert.match(memoSource, /src=\{previewImage\.url\}/);
  assert.match(memoSource, /saveImageToDevice\(previewImageUrl\)/);
  assert.match(memoSource, /IntersectionObserver/);
  assert.match(memoSource, /lease\.release\(\)/);
  assert.match(memoSource, /사진을 불러오지 못했어요/);
  assert.match(memoSource, /사진을 불러오지 못했어\. 눌러서 다시 시도해 줘\./);
  assert.match(memoSource, /isChildSession=\{isChildSession\}/);
  assert.match(memoSource, /if \(event\.defaultPrevented\) return/);
  assert.match(longPressSource, /if \(firedRef\.current\)[\s\S]*?event\.preventDefault\(\)/);
  assert.match(memoSource, /onClick=\{previewImage\.retry\}/);
  assert.match(memoSource, /verifyPrivateImageDecode\(/);
  assert.match(memoSource, /onError=\{\(\) => photo\.markError\(photo\.url\)\}/);
  assert.match(memoSource, /onError=\{\(\) => previewImage\.markError\(previewImage\.url\)\}/);
  assert.match(memoSource, /disabled=\{savingPhoto \|\| !previewImageUrl\}/);
  assert.match(memoSource, /data-ready=\{previewGestureReady \? "true" : undefined\}/);
  assert.match(
    memoSource,
    /onPointerDown=\{previewGestureReady \? photoZoom\.handlers\.onPointerDown : undefined\}/,
  );
  assert.doesNotMatch(memoSource, /openExternal\s*\(\s*previewImageUrl/);
});

test("가족 정본 조회는 사진 blob 완료와 분리하고 UI 수명 lease에서만 사진을 합성한다", () => {
  assert.doesNotMatch(familyEndpointSource, /childPhotoObjectUrl|enrichPhotos|await\s+.*photo/i);
  assert.match(familyEndpointSource, /members: data\.members \|\| \[\]/);
  assert.match(familyQuerySource, /useResolvedFamilyPhotos/);
  assert.match(familyQuerySource, /acquireChildPhotoObjectUrl\(request\.path\)/);
  assert.match(familyQuerySource, /FAMILY_PHOTO_RETRY_DELAYS_MS = \[750, 2_000, 5_000\]/);
  assert.match(familyQuerySource, /scheduleRetry\(request, retryIndex\)/);
  assert.match(familyQuerySource, /clearTimeout\(timer\)/);
  assert.match(familyQuerySource, /lease\.release\(\)/);
  assert.match(familyQuerySource, /photo_url: urls\.get\(member\.id\) \?\? null/);
});

test("가족 사진 blob URL은 공통 아바타·지도 오버레이·프로필 미리보기에서 asset 경로로 변형하지 않는다", () => {
  assert.match(avatarSource, /value\.startsWith\("blob:"\)/);
  assert.match(kakaoMapSource, /path\.startsWith\("blob:"\) \? path : asset\(path\)/);
  assert.match(profileEditSource, /member\.photo_url\.startsWith\("blob:"\)/);
});

test("사진 확대는 앱 내부 접근 가능한 dialog에서 닫을 수 있다", () => {
  assert.match(memoSource, /className="mc-photo-preview"/);
  assert.match(memoSource, /role="dialog"/);
  assert.match(memoSource, /aria-modal="true"/);
  assert.match(memoSource, /setPreviewImagePath\(null\)/);
});
