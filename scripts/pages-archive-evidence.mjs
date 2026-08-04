import { readFileSync, statSync } from "node:fs";
import { TextDecoder } from "node:util";
import { inflateRawSync } from "node:zlib";
import { normalizeSha256, sha256 } from "./release-evidence.mjs";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const UTF8_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const ENCRYPTED_FLAG = 0x0001;
const ALLOWED_GENERAL_PURPOSE_FLAGS = UTF8_FLAG | DATA_DESCRIPTOR_FLAG | 0x0006;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRY_COUNT = 20_000;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;
const MAX_PATH_BYTES = 4096;
const MAX_SEGMENT_BYTES = 255;
const MAX_COMPRESSION_RATIO = 1000;
const COMPRESSION_RATIO_MINIMUM_BYTES = 16 * 1024 * 1024;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

export const REQUIRED_PAGES_ARCHIVE_FILES = Object.freeze([
  "index.html",
  "_headers",
  "app-version.json",
  "manifest.webmanifest",
  "sw.js",
  ".well-known/assetlinks.json",
]);

function fail(message) {
  throw new Error(`known-good Pages ZIP 검증 실패: ${message}`);
}

function compareNames(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareManifestPaths(left, right) {
  const leftSegments = left.split("/");
  const rightSegments = right.split("/");
  const length = Math.min(leftSegments.length, rightSegments.length);
  for (let index = 0; index < length; index += 1) {
    const compared = compareNames(leftSegments[index], rightSegments[index]);
    if (compared !== 0) return compared;
  }
  return leftSegments.length - rightSegments.length;
}

function crc32(value) {
  let checksum = 0xffffffff;
  for (const byte of value) {
    checksum = (checksum >>> 8) ^ CRC32_TABLE[(checksum ^ byte) & 0xff];
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(archive) {
  if (archive.length < 22) fail("EOCD가 없어 ZIP 파일이 아닙니다.");
  const minimumOffset = Math.max(0, archive.length - 22 - 0xffff);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = archive.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === archive.length) return offset;
  }
  fail("정상적인 EOCD를 찾을 수 없어 ZIP 파일이 아닙니다.");
}

function decodeEntryName(bytes, flags) {
  if (bytes.length === 0) fail("이름이 빈 archive entry가 있습니다.");
  if (bytes.length > MAX_PATH_BYTES) fail("archive entry 경로가 허용 길이를 넘습니다.");
  if ((flags & UTF8_FLAG) === 0 && bytes.some((byte) => byte > 0x7f)) {
    fail("UTF-8 표시가 없는 비 ASCII archive entry 이름은 허용하지 않습니다.");
  }
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    fail("UTF-8로 해석할 수 없는 archive entry 이름이 있습니다.");
  }
}

function portablePathKey(path) {
  return path.normalize("NFC").toLowerCase();
}

function validateEntryPath(path) {
  if (
    path.includes("\\")
    || path.startsWith("/")
    || /^[a-zA-Z]:/.test(path)
    || /[\u0000-\u001f\u007f-\u009f]/u.test(path)
  ) {
    fail(`안전하지 않은 archive entry 경로입니다: ${JSON.stringify(path)}`);
  }
  const directory = path.endsWith("/");
  const pathWithoutSlash = directory ? path.slice(0, -1) : path;
  const segments = pathWithoutSlash.split("/");
  if (
    !pathWithoutSlash
    || segments.some((segment) => (
      !segment
      || segment === "."
      || segment === ".."
      || segment.includes(":")
      || /[. ]$/u.test(segment)
      || Buffer.byteLength(segment, "utf8") > MAX_SEGMENT_BYTES
    ))
  ) {
    fail(`안전하지 않은 archive entry 경로입니다: ${JSON.stringify(path)}`);
  }
  for (const segment of segments) {
    const deviceName = segment.split(".", 1)[0].toUpperCase();
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(deviceName)) {
      fail(`Windows 예약 이름을 사용한 archive entry입니다: ${JSON.stringify(path)}`);
    }
  }
  return { directory, path: pathWithoutSlash, segments };
}

function validateExtraFields(extra, label) {
  let offset = 0;
  while (offset < extra.length) {
    if (offset + 4 > extra.length) fail(`${label} extra field가 잘렸습니다.`);
    const id = extra.readUInt16LE(offset);
    const size = extra.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + size > extra.length) fail(`${label} extra field 길이가 올바르지 않습니다.`);
    if (id === ZIP64_EXTRA_FIELD_ID) fail("ZIP64 archive는 지원하지 않습니다.");
    offset += size;
  }
}

