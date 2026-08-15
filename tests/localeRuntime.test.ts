import assert from "node:assert/strict";
import test from "node:test";

import {
  createLocaleRuntimeCoordinator,
  loadNamespaceAtomically,
  type LoadedNamespace,
  type LocaleRuntimeLoader,
} from "../src/i18n/catalog.ts";
import type { MessageNamespace } from "../src/i18n/generated/messageIds.ts";
import type { SupportedLocale } from "../src/i18n/locale.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function loaded(
  locale: SupportedLocale,
  namespace: MessageNamespace,
  text = `${locale}:${namespace}`,
): LoadedNamespace {
  return {
    namespace,
    resolvedLocale: locale,
    messages: { [namespace === "core" ? "core.brand.name" : `${namespace}.title`]: text },
  };
}

function runtimeFixture(load: LocaleRuntimeLoader, initialLocale: SupportedLocale = "ko") {
  const storageWrites: SupportedLocale[] = [];
  const documentWrites: Array<{ locale: SupportedLocale; title: string | undefined }> = [];
  const runtime = createLocaleRuntimeCoordinator({
    initialLocale,
    load,
    storage: {
      read: () => null,
      write: (locale) => storageWrites.push(locale),
    },
    document: {
      update(locale, coreMessages) {
        documentWrites.push({ locale, title: coreMessages["core.brand.name"] });
      },
    },
  });
  return { runtime, storageWrites, documentWrites };
}

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

test("비-core load 실패는 locale·messages·storage·document를 부분 변경하지 않는다", async () => {
  let failVietnameseParent = false;
  const { runtime, storageWrites, documentWrites } = runtimeFixture(async (locale, namespace) => {
    if (failVietnameseParent && locale === "vi" && namespace === "parent") {
      throw new Error("parent_chunk_failed");
    }
    return loaded(
      locale,
      namespace,
      namespace === "core" ? `${locale} brand` : `${locale} parent`,
    );
  });

  await runtime.setLocale("ko");
  await runtime.ensureNamespaces(["parent"]);
  storageWrites.length = 0;
  documentWrites.length = 0;
  failVietnameseParent = true;

  await assert.rejects(runtime.setLocale("vi"), /parent_chunk_failed/);

  assert.equal(runtime.getSnapshot().locale, "ko");
  assert.equal(runtime.getSnapshot().messages["parent.title"], "ko parent");
  assert.deepEqual(storageWrites, []);
  assert.deepEqual(documentWrites, []);

  failVietnameseParent = false;
  await runtime.setLocale("vi");
  assert.equal(runtime.getSnapshot().locale, "vi");
  assert.equal(runtime.getSnapshot().messages["parent.title"], "vi parent");
  assert.deepEqual(storageWrites, ["vi"]);
  assert.deepEqual(documentWrites, [{ locale: "vi", title: "vi brand" }]);
});

test("같은 locale도 required namespace가 빠진 실패 상태면 다시 load한다", async () => {
  let parentAttempts = 0;
  const { runtime } = runtimeFixture(async (locale, namespace) => {
    if (namespace === "parent") {
      parentAttempts += 1;
      if (parentAttempts === 1) throw new Error("first_parent_failure");
    }
    return loaded(locale, namespace);
  });

  await runtime.setLocale("ko");
  await assert.rejects(runtime.ensureNamespaces(["parent"]), /first_parent_failure/);
  assert.equal(runtime.getSnapshot().readyNamespaces.has("parent"), false);

  await runtime.setLocale("ko");
  assert.equal(parentAttempts, 2);
  assert.equal(runtime.getSnapshot().readyNamespaces.has("parent"), true);
});

