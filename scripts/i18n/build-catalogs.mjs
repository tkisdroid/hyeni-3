import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { validateCatalogs } from "./validate-catalogs.mjs";

function sortObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => compareCodePoints(left, right)));
}

function compareCodePoints(left, right) {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index].codePointAt(0) - rightPoints[index].codePointAt(0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function toRelativePath(rootDir, path) {
  return relative(rootDir, path).replaceAll("\\", "/");
}

function generatedRoot(rootDir) {
  return join(rootDir, "src", "i18n", "generated");
}

function serializeCatalog(catalog) {
  return `const messages = ${JSON.stringify(sortObject(catalog), null, 2)} as const;\n\nexport default messages;\n`;
}

function serializeMessageIds(result) {
  const ids = [];
  for (const namespace of result.namespaces) {
    ids.push(...Object.keys(result.catalogs.get(`${result.sourceLocale}:${namespace}`) ?? {}));
  }
  ids.sort(compareCodePoints);
  return `export const messageNamespaces = ${JSON.stringify(result.namespaces, null, 2)} as const;\n\nexport type MessageNamespace = (typeof messageNamespaces)[number];\n\nexport const messageIds = ${JSON.stringify(ids, null, 2)} as const;\n\nexport type MessageId = (typeof messageIds)[number];\n\nexport type CatalogMessages = Readonly<Record<string, string>>;\n\nexport interface CatalogModule {\n  default: CatalogMessages;\n}\n`;
}

function serializeCatalogLoaders(result) {
  const lines = [
    'import type { SupportedLocale } from "../locale";',
    'import type { CatalogModule, MessageNamespace } from "./messageIds";',
    "",
    "export const catalogLoaders = {",
  ];
  for (const locale of result.localeCodes) {
    lines.push(`  ${JSON.stringify(locale)}: {`);
    for (const namespace of result.namespaces) {
      lines.push(`    ${JSON.stringify(namespace)}: () => import("./catalogs/${locale}/${namespace}"),`);
    }
    lines.push("  },");
  }
  lines.push("} satisfies Record<SupportedLocale, Record<MessageNamespace, () => Promise<CatalogModule>>>;", "");
  return lines.join("\n");
}

export function getGeneratedFiles(result) {
  const root = generatedRoot(result.rootDir);
  const files = new Map();
  files.set(join(root, "messageIds.ts"), serializeMessageIds(result));
  files.set(join(root, "catalogLoaders.ts"), serializeCatalogLoaders(result));
  for (const locale of result.localeCodes) {
    for (const namespace of result.namespaces) {
      files.set(
        join(root, "catalogs", locale, `${namespace}.ts`),
        serializeCatalog(result.catalogs.get(`${locale}:${namespace}`)),
      );
    }
  }
  return files;
}

export async function checkGeneratedFiles(result) {
  const stale = [];
  const generated = getGeneratedFiles(result);
  const expectedPaths = new Set([...generated.keys()].map((path) => toRelativePath(result.rootDir, path)));
  for (const [path, expected] of generated) {
    try {
      if (await readFile(path, "utf8") !== expected) stale.push(toRelativePath(result.rootDir, path));
    } catch {
      stale.push(toRelativePath(result.rootDir, path));
    }
  }
  for (const path of await listGeneratedTypeScriptFiles(generatedRoot(result.rootDir), result.rootDir)) {
    if (!expectedPaths.has(path)) stale.push(path);
  }
  return { stale: [...new Set(stale)].sort(compareCodePoints) };
}

async function listGeneratedTypeScriptFiles(root, rootDir) {
  const paths = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) paths.push(toRelativePath(rootDir, path));
    }
  }
  await walk(root);
  return paths;
}

async function writeGeneratedFiles(result) {
  for (const [path, content] of getGeneratedFiles(result)) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }
}

async function main() {
  const result = await validateCatalogs();
  if (result.errors.length > 0) throw new Error(result.errors.join("\n"));
  if (process.argv.includes("--check")) {
    const freshness = await checkGeneratedFiles(result);
    if (freshness.stale.length > 0) throw new Error(freshness.stale.join("\n"));
    console.log("i18n 생성물 최신 상태");
    return;
  }
  await writeGeneratedFiles(result);
  console.log(`i18n 생성물 ${getGeneratedFiles(result).size}개 생성 완료`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
