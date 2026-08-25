import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";

const defaultNamespaces = [
  "core", "onboarding", "parent", "child", "shared", "billing", "reports", "notifications", "android",
];
const requiredLocales = ["ko", "en", "ja", "zh-CN", "zh-TW", "vi", "th", "id", "ms", "fil"];
const allowedUrlOrigins = new Set([
  "https://hyeni-calendar.pages.dev",
  "https://hyeni-calendar-api.tkisdroid.workers.dev",
  "https://play.google.com",
  "https://support.google.com",
]);
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const argumentTypes = new Set([
  TYPE.argument, TYPE.number, TYPE.date, TYPE.time, TYPE.select, TYPE.plural,
]);
const execFileAsync = promisify(execFile);

function defaultRootDir() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function sortStrings(values) {
  return [...values].sort(compareCodePoints);
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

function isPlainObject(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactLocaleSet(localeCodes) {
  return localeCodes.length === requiredLocales.length
    && requiredLocales.every((locale) => localeCodes.includes(locale));
}

function createResult(errors, values = {}) {
  return { errors: sortStrings(new Set(errors)), ...values };
}

function collectArguments(nodes, target = new Set()) {
  for (const node of nodes) {
    if (argumentTypes.has(node.type)) target.add(node.value);
    if (node.options) {
      for (const option of Object.values(node.options)) collectArguments(option.value, target);
    }
    if (node.children) collectArguments(node.children, target);
  }
  return target;
}

function parseArguments(message, errorKey, errors) {
  try {
    return collectArguments(parse(message));
  } catch {
    errors.push(`icu_parse_error:${errorKey}`);
    return new Set();
  }
}

function hasForbiddenMarkup(message) {
  if (/<script\b|javascript\s*:|\son[a-z]+\s*=/i.test(message)) return true;
  const urls = message.match(/https?:\/\/[^\s<>"']*/gi) ?? [];
  return urls.some((url) => {
    try {
      return !allowedUrlOrigins.has(new URL(url).origin);
    } catch {
      return true;
    }
  });
}

function sameValues(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function descriptionArguments(entry) {
  return new Set(Object.keys(entry?.variables ?? {}));
}

export async function validateCatalogs({ rootDir = defaultRootDir(), namespaces = defaultNamespaces } = {}) {
  const localesRoot = join(rootDir, "locales");
  const errors = [];
  let manifest;
  let descriptions;
  let reviewStatus;

  try {
    manifest = await readJson(join(localesRoot, "manifest.json"));
    descriptions = await readJson(join(localesRoot, "descriptions.json"));
    reviewStatus = await readJson(join(localesRoot, "review-status.json"));
  } catch {
    return createResult(["catalog_metadata_unreadable"]);
  }

  const metadataErrors = [];
  if (!isPlainObject(manifest)) metadataErrors.push("invalid_manifest");
  if (!isPlainObject(descriptions)) metadataErrors.push("invalid_descriptions");
  if (!isPlainObject(reviewStatus) || !isPlainObject(reviewStatus?.statuses)) {
    metadataErrors.push("invalid_review_status");
  }
  if (metadataErrors.length > 0) return createResult(metadataErrors);

  if (!Array.isArray(manifest.locales)) metadataErrors.push("invalid_manifest");
  const localeEntries = Array.isArray(manifest.locales) ? manifest.locales : [];
  const localeCodes = [];
  for (const locale of localeEntries) {
    if (!isPlainObject(locale) || typeof locale.code !== "string") {
      metadataErrors.push("invalid_locale_entry");
      continue;
    }
    localeCodes.push(locale.code);
  }
  for (const locale of sortStrings(new Set(localeCodes))) {
    if (!requiredLocales.includes(locale)) metadataErrors.push(`invalid_locale:${locale}`);
    if (localeCodes.filter((code) => code === locale).length > 1) metadataErrors.push(`duplicate_locale:${locale}`);
  }
  if (!hasExactLocaleSet(localeCodes)) metadataErrors.push("invalid_locale_set");
  if (manifest.sourceLocale !== "ko") metadataErrors.push("invalid_source_locale");
  if (metadataErrors.length > 0) return createResult(metadataErrors);

  const sourceLocale = "ko";
  const catalogs = new Map();

  for (const locale of localeCodes) {
    for (const namespace of namespaces) {
      const key = `${locale}:${namespace}`;
      try {
        const catalog = await readJson(join(localesRoot, locale, `${namespace}.json`));
        if (!catalog || Array.isArray(catalog) || typeof catalog !== "object") {
          errors.push(`invalid_catalog:${locale}:${namespace}`);
          continue;
        }
        for (const id of Object.keys(catalog)) {
          if (forbiddenKeys.has(id)) errors.push(`forbidden_key:${locale}:${namespace}:${id}`);
        }
        catalogs.set(key, catalog);
      } catch {
        errors.push(`missing_file:${locale}:${namespace}`);
      }
    }
  }

  for (const locale of localeCodes) {
    for (const namespace of namespaces) {
      const status = reviewStatus.statuses[locale]?.[namespace];
      if (status === undefined) {
        errors.push(`missing_review_status:${locale}:${namespace}`);
      } else if (status !== "draft") {
        errors.push(`invalid_review_status:${locale}:${namespace}:${String(status)}`);
      }
    }
  }

  for (const namespace of namespaces) {
    const sourceCatalog = catalogs.get(`${sourceLocale}:${namespace}`);
    if (!sourceCatalog) continue;
    const sourceIds = new Set(Object.keys(sourceCatalog));

    for (const locale of localeCodes) {
      const catalog = catalogs.get(`${locale}:${namespace}`);
      if (!catalog) continue;
      const ids = new Set(Object.keys(catalog));
      for (const id of sortStrings(sourceIds)) {
        if (!ids.has(id)) errors.push(`missing_id:${locale}:${namespace}:${id}`);
      }
      for (const id of sortStrings(ids)) {
        if (!sourceIds.has(id)) errors.push(`extra_id:${locale}:${namespace}:${id}`);
      }

      for (const id of sortStrings(sourceIds)) {
        const sourceMessage = sourceCatalog[id];
        const message = catalog[id];
        if (typeof sourceMessage !== "string" || typeof message !== "string") {
          errors.push(`invalid_message:${locale}:${namespace}:${id}`);
          continue;
        }
        if (hasForbiddenMarkup(message)) errors.push(`forbidden_markup:${locale}:${namespace}:${id}`);
        const sourceArguments = parseArguments(sourceMessage, `${sourceLocale}:${namespace}:${id}`, errors);
        const argumentsInMessage = parseArguments(message, `${locale}:${namespace}:${id}`, errors);
        for (const argument of sortStrings(sourceArguments)) {
          if (!argumentsInMessage.has(argument)) {
            errors.push(`argument_mismatch:${locale}:${namespace}:${id}:${argument}`);
          }
        }
        for (const argument of sortStrings(argumentsInMessage)) {
          if (!sourceArguments.has(argument)) {
            errors.push(`argument_mismatch:${locale}:${namespace}:${id}:${argument}`);
          }
        }
      }
    }

    for (const id of sortStrings(sourceIds)) {
      const entry = descriptions[id];
      if (!entry) {
        errors.push(`missing_description:${id}`);
        continue;
      }
      if (entry.namespace !== namespace) errors.push(`description_namespace_mismatch:${id}`);
      const sourceArguments = parseArguments(sourceCatalog[id], `${sourceLocale}:${namespace}:${id}`, errors);
      if (!sameValues(sourceArguments, descriptionArguments(entry))) {
        errors.push(`description_arguments_mismatch:${id}`);
      }
    }

    for (const [id, entry] of Object.entries(descriptions)) {
      if (entry?.namespace === namespace && !sourceIds.has(id)) {
        errors.push(`description_unknown_id:${id}`);
      }
    }
  }

  // namespace 값 자체가 어긋난 항목(예: 스크립트 오류 문자열이 키로 새어 들어온 경우)은
  // 위 namespace 대조에 걸리지 않아 조용히 남는다. 정본 id 집합과 직접 대조해 잡는다.
  const allSourceIds = new Set();
  for (const namespace of namespaces) {
    const sourceCatalog = catalogs.get(`${sourceLocale}:${namespace}`);
    for (const id of Object.keys(sourceCatalog ?? {})) allSourceIds.add(id);
  }
  if (allSourceIds.size > 0) {
    for (const [id, entry] of Object.entries(descriptions)) {
      if (!namespaces.includes(entry?.namespace)) {
        errors.push(`description_invalid_namespace:${id}`);
      }
      if (!allSourceIds.has(id)) errors.push(`description_orphan_id:${id}`);
    }
  }

  return createResult(errors, {
    catalogs,
    descriptions,
    localeCodes,
    namespaces,
    rootDir,
    sourceLocale,
  });
}

async function main() {
  const result = await validateCatalogs();
  if (result.errors.length > 0) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
    return;
  }
  if (process.argv.includes("--check-generated")) {
    try {
      await execFileAsync(process.execPath, ["scripts/i18n/build-catalogs.mjs", "--check"], {
        cwd: result.rootDir,
      });
    } catch (error) {
      const output = error instanceof Error && "stderr" in error ? String(error.stderr) : "생성물 확인 실패";
      console.error(output.trim());
      process.exitCode = 1;
      return;
    }
  }
  console.log("i18n 카탈로그 검증 통과");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