test("빠른 A→B→C 전환에서 늦은 A/B 완료는 C의 외부 상태를 덮지 않는다", async () => {
  const coreLoads = {
    en: deferred<LoadedNamespace>(),
    ja: deferred<LoadedNamespace>(),
    vi: deferred<LoadedNamespace>(),
  };
  const { runtime, storageWrites, documentWrites } = runtimeFixture(async (locale, namespace) => {
    if (namespace !== "core" || (locale !== "en" && locale !== "ja" && locale !== "vi")) {
      return loaded(locale, namespace);
    }
    return coreLoads[locale].promise;
  });

  const switchA = runtime.setLocale("en");
  const switchB = runtime.setLocale("ja");
  const switchC = runtime.setLocale("vi");
  coreLoads.vi.resolve(loaded("vi", "core", "C brand"));
  await switchC;
  coreLoads.ja.resolve(loaded("ja", "core", "B brand"));
  coreLoads.en.resolve(loaded("en", "core", "A brand"));
  await Promise.all([switchA, switchB]);

  assert.equal(runtime.getSnapshot().locale, "vi");
  assert.equal(runtime.getSnapshot().messages["core.brand.name"], "C brand");
  assert.deepEqual(storageWrites, ["vi"]);
  assert.deepEqual(documentWrites, [{ locale: "vi", title: "C brand" }]);
});

test("두 concurrent ensure는 역순 완료되어도 합집합을 한 번에 ready로 만든다", async () => {
  const parentLoad = deferred<LoadedNamespace>();
  const reportsLoad = deferred<LoadedNamespace>();
  const { runtime } = runtimeFixture(async (locale, namespace) => {
    if (namespace === "parent") return parentLoad.promise;
    if (namespace === "reports") return reportsLoad.promise;
    return loaded(locale, namespace);
  });
  await runtime.setLocale("ko");

  let parentReady = false;
  let reportsReady = false;
  const parentPromise = runtime.ensureNamespaces(["parent"]).then(() => {
    parentReady = true;
  });
  const reportsPromise = runtime.ensureNamespaces(["reports"]).then(() => {
    reportsReady = true;
  });
  await Promise.resolve();
  reportsLoad.resolve(loaded("ko", "reports"));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(parentReady, false);
  assert.equal(reportsReady, false);
  assert.equal(runtime.getSnapshot().readyNamespaces.has("reports"), false);

  parentLoad.resolve(loaded("ko", "parent"));
  await Promise.all([parentPromise, reportsPromise]);
  assert.equal(runtime.getSnapshot().readyNamespaces.has("parent"), true);
  assert.equal(runtime.getSnapshot().readyNamespaces.has("reports"), true);
});

test("locale 전환에 supersede된 ensure는 새 locale에서 namespace가 ready된 뒤 resolve한다", async () => {
  const oldParentLoad = deferred<LoadedNamespace>();
  const { runtime } = runtimeFixture(async (locale, namespace) => {
    if (locale === "ko" && namespace === "parent") return oldParentLoad.promise;
    return loaded(locale, namespace);
  });
  await runtime.setLocale("ko");

  let ensureResolved = false;
  const ensureParent = runtime.ensureNamespaces(["parent"]).then(() => {
    ensureResolved = true;
  });
  await Promise.resolve();
  const switchLocale = runtime.setLocale("vi");
  await switchLocale;
  await Promise.resolve();

  try {
    assert.equal(ensureResolved, true);
    assert.equal(runtime.getSnapshot().locale, "vi");
    assert.equal(runtime.getSnapshot().readyNamespaces.has("parent"), true);
    assert.equal(runtime.getSnapshot().messages["parent.title"], "vi:parent");
  } finally {
    oldParentLoad.resolve(loaded("ko", "parent"));
    await ensureParent;
  }
});

test("초기 all-fallback 실패는 bounded error가 되고 retry 성공 시 복구한다", async () => {
  let coreAttempts = 0;
  const { runtime, storageWrites, documentWrites } = runtimeFixture(async (locale, namespace) => {
    if (namespace === "core") {
      coreAttempts += 1;
      if (coreAttempts === 1) throw new Error("all_fallback_failed");
    }
    return loaded(locale, namespace, "Recovered brand");
  }, "en");

  await assert.rejects(runtime.setLocale("en"), /all_fallback_failed/);
  assert.equal(runtime.getSnapshot().error, true);
  assert.equal(runtime.getSnapshot().readyNamespaces.has("core"), false);
  assert.deepEqual(storageWrites, []);
  assert.deepEqual(documentWrites, []);

  await runtime.retry();
  assert.equal(runtime.getSnapshot().error, false);
  assert.equal(runtime.getSnapshot().readyNamespaces.has("core"), true);
  assert.deepEqual(storageWrites, ["en"]);
  assert.deepEqual(documentWrites, [{ locale: "en", title: "Recovered brand" }]);
});
