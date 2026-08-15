import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const RAW_ERROR_PATTERNS = [
  /\b(?:error|err|e)\.message\b/g,
  /\bString\(\s*(?:error|err|e)\s*\)/g,
  /\b(?:body|response|data|payload)\??\.message\b/g,
  /\b(?:show|toast|alert|confirm|setError|setMessage)\s*\([^;\n]*(?:\w+\??\.(?:message|error))\b/g,
  /\{[^}\n]*\b\w+\??\.(?:message|error)\b[^}\n]*\}/g,
];
const ALLOWLIST_REASONS = /^(?:protocol|data|accessibility):/;

function defaultRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function parseRoot() {
  const index = process.argv.indexOf("--root");
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : defaultRoot();
}

function slash(path) {
  return path.replaceAll("\\", "/");
}

async function listSourceFiles(root) {
  const files = [];
  async function walk(path) {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) files.push(child);
    }
  }
  await walk(join(root, "src"));
  return files;
}

async function loadAllowlist(root) {
  const path = join(root, "scripts", "i18n", "client-error-surface-allowlist.json");
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function isCommentOnly(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function executableSurface(line) {
  let output = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char !== '"' && char !== "'" && char !== "`") {
      output += char;
      continue;
    }
    const quote = char;
    output += " ";
    for (index += 1; index < line.length; index += 1) {
      if (line[index] === "\\") {
        index += 1;
        output += "  ";
        continue;
      }
      if (quote === "`" && line[index] === "$" && line[index + 1] === "{") {
        const end = line.indexOf("}", index + 2);
        if (end < 0) break;
        output += line.slice(index, end + 1);
        index = end;
        continue;
      }
      if (line[index] === quote) break;
      output += " ";
    }
  }
  return output;
}

async function main() {
  const root = parseRoot();
  const allowlist = await loadAllowlist(root);
  const errors = [];
  const compiled = allowlist.map((entry, index) => {
    if (!entry || typeof entry.path !== "string" || typeof entry.pattern !== "string"
      || typeof entry.reason !== "string" || !ALLOWLIST_REASONS.test(entry.reason)) {
      errors.push(`invalid_allowlist_reason:${index + 1}`);
      return { entry, regex: null, used: 0 };
    }
    try {
      if (!Number.isInteger(entry.occurrences) || entry.occurrences < 1) {
        errors.push(`invalid_allowlist_occurrences:${index + 1}`);
      }
      return { entry, regex: new RegExp(entry.pattern), used: 0 };
    } catch {
      errors.push(`invalid_allowlist_pattern:${index + 1}`);
      return { entry, regex: null, used: 0 };
    }
  });

  for (const path of await listSourceFiles(root)) {
    const file = slash(relative(root, path));
    const lines = (await readFile(path, "utf8")).split(/\r?\n/);
    lines.forEach((line, lineIndex) => {
      if (isCommentOnly(line)) return;
      const surface = executableSurface(line);
      const hazardous = RAW_ERROR_PATTERNS.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(surface);
      });
      if (!hazardous) return;
      const allowed = compiled.find((item) => item.regex && item.entry.path === file && item.regex.test(line));
      if (allowed) allowed.used += 1;
      else errors.push(`${file}:${lineIndex + 1}:raw_error_surface:${line.trim()}`);
    });
  }

  compiled.forEach((item, index) => {
    if (item.regex && item.used !== item.entry.occurrences) {
      errors.push(`stale_allowlist:${index + 1}:${item.entry.path}:expected_${item.entry.occurrences}:found_${item.used}`);
    }
  });
  if (errors.length > 0) {
    console.error([...new Set(errors)].join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("클라이언트 오류 표면 검사 통과");
}

await main();
