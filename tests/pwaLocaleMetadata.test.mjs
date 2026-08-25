/**
 * 다국어 PWA metadata 회귀.
 *
 * 설치된 앱의 이름·설명은 화면 문구가 아니라 manifest 가 정한다. manifest 가 하나뿐이거나
 * 링크가 두 개면 어떤 언어를 골라도 홈 화면 아이콘이 한국어로 남는다.
 *
 * 특히 잘 깨지는 두 지점을 고정한다.
 *  · manifest 가 `public/manifests/` 안에 있어 `start_url`·`scope`·아이콘이 `../` 로
 *    앱 루트를 가리켜야 한다(`./` 면 설치된 앱의 시작 URL 이 `/manifests/` 가 된다).
 *  · 아이콘 URL 이 10개 manifest 에서 동일해야 Workbox precache 에 같은 자원이 겹치지 않는다.
 */
import "./helpers/appModuleResolve.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildAllLocaleManifests,
  localeManifestHref,
  manifestFileName,
} from "../scripts/i18n/generate-pwa-manifests.mjs";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];

async function readManifest(locale) {
  return JSON.parse(
    await readFile(join(rootDir, "public", "manifests", manifestFileName(locale)), "utf8"),
  );
}

test("public/manifests 에는 지원 locale 10개 manifest 만 있다", async () => {
  const names = (await readdir(join(rootDir, "public", "manifests"))).sort();
  assert.deepEqual(names, LOCALES.map(manifestFileName).sort());
});

test("디스크의 manifest 는 locale catalog 로 다시 생성한 결과와 같다", async () => {
  const { manifests } = await buildAllLocaleManifests(rootDir);
  for (const locale of LOCALES) {
    assert.deepEqual(
      await readManifest(locale),
      manifests.get(locale),
      `${locale} manifest 가 catalog 와 어긋납니다. generate-pwa-manifests.mjs 를 다시 실행하세요.`,
    );
  }
});

test("브랜드는 한국어만 혜니캘린더이고 나머지 9개는 Hyeni Calendar 다", async () => {
  const ko = await readManifest("ko");
  assert.equal(ko.name, "혜니캘린더");
  assert.equal(ko.short_name, "혜니캘린더");
  for (const locale of LOCALES.filter((code) => code !== "ko")) {
    const manifest = await readManifest(locale);
    assert.equal(manifest.name, "Hyeni Calendar", locale);
    assert.equal(manifest.short_name, "Hyeni Calendar", locale);
  }
});

test("각 manifest 의 lang 이 정확하고 설명이 그 언어 catalog 값이다", async () => {
  for (const locale of LOCALES) {
    const manifest = await readManifest(locale);
    const core = JSON.parse(await readFile(join(rootDir, "locales", locale, "core.json"), "utf8"));
    assert.equal(manifest.lang, locale);
    assert.equal(manifest.dir, "ltr");
    assert.equal(manifest.description, core["core.brand.description"], locale);
    assert.ok(String(manifest.description).trim().length > 0, locale);
  }
});

test("start_url·scope·아이콘은 manifest 위치 기준으로 앱 루트를 가리킨다", async () => {
  for (const locale of LOCALES) {
    const manifest = await readManifest(locale);
    // `./` 로 두면 설치된 앱이 /manifests/ 를 시작 URL 로 잡아 빈 화면이 뜬다.
    assert.equal(manifest.start_url, "../", locale);
    assert.equal(manifest.scope, "../", locale);
    for (const icon of manifest.icons) {
      assert.match(icon.src, /^\.\.\/pwa-/, `${locale}:${icon.src}`);
    }
  }
});

test("10개 manifest 가 같은 아이콘 URL 을 써서 precache 중복을 만들지 않는다", async () => {
  const iconSets = new Set();
  for (const locale of LOCALES) {
    const manifest = await readManifest(locale);
    iconSets.add(JSON.stringify(manifest.icons));
  }
  assert.equal(iconSets.size, 1, "manifest 별로 다른 아이콘 URL 을 쓰면 precache 가 겹칩니다");
  const icons = JSON.parse([...iconSets][0]);
  assert.deepEqual(
    icons.map((icon) => icon.src).sort(),
    ["../pwa-192x192.png", "../pwa-512x512.png", "../pwa-maskable-512x512.png"],
  );
});

