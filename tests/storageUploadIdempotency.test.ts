import assert from "node:assert/strict";
import test from "node:test";

import {
  acquirePendingChildPhotoUploadRequest,
  clearPendingChildPhotoUploadRequest,
  storageUploadIdempotencyPolicy,
} from "../src/lib/api/storageUploadIdempotency.ts";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function requestId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

test("같은 사진·scope는 앱 재개 뒤에도 24시간 동안 같은 upload request id를 쓴다", async () => {
  const storage = new MemoryStorage();
  const input = {
    familyId: "family-private",
    purpose: "memo" as const,
    targetMemberId: "child-private",
    fileOrBlob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: "image/jpeg" }),
  };
  const first = await acquirePendingChildPhotoUploadRequest(input, {
    storage,
    now: 1000,
    createRequestId: () => requestId(1),
  });
  const resumed = await acquirePendingChildPhotoUploadRequest(input, {
    storage,
    now: 2000,
    createRequestId: () => requestId(2),
  });

  assert.equal(resumed.requestId, first.requestId);
  const persisted = [...storage.values.values()].join("");
  assert.doesNotMatch(persisted, /family-private|child-private/);
  assert.doesNotMatch(persisted, /255|image\/jpeg/);
});

test("성공한 요청은 pending에서 제거되어 이후 명시적 재업로드가 새 id를 받는다", async () => {
  const storage = new MemoryStorage();
  const input = {
    familyId: "family-a",
    purpose: "profile" as const,
    targetMemberId: "child-a",
    fileOrBlob: new Blob(["same-image"]),
  };
  const first = await acquirePendingChildPhotoUploadRequest(input, {
    storage,
    now: 1000,
    createRequestId: () => requestId(3),
  });
  clearPendingChildPhotoUploadRequest(first, { storage, now: 2000 });
  const next = await acquirePendingChildPhotoUploadRequest(input, {
    storage,
    now: 3000,
    createRequestId: () => requestId(4),
  });
  assert.notEqual(next.requestId, first.requestId);
});

test("pending id는 24시간 만료되고 저장 목록은 최근 24건으로 제한된다", async () => {
  const storage = new MemoryStorage();
  const expiredInput = {
    familyId: "family-a",
    purpose: "placeholder" as const,
    fileOrBlob: new Blob(["expired"]),
  };
  const expired = await acquirePendingChildPhotoUploadRequest(expiredInput, {
    storage,
    now: 0,
    createRequestId: () => requestId(5),
  });
  const renewed = await acquirePendingChildPhotoUploadRequest(expiredInput, {
    storage,
    now: storageUploadIdempotencyPolicy.pendingTtlMs,
    createRequestId: () => requestId(6),
  });
  assert.notEqual(renewed.requestId, expired.requestId);

  for (let index = 0; index < 30; index += 1) {
    await acquirePendingChildPhotoUploadRequest({
      familyId: "family-a",
      purpose: "memo",
      targetMemberId: `child-${index}`,
      fileOrBlob: new Blob([`image-${index}`]),
    }, {
      storage,
      now: storageUploadIdempotencyPolicy.pendingTtlMs + index + 1,
      createRequestId: () => requestId(100 + index),
    });
  }
  const state = JSON.parse([...storage.values.values()][0]) as { entries: unknown[] };
  assert.equal(state.entries.length, storageUploadIdempotencyPolicy.maxPendingUploads);
});
