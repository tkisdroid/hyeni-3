import assert from "node:assert/strict";
import test from "node:test";

import { loadNamespaceAtomically } from "../src/i18n/catalog.ts";

test("선택 locale 청크가 실패하면 namespace 전체를 영어로 대체한다", async () => {
  const attempted: string[] = [];
  const result = await loadNamespaceAtomically({
    locale: "vi",
    namespace: "parent",
    load: async (locale) => {
      attempted.push(locale);
      if (locale === "vi") throw new Error("chunk_failed");
      return locale === "en"
        ? { "parent.title": "Family" }
        : { "parent.title": "가족" };
    },
  });

  assert.deepEqual(attempted, ["vi", "en"]);
  assert.equal(result.resolvedLocale, "en");
  assert.deepEqual(result.messages, { "parent.title": "Family" });
});

test("영어 청크도 실패하면 namespace 전체를 한국어로 대체한다", async () => {
  const attempted: string[] = [];
  const result = await loadNamespaceAtomically({
    locale: "th",
    namespace: "notifications",
    load: async (locale) => {
      attempted.push(locale);
      if (locale !== "ko") throw new Error(`${locale}_chunk_failed`);
      return {
        "notifications.title": "알림",
        "notifications.detail": "아이의 안전 소식",
      };
    },
  });

  assert.deepEqual(attempted, ["th", "en", "ko"]);
  assert.equal(result.resolvedLocale, "ko");
  assert.deepEqual(result.messages, {
    "notifications.title": "알림",
    "notifications.detail": "아이의 안전 소식",
  });
});

test("선택 locale 청크가 성공하면 fallback 메시지를 섞지 않는다", async () => {
  const attempted: string[] = [];
  const result = await loadNamespaceAtomically({
    locale: "vi",
    namespace: "parent",
    load: async (locale) => {
      attempted.push(locale);
      if (locale === "vi") return { "parent.title": "Gia đình" };
      return {
        "parent.title": "Family",
        "parent.subtitle": "Safety at a glance",
      };
    },
  });

  assert.deepEqual(attempted, ["vi"]);
  assert.equal(result.resolvedLocale, "vi");
  assert.deepEqual(result.messages, { "parent.title": "Gia đình" });
});

test("모든 fallback 청크가 실패하면 마지막 오류를 숨기지 않는다", async () => {
  const attempted: string[] = [];

  await assert.rejects(
    loadNamespaceAtomically({
      locale: "en",
      namespace: "core",
      load: async (locale) => {
        attempted.push(locale);
        throw new Error(`${locale}_chunk_failed`);
      },
    }),
    /ko_chunk_failed/,
  );
  assert.deepEqual(attempted, ["en", "ko"]);
});
