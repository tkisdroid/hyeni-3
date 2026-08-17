/**
 * 부모 본인 프로필 사진(2026-08-17 TK 요청 "부모도 프로필 사진을 등록할 수 있게").
 *
 * 계약:
 *  · 업로드 목적은 parent_profile 이고 대상은 항상 caller 자기 멤버 행이다(대리 변경 불가).
 *  · 저장 경로는 서버가 발급한 path 를 그대로 photo_url 로 쓴다(클라가 키를 만들지 않는다).
 *  · 멤버 사진은 표시용 blob URL로 해석한 뒤에만 <img src> 에 들어간다(객체 키 직접 사용 금지).
 *  · 부모 아바타 기본값은 성별 캐릭터 하나의 출처(parentAvatarPath)에서만 나온다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(resolve(rootDir, relativePath), "utf8");

const client = read("src/lib/api/client.ts");
const childPhoto = read("src/lib/api/endpoints/childPhoto.ts");
const useFamily = read("src/queries/useFamily.ts");
const useAccount = read("src/queries/useAccount.ts");
const memberPhotos = read("src/queries/memberPhotos.ts");
const parentAccount = read("src/screens/parent/ParentAccount.tsx");
const parentAccountCss = read("src/screens/parent/ParentAccount.css");
const parentSettings = read("src/screens/parent/ParentSettings.tsx");
const avatar = read("src/lib/avatar.ts");
const familyView = read("src/transform/familyView.ts");
const memoChat = read("src/screens/shared/MemoChat.tsx");
const familyConnection = read("src/screens/feature/FamilyConnection.tsx");
const workerStorage = read("worker/routes/storage.ts");
const workerFamily = read("worker/routes/family.ts");
const workerJournal = read("worker/lib/storageInvalidUploadCleanup.ts");
const koParent = JSON.parse(read("locales/ko/parent.json"));

test("부모 사진 업로드는 parent_profile 목적과 본인 멤버 대상으로만 요청한다", () => {
  assert.match(client, /ChildPhotoUploadPurpose =[^;]*"parent_profile"/);
  assert.match(childPhoto, /export async function uploadMyParentPhoto/);
  assert.match(childPhoto, /purpose: "parent_profile"/);
  assert.match(childPhoto, /targetMemberId: memberId/);
  // 저장 경로는 서버 발급 path 정본을 그대로 쓴다.
  assert.match(childPhoto, /url: uploaded\.path/);
  assert.match(childPhoto, /return uploaded\.path/);
});

test("업로드 성공은 가족·계정 캐시를 함께 무효화해 새 아바타가 바로 보인다", () => {
  const hook = useFamily.slice(useFamily.indexOf("export function useUploadMyPhoto"));
  assert.match(hook, /uploadMyParentPhoto\(familyId, input\.memberId, input\.dataUrl\)/);
  assert.match(hook, /qk\.family\(familyId\)/);
  assert.match(hook, /qk\.account\(familyId\)/);
});

test("멤버 사진은 가족·계정 조회가 같은 lease 규칙으로 표시용 URL을 만든다", () => {
  // 객체 키를 그대로 img src 로 쓰면 화면에 안 나온다 — 두 훅이 같은 해석기를 쓴다.
  assert.match(memberPhotos, /export function useResolvedMemberPhotoUrls/);
  assert.match(memberPhotos, /acquireChildPhotoObjectUrl/);
  assert.match(memberPhotos, /export function withResolvedMemberPhotos/);
  for (const source of [useFamily, useAccount]) {
    assert.match(source, /useResolvedMemberPhotoUrls/);
    assert.match(source, /withResolvedMemberPhotos/);
  }
  assert.doesNotMatch(useFamily, /const FAMILY_PHOTO_RETRY_DELAYS_MS/, "사진 해석 로직을 다시 복제하면 안 된다");
});

test("계정 화면은 내 사진을 눌러 등록하고 실패를 저장된 것처럼 보여주지 않는다", () => {
  assert.match(parentAccount, /useUploadMyPhoto/);
  assert.match(parentAccount, /purpose|parent\.parentAccount\.photo\.hint/);
  // 대상은 내 멤버 행(me.id) — 첫 부모나 임의 멤버로 폴백하지 않는다.
  assert.match(parentAccount, /uploadMyPhoto\.mutateAsync\(\{ memberId: me\.id, dataUrl \}\)/);
  assert.match(parentAccount, /aria-busy=\{photoBusy\}/);
  assert.match(parentAccount, /hy-busy-center/, "아이콘 자리에 링을 겹쳐야 사진이 밀리지 않는다");
  assert.match(parentAccount, /setPhotoDataUrl\(null\); \/\/ 저장 실패/);
  assert.match(parentAccount, /data-photo=\{hasOwnPhoto \? "true" : "false"\}/);
  assert.match(parentAccountCss, /\.pa-profile__avatar--edit\[data-photo="true"\] img/);
  assert.match(parentAccountCss, /object-fit: cover/);
  assert.equal(koParent["parent.parentAccount.photo.set"], "프로필 사진 등록");
  assert.equal(koParent["parent.parentAccount.photo.change"], "프로필 사진 바꾸기");
  assert.match(koParent["parent.parentAccount.photo.hint"], /사진을 누르면/);
});

test("부모 아바타 기본값은 한 출처에서만 나오고 아빠 계정에 엄마 캐릭터를 쓰지 않는다", () => {
  assert.match(avatar, /export function parentAvatarPath/);
  assert.match(avatar, /gender === "dad" \? "family\/dad\.webp" : "family\/mom\.webp"/);
  for (const [name, source] of [
    ["familyView", familyView],
    ["MemoChat", memoChat],
    ["FamilyConnection", familyConnection],
    ["ParentSettings", parentSettings],
  ]) {
    assert.match(source, /parentAvatarPath/, `${name} 는 공용 부모 아바타 해석을 써야 한다`);
  }
  assert.doesNotMatch(memoChat, /role === "parent" \? "family\/mom\.webp"/);
  assert.doesNotMatch(familyConnection, /p\.gender === "dad" \? "family\/dad\.webp"/);
});

test("서버는 부모 프로필 목적을 자기 멤버 행에만 허용하고 가족 조회는 열어 둔다", () => {
  assert.match(workerStorage, /value === "parent_profile"/);
  const authorize = workerStorage.slice(
    workerStorage.indexOf("async function authorizeChildPhotoUpload"),
    workerStorage.indexOf("async function storageMutationState"),
  );
  assert.match(authorize, /purpose === "parent_profile"/);
  assert.match(authorize, /fm\.role = 'parent' AND fm\.is_active = 1/);
  assert.match(authorize, /fm\.user_id = \?/, "대상은 caller 본인 행이어야 한다");
  // 조회는 같은 가족 구성원이 아바타를 볼 수 있도록 profile 과 같은 판정을 쓴다.
  assert.match(workerStorage, /\["memo", "profile", "placeholder", "parent_profile"\]/);
  assert.match(workerStorage, /purpose === "profile" \|\| purpose === "parent_profile"/);
  // 업로드 journal 도 같은 소유권을 SQL 로 다시 확인한다(우회 경로 방지).
  assert.match(workerJournal, /kind: "parent_profile"; targetMemberId: string/);
  assert.match(workerJournal, /\?12='parent_profile'[\s\S]{0,240}target\.user_id=\?4/);
});

test("photo_url 저장은 주 보호자 외에는 본인 멤버 + 서버 발급 키만 받는다", () => {
  const route = workerFamily.slice(
    workerFamily.indexOf("const OWN_UPLOAD_PHOTO_KEY"),
    workerFamily.indexOf("// ── POST /unpair"),
  );
  assert.match(route, /uploads\\\//, "서버 발급 uploads 키 형식을 검증해야 한다");
  assert.match(route, /segments\[0\] === familyId && segments\[2\] === userId/);
  assert.match(route, /isOwnActiveParentMember/);
  assert.match(route, /fm\.role = 'parent' AND fm\.is_active = 1/);
  assert.match(route, /assertPrimaryParent\(c\.env\.DB, userId, familyId\)/);
  assert.match(route, /error: "Not authorized" \}, 403/);
});
