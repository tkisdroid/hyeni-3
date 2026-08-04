import test from "node:test";
import assert from "node:assert/strict";
import {
  extractPrivateChildPhotoPath,
  validatePrivateObjectPath,
} from "../src/transform/childPhotoPath.ts";

test("child-photos Worker 및 레거시 URL에서 객체 키만 안전하게 추출한다", () => {
  assert.equal(
    extractPrivateChildPhotoPath("https://api.example/api/storage/child-photos/fam%2Fuploads%2Fu%2Fphoto.jpg?x=1"),
    "fam/uploads/u/photo.jpg",
  );
  assert.equal(
    extractPrivateChildPhotoPath("https://storage.example/storage/v1/object/sign/child-photos/fam/uploads/u/photo.jpg?token=old"),
    "fam/uploads/u/photo.jpg",
  );
});

test("raw 객체 키는 유지하고 공개·로컬 URL은 private fetch 대상으로 오인하지 않는다", () => {
  assert.equal(extractPrivateChildPhotoPath("fam/uploads/u/photo.jpg"), "fam/uploads/u/photo.jpg");
  assert.equal(extractPrivateChildPhotoPath("https://cdn.example/photo.jpg"), null);
  assert.equal(extractPrivateChildPhotoPath("blob:https://app.example/id"), null);
  assert.equal(extractPrivateChildPhotoPath("data:image/png;base64,abc"), null);
  assert.equal(extractPrivateChildPhotoPath("  "), null);
  assert.equal(extractPrivateChildPhotoPath(null), null);
});

test("브라우저 URL 정규화를 일으킬 수 있는 경로와 비정상 가족 키를 거부한다", () => {
  assert.equal(extractPrivateChildPhotoPath("family-a/../account"), null);
  assert.equal(extractPrivateChildPhotoPath("family-a/./photo.jpg"), null);
  assert.equal(extractPrivateChildPhotoPath("family-a\\photo.jpg"), null);
  assert.equal(extractPrivateChildPhotoPath("/family-a/photo.jpg"), null);
  assert.equal(extractPrivateChildPhotoPath("family a/photo.jpg"), null);
  assert.equal(
    extractPrivateChildPhotoPath("https://api.example/api/storage/child-photos/family-a%2F..%2Faccount"),
    null,
  );
  assert.equal(validatePrivateObjectPath("family-a/../../api/family/mine"), null);
  assert.equal(validatePrivateObjectPath("teacher-id/../account"), null);
  assert.equal(validatePrivateObjectPath("teacher-id/files/notice.pdf"), "teacher-id/files/notice.pdf");
});