test("index.html 은 고정 id 를 가진 manifest 링크와 description 을 정확히 1개씩 갖는다", async () => {
  const html = await readFile(join(rootDir, "index.html"), "utf8");
  const manifestLinks = html.match(/<link[^>]*rel="manifest"[^>]*>/g) ?? [];
  assert.equal(manifestLinks.length, 1, JSON.stringify(manifestLinks));
  assert.match(manifestLinks[0], /id="hyeni-manifest"/);
  assert.ok(manifestLinks[0].includes(localeManifestHref("ko")), manifestLinks[0]);

  const descriptions = html.match(/<meta[^>]*name="description"[^>]*>/g) ?? [];
  assert.equal(descriptions.length, 1, JSON.stringify(descriptions));
  assert.match(descriptions[0], /id="hyeni-description"/);
});

test("vite 설정은 VitePWA 가 주입한 단일 언어 manifest 링크를 제거한다", async () => {
  const config = await readFile(join(rootDir, "vite.config.ts"), "utf8");
  // enforce:post 가 없으면 주입 전 HTML 을 보고 조용히 통과한다(실제로 겪은 결함).
  assert.match(config, /singleLocaleManifestLinkPlugin/);
  assert.match(config, /enforce:\s*"post"\s*as const/);
  assert.match(config, /manifest 링크가 정확히 1개/);
});

test("applyDocumentLocale 은 lang·dir·title·설명·manifest href 를 함께 갱신한다", async () => {
  const metadata = await import("../src/i18n/documentMetadata.ts");
  for (const locale of LOCALES) {
    const attributes = new Map();
    const target = {
      documentElement: { lang: "ko", dir: "ltr" },
      title: "",
      querySelector(selector) {
        return { setAttribute(name, value) { attributes.set(`${selector}:${name}`, value); } };
      },
    };
    const resolved = metadata.resolveLocaleMetadata(locale, {
      "core.brand.name": locale === "ko" ? "혜니캘린더" : "Hyeni Calendar",
      "core.brand.description": `설명-${locale}`,
    });
    metadata.applyDocumentLocale(locale, resolved, target);

    assert.equal(target.documentElement.lang, locale);
    assert.equal(target.documentElement.dir, "ltr");
    assert.equal(target.title, locale === "ko" ? "혜니캘린더" : "Hyeni Calendar");
    assert.equal(attributes.get("#hyeni-description:content"), `설명-${locale}`);
    assert.equal(
      attributes.get("#hyeni-manifest:href"),
      `./manifests/manifest.${locale}.webmanifest`,
    );
    assert.equal(
      attributes.get('meta[name="apple-mobile-web-app-title"]:content'),
      target.title,
    );
  }
});

test("catalog 가 없으면 설명을 지어내지 않고 브랜드만 적용한다", async () => {
  const metadata = await import("../src/i18n/documentMetadata.ts");
  const attributes = new Map();
  const target = {
    documentElement: { lang: "ko", dir: "ltr" },
    title: "",
    querySelector(selector) {
      return { setAttribute(name, value) { attributes.set(`${selector}:${name}`, value); } };
    },
  };
  const resolved = metadata.resolveLocaleMetadata("ja");
  assert.equal(resolved.description, "");
  metadata.applyDocumentLocale("ja", resolved, target);
  assert.equal(target.title, "Hyeni Calendar");
  assert.equal(attributes.has("#hyeni-description:content"), false);
  assert.equal(attributes.get("#hyeni-manifest:href"), "./manifests/manifest.ja.webmanifest");
});

test("Service Worker locale 채널은 locale 코드만 받고 계정 정보를 담지 않는다", async () => {
  const source = await readFile(join(rootDir, "src", "sw.ts"), "utf8");
  const handler = source.slice(source.indexOf('"HYENI_LOCALE"'), source.indexOf("HYENI_LOCALE_ACK"));
  assert.match(handler, /isSupportedLocale\(raw\)/);
  for (const forbidden of ["userId", "familyId", "role", "token"]) {
    assert.ok(!handler.includes(forbidden), `locale 메시지에 ${forbidden} 가 섞였습니다`);
  }
  // 서버가 title 을 주지 않은 push 의 브랜드 폴백이 사용자 언어여야 한다.
  assert.match(source, /localizedBrandName\(await readServiceWorkerLocale\(\)/);
  assert.ok(!source.includes('|| "혜니캘린더"'), "브랜드 폴백이 한국어로 하드코딩돼 있습니다");
});