function classifyEntry({ pathInfo, versionMadeBy, externalAttributes }) {
  const platform = versionMadeBy >>> 8;
  const unixMode = platform === 3 ? (externalAttributes >>> 16) & 0xffff : 0;
  const unixType = unixMode & 0o170000;
  const dosDirectory = (externalAttributes & 0x10) !== 0;
  if (unixType === 0o120000) fail(`symbolic link archive entry는 허용하지 않습니다: ${pathInfo.path}`);
  if (unixType && unixType !== 0o040000 && unixType !== 0o100000) {
    fail(`특수 파일 archive entry는 허용하지 않습니다: ${pathInfo.path}`);
  }
  if (pathInfo.directory && unixType === 0o100000) {
    fail(`파일 형식과 경로가 충돌하는 archive entry입니다: ${pathInfo.path}/`);
  }
  if (!pathInfo.directory && (unixType === 0o040000 || dosDirectory)) {
    fail(`디렉터리 형식과 경로가 충돌하는 archive entry입니다: ${pathInfo.path}`);
  }
  return pathInfo.directory;
}

function parseCentralDirectory(archive, eocdOffset) {
  const diskNumber = archive.readUInt16LE(eocdOffset + 4);
  const centralDisk = archive.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = archive.readUInt16LE(eocdOffset + 8);
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralSize = archive.readUInt32LE(eocdOffset + 12);
  const centralOffset = archive.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    fail("분할 ZIP archive는 지원하지 않습니다.");
  }
  if (
    entryCount === 0xffff
    || centralSize === 0xffffffff
    || centralOffset === 0xffffffff
  ) {
    fail("ZIP64 archive는 지원하지 않습니다.");
  }
  if (entryCount < 1 || entryCount > MAX_ENTRY_COUNT) {
    fail(`archive entry 개수가 허용 범위를 벗어났습니다: ${entryCount}`);
  }
  const centralEnd = centralOffset + centralSize;
  if (!Number.isSafeInteger(centralEnd) || centralEnd !== eocdOffset) {
    fail("central directory 범위가 올바르지 않습니다.");
  }

  const entries = [];
  const exactNames = new Set();
  const portableNames = new Map();
  let totalUncompressedBytes = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralEnd || archive.readUInt32LE(offset) !== CENTRAL_HEADER_SIGNATURE) {
      fail(`central directory entry ${index + 1}이 올바르지 않습니다.`);
    }
    const versionMadeBy = archive.readUInt16LE(offset + 4);
    const versionNeeded = archive.readUInt16LE(offset + 6);
    const flags = archive.readUInt16LE(offset + 8);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const expectedCrc32 = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const diskStart = archive.readUInt16LE(offset + 34);
    const externalAttributes = archive.readUInt32LE(offset + 38);
    const localOffset = archive.readUInt32LE(offset + 42);
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > centralEnd) fail(`central directory entry ${index + 1}이 잘렸습니다.`);
    if (
      compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff
      || localOffset === 0xffffffff
      || diskStart === 0xffff
    ) {
      fail("ZIP64 archive는 지원하지 않습니다.");
    }
    if (diskStart !== 0) fail("분할 ZIP archive entry는 지원하지 않습니다.");
    if (versionNeeded > 20) fail(`지원하지 않는 ZIP version입니다: ${versionNeeded}`);
    if ((flags & ENCRYPTED_FLAG) !== 0) fail("암호화된 archive entry는 허용하지 않습니다.");
    if ((flags & ~ALLOWED_GENERAL_PURPOSE_FLAGS) !== 0) {
      fail(`지원하지 않는 ZIP flag가 있습니다: 0x${flags.toString(16)}`);
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      fail(`지원하지 않는 ZIP 압축 방식입니다: ${compressionMethod}`);
    }
    if (compressionMethod === 0 && (flags & 0x0006) !== 0) {
      fail("저장 방식 entry에 deflate 전용 flag가 설정되어 있습니다.");
    }
    if (uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      fail("archive entry의 압축 해제 크기가 허용 범위를 넘습니다.");
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      fail("archive 전체 압축 해제 크기가 허용 범위를 넘습니다.");
    }
    if (
      uncompressedSize >= COMPRESSION_RATIO_MINIMUM_BYTES
      && (compressedSize === 0 || uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO)
    ) {
      fail("archive entry 압축률이 안전 한도를 넘습니다.");
    }

    const rawName = archive.subarray(offset + 46, offset + 46 + nameLength);
    const extra = archive.subarray(
      offset + 46 + nameLength,
      offset + 46 + nameLength + extraLength,
    );
    validateExtraFields(extra, "central directory");
    const name = decodeEntryName(rawName, flags);
    const pathInfo = validateEntryPath(name);
    const directory = classifyEntry({ pathInfo, versionMadeBy, externalAttributes });
    const collisionPath = pathInfo.path;
    if (exactNames.has(name)) fail(`동일 경로 archive entry가 중복되었습니다: ${name}`);
    exactNames.add(name);
    const portableKey = portablePathKey(collisionPath);
    const existingPortableName = portableNames.get(portableKey);
    if (existingPortableName && existingPortableName !== collisionPath) {
      fail(`portable-name 충돌 archive entry입니다: ${existingPortableName}, ${collisionPath}`);
    }
    portableNames.set(portableKey, collisionPath);
    entries.push({
      name,
      path: pathInfo.path,
      directory,
      rawName,
      versionNeeded,
      flags,
      compressionMethod,
      expectedCrc32,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    offset = entryEnd;
  }
  if (offset !== centralEnd) fail("central directory 크기와 entry 합계가 다릅니다.");

  const filePaths = new Set(entries.filter((entry) => !entry.directory).map((entry) => entry.path));
  const directoryPaths = new Set(entries.filter((entry) => entry.directory).map((entry) => entry.path));
  const portableFilePaths = new Set([...filePaths].map(portablePathKey));
  const portableDirectoryPaths = new Set([...directoryPaths].map(portablePathKey));
  for (const entry of entries) {
    const segments = entry.path.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      const ancestor = segments.slice(0, length).join("/");
      if (filePaths.has(ancestor) || portableFilePaths.has(portablePathKey(ancestor))) {
        fail(`파일과 하위 경로가 충돌하는 archive entry입니다: ${ancestor}`);
      }
    }
    if (
      !entry.directory
      && (directoryPaths.has(entry.path) || portableDirectoryPaths.has(portablePathKey(entry.path)))
    ) {
      fail(`파일과 디렉터리가 충돌하는 archive entry입니다: ${entry.path}`);
    }
  }

  return { entries, centralOffset, entryCount };
}

