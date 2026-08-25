/**
 * 10개 locale PWA manifest 생성기.
 *
 * 왜 필요한가: 설치된 PWA 의 이름·설명은 `<html lang>` 이 아니라 manifest 가 정한다.
 * manifest 가 하나뿐이면 어떤 언어를 골라도 홈 화면 아이콘 이름이 한국어로 남는다.
 *
 * 규칙
 *  · 브랜드는 `core.brand.name`(ko=혜니캘린더 / 나머지=Hyeni Calendar), 설명은
 *    `core.brand.description` 이 정본이다. 이 파일이 문구를 새로 만들지 않는다.
 *  · **경로는 manifest URL 기준 상대 경로다.** manifest 가 `/manifests/` 안에 있으므로
 *    `start_url`·`scope`·아이콘은 `../` 로 앱 루트를 가리켜야 한다(`./` 로 두면 설치된 앱이
 *    `/manifests/` 를 시작 URL 로 잡는다). Capacitor `file://` 때문에 절대 경로는 쓸 수 없다.
 *  · 아이콘 URL 은 10개 manifest 가 **모두 같은 값**을 쓴다 — 새 URL 을 만들면 Workbox
 *    precache 에 같은 자원이 다른 revision 으로 겹쳐 Service Worker 평가가 실패한다.
 *
 * 사용: `node scripts/i18n/generate-pwa-manifests.mjs [--check]`
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APP_ROOT_FROM_MANIFEST = "../";
const MANIFEST_DIRECTORY = join("public", "manifests");

/** VitePWA 가 주입·precache 하는 아이콘과 정확히 같은 파일이어야 한다. */
const ICONS = [
  { src: `${APP_ROOT_FROM_MANIFEST}pwa-192x192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
  { src: `${APP_ROOT_FROM_MANIFEST}pwa-512x512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
  { src: `${APP_ROOT_FROM_MANIFEST}pwa-maskable-512x512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
];

function defaultRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function manifestFileName(locale) {
  return `manifest.${locale}.webmanifest`;
}

/** 문서에서 참조할 상대 경로(앱 루트 기준). */
export function localeManifestHref(locale) {
  return `./manifests/${manifestFileName(locale)}`;
}

export function buildLocaleManifest({ locale, brandName, description }) {
  return {
    name: brandName,
    short_name: brandName,
    description,
    lang: locale,
    dir: "ltr",
    start_url: APP_ROOT_FROM_MANIFEST,
    scope: APP_ROOT_FROM_MANIFEST,
    display: "standalone",
    orientation: "portrait",
    background_color: "#FBF7F4",
    theme_color: "#F76BA6",
    icons: ICONS,
  };
}

export async function buildAllLocaleManifests(rootOverride) {
  const root = rootOverride ?? defaultRoot();
  const manifest = await readJson(join(root, "locales", "manifest.json"));
  const locales = manifest.locales.map((entry) => entry.code);
  const built = new Map();

  for (const locale of locales) {
    const core = await readJson(join(root, "locales", locale, "core.json"));
    const brandName = core["core.brand.name"];
    const description = core["core.brand.description"];
    if (typeof brandName !== "string" || brandName.trim().length === 0) {
      throw new Error(`missing_brand_name:${locale}`);
    }
    if (typeof description !== "string" || description.trim().length === 0) {
      throw new Error(`missing_brand_description:${locale}`);
    }
    built.set(locale, buildLocaleManifest({ locale, brandName, description }));
  }
  return { root, locales, manifests: built };
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function listExistingManifests(directory) {
  try {
    return (await readdir(directory)).filter((name) => name.endsWith(".webmanifest")).sort();
  } catch {
    return [];
  }
}

async function main() {
  const check = process.argv.includes("--check");
  const { root, locales, manifests } = await buildAllLocaleManifests();
  const directory = join(root, MANIFEST_DIRECTORY);
  const expectedNames = locales.map(manifestFileName).sort();
  const problems = [];

  if (check) {
    const actualNames = await listExistingManifests(directory);
    for (const name of expectedNames) {
      if (!actualNames.includes(name)) problems.push(`missing_manifest:${name}`);
    }
    for (const name of actualNames) {
      if (!expectedNames.includes(name)) problems.push(`unexpected_manifest:${name}`);
    }
    for (const [locale, value] of manifests) {
      const path = join(directory, manifestFileName(locale));
      let current;
      try {
        current = await readFile(path, "utf8");
      } catch {
        continue;
      }
      if (current !== serialize(value)) problems.push(`stale_manifest:${manifestFileName(locale)}`);
    }
    if (problems.length > 0) {
      console.error(problems.join("\n"));
      console.error("`node scripts/i18n/generate-pwa-manifests.mjs` 로 다시 생성하세요.");
      process.exitCode = 1;
      return;
    }
    console.log(`PWA manifest ${expectedNames.length}개 최신 상태`);
    return;
  }

  await mkdir(directory, { recursive: true });
  for (const [locale, value] of manifests) {
    await writeFile(join(directory, manifestFileName(locale)), serialize(value), "utf8");
  }
  console.log(`PWA manifest ${manifests.size}개 생성 완료`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
