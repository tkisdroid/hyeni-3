import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

export const ROUTE_ENTRY_LIMIT_BYTES = 500_000;
export const ROUTE_ENTRY_STYLE_LIMIT_BYTES = 40_000;

const THIRD_PARTY_INITIAL_CHUNK_PREFIXES = ["i18n-runtime-"];

function attributeValue(tag, name) {
  const match = tag.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function resolveEntryPath(distDir, source) {
  const withoutQuery = source.split(/[?#]/, 1)[0].replaceAll("\\", "/");
  if (/^[a-z][a-z\d+.-]*:/i.test(withoutQuery) || withoutQuery.startsWith("//")) {
    throw new Error(`외부 module entry는 검사할 수 없습니다: ${source}`);
  }
  const segments = withoutQuery.split("/").filter((segment) => segment && segment !== ".");
  if (segments.includes("..")) throw new Error(`dist 밖 module entry는 허용하지 않습니다: ${source}`);

  const entryFile = segments.join("/");
  const entryPath = resolve(distDir, entryFile);
  const fromDist = relative(resolve(distDir), entryPath);
  if (!fromDist || fromDist === ".." || fromDist.startsWith(`..${sep}`)) {
    throw new Error(`dist 내부 module entry 경로가 아닙니다: ${source}`);
  }
  return { entryFile, entryPath };
}

export function inspectRouteEntryBundle({
  distDir,
  limitBytes = ROUTE_ENTRY_LIMIT_BYTES,
} = {}) {
  if (!distDir) throw new Error("distDir가 필요합니다.");
  const indexPath = join(distDir, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error("production dist가 없습니다. 먼저 npm run build를 실행하세요.");
  }

  const html = readFileSync(indexPath, "utf8");
  const moduleEntries = [...html.matchAll(/<script\b[^>]*>/gi)]
    .map(([tag]) => ({
      type: attributeValue(tag, "type"),
      source: attributeValue(tag, "src"),
    }))
    .filter(({ type, source }) => type === "module" && source);
  if (moduleEntries.length !== 1) {
    throw new Error(`production module entry는 정확히 1개여야 합니다: ${moduleEntries.length}개`);
  }

  const modulePreloads = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => ({
      relations: (attributeValue(tag, "rel") ?? "").toLowerCase().split(/\s+/),
      source: attributeValue(tag, "href"),
    }))
    .filter(({ relations, source }) => relations.includes("modulepreload") && source)
    .filter(({ source }) => !/^[a-z][a-z\d+.-]*:|^\/\//i.test(source));

  const entry = resolveEntryPath(distDir, moduleEntries[0].source);
  const resolvedPreloads = modulePreloads.map(({ source }) => resolveEntryPath(distDir, source));
  const isThirdPartyInitialChunk = (file) => THIRD_PARTY_INITIAL_CHUNK_PREFIXES.some(
    (prefix) => basename(file).startsWith(prefix),
  );
  const initialSources = [
    entry,
    ...resolvedPreloads.filter(({ entryFile: file }) => !isThirdPartyInitialChunk(file)),
  ];
  const uniqueSources = [...new Map(initialSources.map((source) => [source.entryFile, source])).values()];
  const files = uniqueSources.map(({ entryFile: file, entryPath }) => {
    if (!existsSync(entryPath)) throw new Error(`초기 module 파일이 없습니다: ${file}`);
    return { file, bytes: statSync(entryPath).size };
  });
  const bytes = files.reduce((total, file) => total + file.bytes, 0);
  const excludedFiles = resolvedPreloads
    .filter(({ entryFile: file }) => isThirdPartyInitialChunk(file))
    .map(({ entryFile: file, entryPath }) => {
      if (!existsSync(entryPath)) throw new Error(`초기 module 파일이 없습니다: ${file}`);
      return { file, bytes: statSync(entryPath).size, reason: "third-party-runtime" };
    });
  if (bytes >= limitBytes) {
    throw new Error(`초기 자체 JS 그래프는 ${bytes}바이트입니다. ${limitBytes}바이트 미만이어야 합니다.`);
  }
  return { entryFile: entry.entryFile, files, excludedFiles, bytes, limitBytes };
}

export function inspectRouteEntryStyles({
  distDir,
  limitBytes = ROUTE_ENTRY_STYLE_LIMIT_BYTES,
} = {}) {
  if (!distDir) throw new Error("distDir가 필요합니다.");
  const indexPath = join(distDir, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error("production dist가 없습니다. 먼저 npm run build를 실행하세요.");
  }

  const html = readFileSync(indexPath, "utf8");
  const stylesheets = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => ({
      relations: (attributeValue(tag, "rel") ?? "").toLowerCase().split(/\s+/),
      source: attributeValue(tag, "href"),
    }))
    .filter(({ relations, source }) => relations.includes("stylesheet") && source);
  if (stylesheets.length !== 1) {
    throw new Error(`production entry stylesheet는 정확히 1개여야 합니다: ${stylesheets.length}개`);
  }

  const { entryFile, entryPath } = resolveEntryPath(distDir, stylesheets[0].source);
  if (!existsSync(entryPath)) throw new Error(`entry stylesheet 파일이 없습니다: ${entryFile}`);
  const bytes = statSync(entryPath).size;
  if (bytes >= limitBytes) {
    throw new Error(`${entryFile}은 ${bytes}바이트입니다. ${limitBytes}바이트 미만이어야 합니다.`);
  }
  return { entryFile, bytes, limitBytes };
}
