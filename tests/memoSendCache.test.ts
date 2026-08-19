import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const memoCacheUrl = new URL("../src/queries/memoCache.ts", import.meta.url);

test("메시지 POST 성공 행은 재조회 완료 전에도 해당 아이·날짜 캐시에 즉시 반영된다", async () => {
  assert.ok(
    existsSync(fileURLToPath(memoCacheUrl)),
    "전송 성공 행을 즉시 반영하는 memoCache 모듈이 필요하다",
  );

  const [{ QueryClient }, { commitSentMemoReply }] = await Promise.all([
    import("@tanstack/react-query"),
    import(memoCacheUrl.href),
  ]);
  const client = new QueryClient();
  const matchingKey = ["memoReplies", "family-a", "2026-6-12,2026-6-13", "child-a"] as const;
  const allChildrenKey = ["memoReplies", "family-a", "2026-6-13", "all"] as const;
  const otherChildKey = ["memoReplies", "family-a", "2026-6-13", "child-b"] as const;
  const otherDateKey = ["memoReplies", "family-a", "2026-6-11", "child-a"] as const;

  client.setQueryData(matchingKey, [{ id: "old", content: "토요일 메시지" }]);
  client.setQueryData(allChildrenKey, []);
  client.setQueryData(otherChildKey, []);
  client.setQueryData(otherDateKey, []);

  const saved = {
    id: "new",
    family_id: "family-a",
    date_key: "2026-6-13",
    child_id: "child-a",
    user_id: "parent-a",
    user_role: "parent" as const,
    content: "오늘 메시지",
    read_by: [],
    created_at: "2026-07-13T06:56:40.861Z",
  };

  const result = commitSentMemoReply(client, "family-a", saved);

  assert.equal(result, undefined, "후속 정본 재조회 Promise가 전송 완료를 막으면 안 된다");
  assert.deepEqual(
    client.getQueryData<Array<{ id: string }>>(matchingKey)?.map((row) => row.id),
    ["old", "new"],
  );
  assert.deepEqual(
    client.getQueryData<Array<{ id: string }>>(allChildrenKey)?.map((row) => row.id),
    ["new"],
  );
  assert.deepEqual(client.getQueryData(otherChildKey), []);
  assert.deepEqual(client.getQueryData(otherDateKey), []);

  commitSentMemoReply(client, "family-a", { ...saved, content: "서버 정본" });
  const reconciled = client.getQueryData<Array<{ id: string; content: string }>>(matchingKey) ?? [];
  assert.equal(reconciled.filter((row) => row.id === "new").length, 1, "같은 행을 중복 추가하면 안 된다");
  assert.equal(reconciled.find((row) => row.id === "new")?.content, "서버 정본");
});

test("보낸 즉시 말풍선이 서고, 서버 응답이 이상해도 사라지지 않는다", async () => {
  const [{ QueryClient }, cache] = await Promise.all([
    import("@tanstack/react-query"),
    import(memoCacheUrl.href),
  ]);
  const { insertPendingMemoReply, reconcilePendingMemoReply, removeMemoReply, isPendingMemoReply, PENDING_MEMO_ID_PREFIX } = cache;
  const key = ["memoReplies", "family-a", "2026-6-13", "child-a"] as const;

  const pendingId = `${PENDING_MEMO_ID_PREFIX}abc`;
  const pending = {
    id: pendingId,
    family_id: "family-a",
    date_key: "2026-6-13",
    child_id: "child-a",
    user_id: "parent-a",
    user_role: "parent" as const,
    content: "지금 보낸 메시지",
    read_by: [],
    created_at: "2026-08-19T00:00:00.000Z",
  };

  assert.equal(isPendingMemoReply(pending), true, "임시 행은 서버 행과 구분돼야 한다");

  // 1) 서버 왕복 전에 말풍선이 선다.
  const client = new QueryClient();
  client.setQueryData(key, []);
  insertPendingMemoReply(client, "family-a", pending);
  assert.deepEqual(
    client.getQueryData<Array<{ content: string }>>(key)?.map((row) => row.content),
    ["지금 보낸 메시지"],
  );

  // 2) 저장 행이 오면 제자리 교체(중복 없음).
  reconcilePendingMemoReply(client, "family-a", pendingId, { ...pending, id: "saved-1" });
  const afterSave = client.getQueryData<Array<{ id: string }>>(key) ?? [];
  assert.deepEqual(afterSave.map((row) => row.id), ["saved-1"]);

  // 3) 응답이 배열·빈 객체 등 저장 행이 아니면 말풍선을 지우지 않는다.
  const shaky = new QueryClient();
  shaky.setQueryData(key, []);
  insertPendingMemoReply(shaky, "family-a", pending);
  for (const bogus of [[], {}, null, undefined, { id: "", date_key: "2026-6-13" }]) {
    reconcilePendingMemoReply(shaky, "family-a", pendingId, bogus);
    assert.equal(
      (shaky.getQueryData<Array<{ id: string }>>(key) ?? []).length,
      1,
      "서버 응답이 이상해도 방금 보낸 말풍선은 남아야 한다",
    );
  }

  // 4) 전송 실패는 임시 행을 반드시 걷는다('보낸 척' 금지).
  removeMemoReply(shaky, "family-a", pendingId);
  assert.deepEqual(shaky.getQueryData(key), []);
});

test("읽음 처리는 재조회 없이 캐시만 갱신한다", async () => {
  const [{ QueryClient }, cache] = await Promise.all([
    import("@tanstack/react-query"),
    import(memoCacheUrl.href),
  ]);
  const { markMemoReplyRead } = cache;
  const key = ["memoReplies", "family-a", "2026-6-13", "child-a"] as const;
  const client = new QueryClient();
  let refetches = 0;
  const originalInvalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = ((...args: unknown[]) => {
    refetches += 1;
    return (originalInvalidate as (...a: unknown[]) => Promise<void>)(...args);
  }) as typeof client.invalidateQueries;

  client.setQueryData(key, [{ id: "m1", read_by: [] }, { id: "m2", read_by: ["other"] }]);
  markMemoReplyRead(client, "family-a", "m1", "parent-a");
  markMemoReplyRead(client, "family-a", "m2", "parent-a");
  markMemoReplyRead(client, "family-a", "m1", "parent-a"); // 멱등

  assert.equal(refetches, 0, "읽음 표시마다 7일치 스레드를 다시 받으면 대화가 느려진다");
  const rows = client.getQueryData<Array<{ id: string; read_by: string[] }>>(key) ?? [];
  assert.deepEqual(rows.find((row) => row.id === "m1")?.read_by, ["parent-a"]);
  assert.deepEqual(rows.find((row) => row.id === "m2")?.read_by, ["other", "parent-a"]);
});
