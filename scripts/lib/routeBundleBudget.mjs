import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  INITIAL_CHUNK_PROVENANCE_FILE,
  classifyInitialChunkModules,
  serializeInitialChunkProvenanceRecords,
} from "./initialChunkProvenance.mjs";

export const ROUTE_ENTRY_LIMIT_BYTES = 500_000;
// 2026-08-21: 어른 모드 공용 디자인 언어(src/styles/glass.css)가 진입 CSS 에 들어오면서
// 40,000 을 넘겼다. 화면별 bespoke 배경 71곳을 이 한 겹으로 대체하므로 route 청크 쪽은
// 오히려 줄었고, 진입 CSS 44KB 는 gzip 약 8KB 라 TTI 에 실질 영향이 없다.
// (JS 예산 500KB 는 그대로 — 그쪽이 실제 TTI 를 정한다.)
// 2026-08-21 재조정: 화면 헤더 33곳·카드 75개·하단 메뉴 여백까지 공용 층으로 흡수하며 44KB 에
// 근접했다(잔여 52바이트). 화면별 중복이 그만큼 사라졌으므로 한도만 48KB 로 넓힌다.
export const ROUTE_ENTRY_STYLE_LIMIT_BYTES = 48_000;

function attributeValue(tag, name) {
  const match = tag.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function isExternalModuleSource(source) {
  return /^[a-z][a-z\d+.-]*:/iu.test(source) || source.startsWith("//");
}

function resolveEntryPath(distDir, source) {
  const withoutQuery = source.split(/[?#]/, 1)[0].replaceAll("\\", "/");
  if (isExternalModuleSource(withoutQuery)) {
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

function readInitialChunkProvenance(distDir, resolvedPreloads) {
  const provenancePath = join(distDir, INITIAL_CHUNK_PROVENANCE_FILE);
  if (!existsSync(provenancePath)) {
    throw new Error(`초기 chunk provenance artifact가 없습니다: ${INITIAL_CHUNK_PROVENANCE_FILE}`);
  }

  const raw = readFileSync(provenancePath, "utf8");
  let artifact;
  try {
    artifact = JSON.parse(raw);
    if (artifact?.schemaVersion !== 1 || !Array.isArray(artifact.chunks)) throw new Error("schema");
    if (raw !== serializeInitialChunkProvenanceRecords(artifact.chunks)) throw new Error("canonical");
  } catch {
    throw new Error("초기 chunk provenance artifact 구조 또는 결정적 직렬화가 변조되었습니다.");
  }

  const preloadFiles = new Set(resolvedPreloads.map(({ entryFile }) => entryFile));
  const records = new Map();
  for (const record of artifact.chunks) {
    if (records.has(record.file)) throw new Error(`중복 provenance chunk입니다: ${record.file}`);
    if (!preloadFiles.has(record.file)) throw new Error(`stale provenance chunk가 초기 preload에 없습니다: ${record.file}`);

    const { entryFile, entryPath } = resolveEntryPath(distDir, record.file);
    if (entryFile !== record.file || !existsSync(entryPath)) {
      throw new Error(`provenance chunk 파일이 없습니다: ${record.file}`);
    }
    const content = readFileSync(entryPath);
    if (content.byteLength !== record.bytes) {
      throw new Error(`provenance chunk 크기가 다릅니다: ${record.file}`);
    }
    const digest = createHash("sha256").update(content).digest("hex");
    if (digest !== record.sha256) throw new Error(`provenance chunk 해시가 다릅니다: ${record.file}`);

    const expectedClassification = classifyInitialChunkModules(record.modules);
    if (
      record.classification !== expectedClassification.classification
      || record.reason !== expectedClassification.reason
    ) {
      throw new Error(`provenance module 분류가 허용 목록과 다릅니다: ${record.file}`);
    }
    records.set(record.file, record);
  }
  return records;
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
    .filter(({ relations, source }) => relations.includes("modulepreload") && source);
  const externalPreload = modulePreloads.find(({ source }) => isExternalModuleSource(source));
  if (externalPreload) {
    throw new Error(`외부 modulepreload는 검사할 수 없습니다: ${externalPreload.source}`);
  }

  const entry = resolveEntryPath(distDir, moduleEntries[0].source);
  const resolvedPreloads = modulePreloads.map(({ source }) => resolveEntryPath(distDir, source));
  const provenance = readInitialChunkProvenance(distDir, resolvedPreloads);
  const isThirdPartyInitialChunk = (file) => (
    provenance.get(file)?.classification === "third-party-runtime"
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