function validateLocalEntries(archive, entries, centralOffset) {
  const ranges = [];
  for (const entry of entries) {
    const offset = entry.localOffset;
    if (offset + 30 > centralOffset || archive.readUInt32LE(offset) !== LOCAL_HEADER_SIGNATURE) {
      fail(`local header가 올바르지 않습니다: ${entry.path}`);
    }
    const versionNeeded = archive.readUInt16LE(offset + 4);
    const flags = archive.readUInt16LE(offset + 6);
    const compressionMethod = archive.readUInt16LE(offset + 8);
    const localCrc32 = archive.readUInt32LE(offset + 14);
    const localCompressedSize = archive.readUInt32LE(offset + 18);
    const localUncompressedSize = archive.readUInt32LE(offset + 22);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const headerEnd = offset + 30 + nameLength + extraLength;
    if (headerEnd > centralOffset) fail(`local header가 잘렸습니다: ${entry.path}`);
    const localName = archive.subarray(offset + 30, offset + 30 + nameLength);
    if (!localName.equals(entry.rawName)) fail(`local/central entry 이름이 다릅니다: ${entry.path}`);
    if (
      versionNeeded !== entry.versionNeeded
      || flags !== entry.flags
      || compressionMethod !== entry.compressionMethod
    ) {
      fail(`local/central entry version, flag 또는 압축 방식이 다릅니다: ${entry.path}`);
    }
    validateExtraFields(
      archive.subarray(offset + 30 + nameLength, headerEnd),
      "local header",
    );
    const usesDescriptor = (entry.flags & DATA_DESCRIPTOR_FLAG) !== 0;
    if (!usesDescriptor && (
      localCrc32 !== entry.expectedCrc32
      || localCompressedSize !== entry.compressedSize
      || localUncompressedSize !== entry.uncompressedSize
    )) {
      fail(`local/central entry 크기 또는 CRC가 다릅니다: ${entry.path}`);
    }
    if (usesDescriptor && (
      (localCrc32 !== 0 && localCrc32 !== entry.expectedCrc32)
      || (localCompressedSize !== 0 && localCompressedSize !== entry.compressedSize)
      || (localUncompressedSize !== 0 && localUncompressedSize !== entry.uncompressedSize)
    )) {
      fail(`data descriptor entry의 local 값이 올바르지 않습니다: ${entry.path}`);
    }

    const dataStart = headerEnd;
    const dataEnd = dataStart + entry.compressedSize;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > centralOffset) {
      fail(`압축 데이터 범위가 올바르지 않습니다: ${entry.path}`);
    }
    let localEnd = dataEnd;
    if (usesDescriptor) {
      const hasSignature = dataEnd + 4 <= centralOffset
        && archive.readUInt32LE(dataEnd) === DATA_DESCRIPTOR_SIGNATURE;
      const descriptorOffset = dataEnd + (hasSignature ? 4 : 0);
      if (descriptorOffset + 12 > centralOffset) {
        fail(`data descriptor가 잘렸습니다: ${entry.path}`);
      }
      if (
        archive.readUInt32LE(descriptorOffset) !== entry.expectedCrc32
        || archive.readUInt32LE(descriptorOffset + 4) !== entry.compressedSize
        || archive.readUInt32LE(descriptorOffset + 8) !== entry.uncompressedSize
      ) {
        fail(`data descriptor 값이 올바르지 않습니다: ${entry.path}`);
      }
      localEnd = descriptorOffset + 12;
    }
    entry.dataStart = dataStart;
    ranges.push({ start: offset, end: localEnd, path: entry.path });
  }

  ranges.sort((left, right) => left.start - right.start);
  let expectedStart = 0;
  for (const range of ranges) {
    if (range.start !== expectedStart) {
      fail(`local entry 사이에 중복되거나 설명되지 않은 데이터가 있습니다: ${range.path}`);
    }
    expectedStart = range.end;
  }
  if (expectedStart !== centralOffset) {
    fail("local entry 영역과 central directory 사이에 설명되지 않은 데이터가 있습니다.");
  }
}

