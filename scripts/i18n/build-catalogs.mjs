import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { validateCatalogs } from "./validate-catalogs.mjs";

function sortObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
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
  ids.sort((left, right) => left.localeCompare(right));
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
  for (const [path, expected] of getGeneratedFiles(result)) {
    try {
      if (await readFile(path, "utf8") !== expected) stale.push(relative(result.rootDir, path));
    } catch {
      stale.push(relative(result.rootDir, path));
    }
  }
  return { stale };
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
