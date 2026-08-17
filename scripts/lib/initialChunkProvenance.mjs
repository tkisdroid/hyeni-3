import { createHash } from "node:crypto";

export const INITIAL_CHUNK_PROVENANCE_FILE = "initial-chunk-provenance.json";

const THIRD_PARTY_REASON = "허용된 React·React Intl runtime source만 포함합니다.";
const FIRST_PARTY_REASON = "first-party 모듈이 포함되어 자체 JS 예산에 합산합니다.";

export const ALLOWED_INITIAL_RUNTIME_SOURCES = Object.freeze([
  { source: "@formatjs/fast-memoize", reason: "React Intl 메시지 포맷 캐시의 직접 전이 의존성입니다." },
  { source: "@formatjs/icu-messageformat-parser", reason: "React Intl ICU 메시지 파서의 직접 전이 의존성입니다." },
  { source: "@formatjs/icu-skeleton-parser", reason: "React Intl ICU skeleton 파서의 직접 전이 의존성입니다." },
  { source: "@formatjs/intl", reason: "react-intl이 사용하는 FormatJS intl runtime입니다." },
  { source: "intl-messageformat", reason: "react-intl의 ICU 메시지 포맷 runtime입니다." },
  { source: "react", reason: "애플리케이션의 React runtime입니다." },
  { source: "react-dom", reason: "애플리케이션의 React DOM runtime입니다." },
  { source: "react-intl", reason: "애플리케이션의 국제화 runtime입니다." },
  { source: "scheduler", reason: "react-dom의 scheduler 전이 의존성입니다." },
  { source: "virtual:commonjsHelpers.js", reason: "허용 runtime의 CommonJS 변환을 위해 Rollup이 생성한 정확한 가상 helper입니다." },
]);

export const ALLOWED_INITIAL_RUNTIME_PACKAGES = Object.freeze(
  ALLOWED_INITIAL_RUNTIME_SOURCES
    .map(({ source }) => source)
    .filter((source) => !source.startsWith("virtual:")),
);

const allowedRuntimePackages = new Set(ALLOWED_INITIAL_RUNTIME_PACKAGES);
const allowedRuntimeVirtualModules = new Set(
  ALLOWED_INITIAL_RUNTIME_SOURCES
    .map(({ source }) => source)
    .filter((source) => source.startsWith("virtual:")),
);

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

function normalizeSlashes(value) {
  return value.replaceAll("\\", "/");
}

function withoutQuery(value) {
  return value.split("?", 1)[0];
}

export function normalizeInitialChunkModuleId(moduleId, { rootDir } = {}) {
  const normalized = withoutQuery(normalizeSlashes(moduleId));
  const nodeModulesMarker = "/node_modules/";
  const nodeModulesIndex = normalized.lastIndexOf(nodeModulesMarker);
  if (nodeModulesIndex >= 0) return `node_modules/${normalized.slice(nodeModulesIndex + nodeModulesMarker.length)}`;

  const normalizedRoot = rootDir ? normalizeSlashes(rootDir).replace(/\/$/u, "") : "";
  if (normalizedRoot && normalized.startsWith(`${normalizedRoot}/`)) {
    return normalized.slice(normalizedRoot.length + 1);
  }
  if (normalized.startsWith("\u0000")) return `virtual:${normalized.slice(1)}`;
  return `outside-root:${normalized.split("/").at(-1) ?? normalized}`;
}

function packageNameFromModule(moduleId) {
  if (!moduleId.startsWith("node_modules/")) return null;
  const path = moduleId.slice("node_modules/".length);
  const segments = path.split("/");
  return path.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

export function classifyInitialChunkModules(modules) {
  const thirdPartyOnly = modules.length > 0 && modules.every((moduleId) => {
    if (allowedRuntimeVirtualModules.has(moduleId)) return true;
    const packageName = packageNameFromModule(moduleId);
    return packageName !== null && allowedRuntimePackages.has(packageName);
  });
  return thirdPartyOnly
    ? { classification: "third-party-runtime", reason: THIRD_PARTY_REASON }
    : { classification: "first-party", reason: FIRST_PARTY_REASON };
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function canonicalRecord(record) {
  return {
    file: record.file,
    bytes: record.bytes,
    sha256: record.sha256,
    modules: [...new Set(record.modules)].sort(compareCodePoints),
    classification: record.classification,
    reason: record.reason,
  };
}

export function serializeInitialChunkProvenanceRecords(records) {
  const chunks = records
    .map(canonicalRecord)
    .sort((left, right) => compareCodePoints(left.file, right.file));
  return `${JSON.stringify({ schemaVersion: 1, chunks }, null, 2)}\n`;
}

export function serializeInitialChunkProvenance(chunks, { rootDir } = {}) {
  const records = chunks.map(({ file, code, moduleIds }) => {
    const modules = [...new Set(moduleIds.map((moduleId) => (
      normalizeInitialChunkModuleId(moduleId, { rootDir })
    )))].sort(compareCodePoints);
    return {
      file,
      bytes: Buffer.byteLength(code),
      sha256: sha256(code),
      modules,
      ...classifyInitialChunkModules(modules),
    };
  });
  return serializeInitialChunkProvenanceRecords(records);
}
