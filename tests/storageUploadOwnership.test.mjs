import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../src/lib/api/client.ts", import.meta.url), "utf8");
const childPhoto = readFileSync(
  new URL("../src/lib/api/endpoints/childPhoto.ts", import.meta.url),
  "utf8",
);
const memoChat = readFileSync(
  new URL("../src/screens/shared/MemoChat.tsx", import.meta.url),
  "utf8",
);

test("사진 업로드는 client key PUT 대신 목적·대상을 포함한 서버 생성 POST를 사용한다", () => {
  assert.match(client, /\/api\/storage\/child-photo-uploads\//);
  assert.match(client, /method:\s*"POST"/);
  assert.match(client, /X-Hyeni-Upload-Purpose/);
  assert.match(client, /X-Hyeni-Upload-Request-Id/);
  assert.match(client, /X-Hyeni-Target-Member-Id/);
  assert.doesNotMatch(client, /method:\s*"PUT"[\s\S]{0,300}child-photos/);
});

test("사진 업로드는 공통 apiRequest의 401 single-flight refresh와 응답 경로 검증을 재사용한다", () => {
  const start = client.indexOf("export async function apiUploadChildPhoto");
  const end = client.indexOf("export function childPhotoProxyUrl", start);
  const uploadFunction = client.slice(start, end);
  assert.match(uploadFunction, /apiRequest<\{ path: string \}>/);
  assert.doesNotMatch(uploadFunction, /\bfetch\(/);
  assert.match(uploadFunction, /validateChildPhotoUploadResponse/);
  assert.match(client, /segments\[0\]\s*!==\s*familyId/);
  assert.match(client, /segments\[1\]\s*!==\s*"uploads"/);
  assert.match(client, /invalid_upload_response/);
});

test("프로필과 메모는 클라이언트가 만든 경로가 아니라 서버 반환 path를 정본으로 저장한다", () => {
  assert.match(childPhoto, /purpose:\s*"profile"/);
  assert.match(childPhoto, /url:\s*uploaded\.path/);
  assert.match(childPhoto, /return uploaded\.path/);
  assert.match(childPhoto, /purpose:\s*"placeholder"/);

  assert.match(memoChat, /purpose:\s*"memo"/);
  assert.match(memoChat, /targetMemberId:\s*scopeChild\.id/);
  assert.match(memoChat, /encodeImageContent\(uploaded\.path\)/);
  assert.doesNotMatch(memoChat, /const path = `\$\{familyId\}\/memo-/);
});
