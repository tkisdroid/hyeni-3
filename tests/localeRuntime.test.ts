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
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
  const parentLease = runtime.acquireNamespaceLease(["parent"]);
  await parentLease.ready;
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
  parentLease.release();
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
  const parentLease = runtime.acquireNamespaceLease(["parent"]);
  await assert.rejects(parentLease.ready, /first_parent_failure/);
  assert.equal(runtime.getSnapshot().readyNamespaces.has("parent"), false);

  await runtime.setLocale("ko");
  assert.equal(parentAttempts, 2);
  assert.equal(runtime.getSnapshot().readyNamespaces.has("parent"), true);
  parentLease.release();
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

test("두 concurrent ensure는 역순 완료되어도 각 namespace 결과대로 독립 settle한다", async () => {
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
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(parentReady, false);
  assert.equal(reportsReady, true);
  assert.equal(runtime.getSnapshot().readyNamespaces.has("reports"), true);

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

  const parentLease = runtime.acquireNamespaceLease(["parent"]);
  let ensureResolved = false;
  const ensureParent = parentLease.ready.then(() => {
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
    parentLease.release();
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

test("reports가 hung이어도 이미 ready인 parent ensure는 즉시 resolve한다", async () => {
  const reportsLoad = deferred<LoadedNamespace>();
  const { runtime } = runtimeFixture(async (locale, namespace) => {
    if (namespace === "reports") return reportsLoad.promise;
    return loaded(locale, namespace);
  });
  await runtime.setLocale("ko");
  await runtime.ensureNamespaces(["parent"]);

  const reportsPromise = runtime.ensureNamespaces(["reports"]);
  let parentResolved = false;
  const parentPromise = runtime.ensureNamespaces(["parent"]).then(() => {
    parentResolved = true;
  });
  await Promise.resolve();
  await Promise.resolve();

  try {
    assert.equal(parentResolved, true);
  } finally {
    reportsLoad.resolve(loaded("ko", "reports"));
    await Promise.all([reportsPromise, parentPromise]);
  }
});

test("reports 실패는 이미 ready인 parent 요청을 reject하지 않는다", async () => {
  const reportsLoad = deferred<LoadedNamespace>();
  const { runtime } = runtimeFixture(async (locale, namespace) => {
    if (namespace === "reports") return reportsLoad.promise;
    return loaded(locale, namespace);
  });
  await runtime.setLocale("ko");
  await runtime.ensureNamespaces(["parent"]);

  const reportsPromise = runtime.ensureNamespaces(["reports"]);
  const parentPromise = runtime.ensureNamespaces(["parent"]);
  reportsLoad.reject(new Error("reports_failed"));
  const [parentResult, reportsResult] = await Promise.allSettled([
    parentPromise,
    reportsPromise,
  ]);

  assert.equal(parentResult.status, "fulfilled");
  assert.equal(reportsResult.status, "rejected");
});

test("떠난 reports lease는 이후 parent-only locale switch preload에 남지 않는다", async () => {
  const calls: string[] = [];
  let failReports = false;
  const { runtime } = runtimeFixture(async (locale, namespace) => {
    calls.push(`${locale}:${namespace}`);
    if (failReports && namespace === "reports") throw new Error("reports_failed");
    return loaded(locale, namespace);
  });
  await runtime.setLocale("ko");
  const parentLease = runtime.acquireNamespaceLease(["parent"]);
  await parentLease.ready;
  failReports = true;
  const reportsLease = runtime.acquireNamespaceLease(["reports"]);
  await assert.rejects(reportsLease.ready, /reports_failed/);
  reportsLease.release();
  failReports = false;
  calls.length = 0;

  await runtime.setLocale("vi");

  assert.deepEqual(calls.sort(), ["vi:core", "vi:parent"]);
  assert.equal(runtime.getSnapshot().locale, "vi");
  assert.equal(runtime.getSnapshot().readyNamespaces.has("parent"), true);
  parentLease.release();
});

test("같은 namespace의 중첩 lease는 마지막 release 뒤에만 비활성화된다", async () => {
  const calls: string[] = [];
  const { runtime } = runtimeFixture(async (locale, namespace) => {
    calls.push(`${locale}:${namespace}`);
    return loaded(locale, namespace);
  });
  await runtime.setLocale("ko");
  const firstLease = runtime.acquireNamespaceLease(["reports"]);
  const secondLease = runtime.acquireNamespaceLease(["reports"]);
  await Promise.all([firstLease.ready, secondLease.ready]);
  calls.length = 0;
  firstLease.release();

  await runtime.setLocale("vi");
  assert.deepEqual(calls.sort(), ["vi:core", "vi:reports"]);

  secondLease.release();
  calls.length = 0;
  await runtime.setLocale("th");
  assert.deepEqual(calls, ["th:core"]);
});

test("서로 다른 missing namespace 요청은 각 성공과 실패에만 따라 settle한다", async () => {
  const parentLoad = deferred<LoadedNamespace>();
  const reportsLoad = deferred<LoadedNamespace>();
  const { runtime } = runtimeFixture(async (locale, namespace) => {
    if (namespace === "parent") return parentLoad.promise;
    if (namespace === "reports") return reportsLoad.promise;
    return loaded(locale, namespace);
  });
  await runtime.setLocale("ko");

  const parentPromise = runtime.ensureNamespaces(["parent"]);
  const reportsPromise = runtime.ensureNamespaces(["reports"]);
  parentLoad.resolve(loaded("ko", "parent"));
  reportsLoad.reject(new Error("reports_failed"));
  const [parentResult, reportsResult] = await Promise.allSettled([
    parentPromise,
    reportsPromise,
  ]);

  assert.equal(parentResult.status, "fulfilled");
  assert.equal(reportsResult.status, "rejected");
  assert.equal(runtime.getSnapshot().readyNamespaces.has("parent"), true);
  assert.equal(runtime.getSnapshot().readyNamespaces.has("reports"), false);
});

test("settle 전 release된 route namespace는 다음 locale 전환에서 재시작하지 않는다", async () => {
  const hungReports = deferred<LoadedNamespace>();
  const calls: string[] = [];
  const { runtime } = runtimeFixture(async (locale, namespace) => {
    calls.push(`${locale}:${namespace}`);
    if (locale === "ko" && namespace === "reports") return hungReports.promise;
    return loaded(locale, namespace);
  });
  await runtime.setLocale("ko");

  const reportsLease = runtime.acquireNamespaceLease(["reports"]);
  await Promise.resolve();
  reportsLease.release();
  await reportsLease.ready;
  calls.length = 0;

  try {
    await runtime.setLocale("vi");
    assert.deepEqual(calls, ["vi:core"]);
  } finally {
    hungReports.resolve(loaded("ko", "reports"));
  }
});

test("마지막 소비자가 release한 hung namespace job은 전역 loading을 해제한다", async () => {
  const hungReports = deferred<LoadedNamespace>();
  const { runtime } = runtimeFixture(async (locale, namespace) => {
    if (namespace === "reports") return hungReports.promise;
    return loaded(locale, namespace);
  });
  await runtime.setLocale("ko");

  const reportsLease = runtime.acquireNamespaceLease(["reports"]);
  await Promise.resolve();
  assert.equal(runtime.getSnapshot().loading, true);
  reportsLease.release();
  await reportsLease.ready;

  try {
    assert.equal(runtime.getSnapshot().loading, false);
  } finally {
    hungReports.resolve(loaded("ko", "reports"));
  }
});

test("locale 전환 중 release된 hung namespace load는 전환 완료를 막지 않는다", async () => {
  const vietnameseReports = deferred<LoadedNamespace>();
  const { runtime } = runtimeFixture(async (locale, namespace) => {
    if (locale === "vi" && namespace === "reports") return vietnameseReports.promise;
    return loaded(locale, namespace);
  });
  await runtime.setLocale("ko");
  const reportsLease = runtime.acquireNamespaceLease(["reports"]);
  await reportsLease.ready;

  let switched = false;
  const switchLocale = runtime.setLocale("vi").then(() => {
    switched = true;
  });
  reportsLease.release();
  await new Promise<void>((resolve) => setImmediate(resolve));

  try {
    assert.equal(switched, true);
    assert.equal(runtime.getSnapshot().locale, "vi");
    assert.equal(runtime.getSnapshot().readyNamespaces.has("reports"), false);
    assert.equal(runtime.getSnapshot().loading, false);
  } finally {
    vietnameseReports.resolve(loaded("vi", "reports"));
    await switchLocale;
  }
});

test("locale 전환의 여러 namespace 실패는 각 lease만 reject하고 재예약하지 않는다", async () => {
  const vietnameseCore = deferred<LoadedNamespace>();
  const calls: string[] = [];
  const { runtime } = runtimeFixture(async (locale, namespace) => {
    calls.push(`${locale}:${namespace}`);
    if (locale === "vi" && namespace === "core") return vietnameseCore.promise;
    if (locale === "vi" && namespace === "parent") throw new Error("parent_failed");
    if (locale === "vi" && namespace === "reports") throw new Error("reports_failed");
    return loaded(locale, namespace);
  });
  await runtime.setLocale("ko");
  calls.length = 0;

  const switchLocale = runtime.setLocale("vi");
  await Promise.resolve();
  const parentLease = runtime.acquireNamespaceLease(["parent"]);
  const reportsLease = runtime.acquireNamespaceLease(["reports"]);
  vietnameseCore.resolve(loaded("vi", "core"));
  const [switchResult, parentResult, reportsResult] = await Promise.allSettled([
    switchLocale,
    parentLease.ready,
    reportsLease.ready,
  ]);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(switchResult.status, "rejected");
  assert.equal(parentResult.status, "rejected");
  assert.match(String(parentResult.status === "rejected" && parentResult.reason), /parent_failed/);
  assert.equal(reportsResult.status, "rejected");
  assert.match(String(reportsResult.status === "rejected" && reportsResult.reason), /reports_failed/);
  assert.deepEqual(calls.sort(), ["vi:core", "vi:parent", "vi:reports"]);
  parentLease.release();
  reportsLease.release();
});

test("떠난 route와 transition load를 공유한 one-shot은 원래 rejection으로 한 번만 settle한다", async () => {
  const sharedReports = deferred<LoadedNamespace>();
  const sharedError = new Error("shared_reports_failed");
  let vietnameseReportsCalls = 0;
  const { runtime } = runtimeFixture(async (locale, namespace) => {
    if (locale === "vi" && namespace === "reports") {
      vietnameseReportsCalls += 1;
      if (vietnameseReportsCalls === 1) return sharedReports.promise;
      throw new Error("stale_reports_retry");
    }
    return loaded(locale, namespace);
  });
  await runtime.setLocale("ko");
  const reportsLease = runtime.acquireNamespaceLease(["reports"]);
  await reportsLease.ready;

  const switchLocale = runtime.setLocale("vi");
  const oneShot = runtime.ensureNamespaces(["reports"]);
  reportsLease.release();
  sharedReports.reject(sharedError);
  const [switchResult, oneShotResult] = await Promise.allSettled([
    switchLocale,
    oneShot,
  ]);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(switchResult.status, "fulfilled");
  assert.equal(oneShotResult.status, "rejected");
  assert.equal(oneShotResult.status === "rejected" && oneShotResult.reason, sharedError);
  assert.equal(vietnameseReportsCalls, 1);
  assert.equal(runtime.getSnapshot().loading, false);
});

test("공유 lease와 one-shot ensure 수요가 남으면 namespace job을 유지한다", async () => {
  const reportsLoad = deferred<LoadedNamespace>();
  let reportsCalls = 0;
  const { runtime } = runtimeFixture(async (locale, namespace) => {
    if (namespace === "reports") {
      reportsCalls += 1;
      return reportsLoad.promise;
    }
    return loaded(locale, namespace);
  });
  await runtime.setLocale("ko");

  const firstLease = runtime.acquireNamespaceLease(["reports"]);
  const secondLease = runtime.acquireNamespaceLease(["reports"]);
  const oneShot = runtime.ensureNamespaces(["reports"]);
  firstLease.release();
  await firstLease.ready;
  assert.equal(runtime.getSnapshot().loading, true);
  secondLease.release();
  await secondLease.ready;
  assert.equal(runtime.getSnapshot().loading, true);

  reportsLoad.resolve(loaded("ko", "reports"));
  await oneShot;
  assert.equal(reportsCalls, 1);
  assert.equal(runtime.getSnapshot().loading, false);
});