function resolveArchiveRoot(entries) {
  const fileEntries = entries.filter((entry) => !entry.directory);
  if (fileEntries.length < 1) fail("archive에 배포 파일이 없습니다.");
  const rootNames = new Set(fileEntries.map((entry) => entry.path));
  const hasRootRequirements = REQUIRED_PAGES_ARCHIVE_FILES.every((path) => rootNames.has(path));
  let rootPrefix = null;
  if (!hasRootRequirements) {
    const firstSegments = new Set(fileEntries.map((entry) => entry.path.split("/", 1)[0]));
    if (
      firstSegments.size !== 1
      || fileEntries.some((entry) => !entry.path.includes("/"))
    ) {
      fail("필수 PWA 파일이 archive 루트 또는 단일 최상위 디렉터리에 없습니다.");
    }
    rootPrefix = `${firstSegments.values().next().value}/`;
  }

  const normalizedNames = new Set();
  const portableNames = new Map();
  for (const entry of fileEntries) {
    const normalizedPath = rootPrefix ? entry.path.slice(rootPrefix.length) : entry.path;
    if (!normalizedPath) fail("최상위 디렉터리 자체를 파일로 사용할 수 없습니다.");
    if (normalizedNames.has(normalizedPath)) fail(`정규화 뒤 파일 경로가 중복됩니다: ${normalizedPath}`);
    normalizedNames.add(normalizedPath);
    const portableKey = portablePathKey(normalizedPath);
    const existing = portableNames.get(portableKey);
    if (existing && existing !== normalizedPath) {
      fail(`정규화 뒤 portable-name이 충돌합니다: ${existing}, ${normalizedPath}`);
    }
    portableNames.set(portableKey, normalizedPath);
    entry.normalizedPath = normalizedPath;
  }
  for (const requiredPath of REQUIRED_PAGES_ARCHIVE_FILES) {
    if (!normalizedNames.has(requiredPath)) fail(`필수 PWA 파일이 없습니다: ${requiredPath}`);
  }
  if (![...normalizedNames].some((path) => path.startsWith("assets/") && path.length > 7)) {
    fail("필수 Pages assets 파일이 없습니다.");
  }
  return { fileEntries, rootPrefix };
}

function decompressEntry(archive, entry) {
  const compressed = archive.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  let contents;
  if (entry.compressionMethod === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      fail(`저장 방식 entry의 압축/원본 크기가 다릅니다: ${entry.path}`);
    }
    contents = compressed;
  } else {
    try {
      contents = inflateRawSync(compressed, {
        maxOutputLength: Math.min(MAX_ENTRY_UNCOMPRESSED_BYTES, entry.uncompressedSize + 1),
      });
    } catch {
      fail(`deflate 데이터를 안전하게 해제할 수 없습니다: ${entry.path}`);
    }
  }
  if (contents.length !== entry.uncompressedSize) {
    fail(`압축 해제 크기가 central directory와 다릅니다: ${entry.path}`);
  }
  if (crc32(contents) !== entry.expectedCrc32) {
    fail(`archive entry CRC가 다릅니다: ${entry.path}`);
  }
  if (entry.directory && contents.length !== 0) {
    fail(`디렉터리 archive entry에 데이터가 있습니다: ${entry.path}`);
  }
  return contents;
}

