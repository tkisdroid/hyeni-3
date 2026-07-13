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