function parseRequiredJson(path, contents, expectedKind) {
  let value;
  try {
    value = JSON.parse(utf8Decoder.decode(contents));
  } catch {
    fail(`${path}가 유효한 UTF-8 JSON이 아닙니다.`);
  }
  if (expectedKind === "array" && !Array.isArray(value)) fail(`${path}의 JSON 형식이 올바르지 않습니다.`);
  if (
    expectedKind === "object"
    && (!value || typeof value !== "object" || Array.isArray(value))
  ) {
    fail(`${path}의 JSON 형식이 올바르지 않습니다.`);
  }
}

function buildTreeEvidence(archive, entries) {
  const requiredContents = new Map();
  const manifestEntries = [];
  for (const entry of entries) {
    const contents = decompressEntry(archive, entry);
    if (entry.directory) continue;
    manifestEntries.push({
      path: entry.normalizedPath,
      bytes: contents.length,
      sha256: sha256(contents),
    });
    if (REQUIRED_PAGES_ARCHIVE_FILES.includes(entry.normalizedPath)) {
      requiredContents.set(entry.normalizedPath, contents);
    }
  }
  for (const requiredPath of REQUIRED_PAGES_ARCHIVE_FILES) {
    if ((requiredContents.get(requiredPath)?.length ?? 0) === 0) {
      fail(`필수 PWA 파일이 비어 있습니다: ${requiredPath}`);
    }
  }
  parseRequiredJson("app-version.json", requiredContents.get("app-version.json"), "object");
  parseRequiredJson("manifest.webmanifest", requiredContents.get("manifest.webmanifest"), "object");
  parseRequiredJson(".well-known/assetlinks.json", requiredContents.get(".well-known/assetlinks.json"), "array");

  manifestEntries.sort((left, right) => compareManifestPaths(left.path, right.path));
  const manifest = manifestEntries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`);
  return {
    fileCount: manifestEntries.length,
    treeSha256: sha256(`${manifest.join("\n")}\n`),
  };
}

export function inspectKnownGoodPagesArchive(
  archivePath,
  { expectedArchiveSha256, expectedTreeSha256 } = {},
) {
  const normalizedArchiveSha256 = normalizeSha256(expectedArchiveSha256);
  const normalizedTreeSha256 = normalizeSha256(expectedTreeSha256);
  if (!normalizedArchiveSha256) fail("archive SHA-256 선언값이 올바르지 않습니다.");
  if (!normalizedTreeSha256) fail("dist tree SHA-256 선언값이 올바르지 않습니다.");

  const stat = statSync(archivePath);
  if (!stat.isFile()) fail("archive 경로가 파일이 아닙니다.");
  if (stat.size < 22 || stat.size > MAX_ARCHIVE_BYTES) {
    fail(`archive 크기가 허용 범위를 벗어났습니다: ${stat.size}`);
  }
  const archive = readFileSync(archivePath);
  if (archive.length !== stat.size) fail("archive가 검증 중 변경되었습니다.");
  const archiveSha256 = sha256(archive);
  if (archiveSha256 !== normalizedArchiveSha256) fail("archive SHA-256이 실제 파일과 다릅니다.");

  const eocdOffset = findEndOfCentralDirectory(archive);
  const { entries, centralOffset, entryCount } = parseCentralDirectory(archive, eocdOffset);
  validateLocalEntries(archive, entries, centralOffset);
  const { fileEntries, rootPrefix } = resolveArchiveRoot(entries);
  const tree = buildTreeEvidence(archive, entries);
  if (tree.treeSha256 !== normalizedTreeSha256) {
    fail("archive 내부 tree SHA-256이 known-good dist 선언값과 다릅니다.");
  }

  return {
    format: "zip",
    archiveSha256,
    treeSha256: tree.treeSha256,
    fileCount: tree.fileCount,
    archiveEntryCount: entryCount,
    directoryEntryCount: entryCount - fileEntries.length,
    rootPrefix,
    requiredFilesPresent: true,
    allEntriesSafe: true,
    noDuplicateOrPortableNameCollisions: true,
    archiveSha256Matched: true,
    treeSha256Matched: true,
  };
}
