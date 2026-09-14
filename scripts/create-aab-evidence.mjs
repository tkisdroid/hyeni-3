import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  hashDirectory,
  hashFile,
  isReleaseVersionPolicySafe,
  normalizeCommit,
  normalizeSha256,
  readAppReleaseMetadata,
  readGitState,
  sha256,
} from "./release-evidence.mjs";
import { inspectAndroidManifestPolicy } from "./android-manifest-policy.mjs";

const SOURCE_META_NAME = "com.hyeni.calendar.RELEASE_SOURCE_SHA";
export const APPROVED_BUNDLETOOL_VERSION = "1.18.1";
export const APPROVED_BUNDLETOOL_SHA256 = "675786493983787ffa11550bdb7c0715679a44e1643f3ff980a529e9c822595c";
export const CAPACITOR_PUBLIC_PROJECTION_VERSION = 1;
export const CAPACITOR_GENERATED_PUBLIC_FILES = Object.freeze([
  "cordova.js",
  "cordova_plugins.js",
]);
export const ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES = Object.freeze([
  ".well-known/assetlinks.json",
]);
export const EMPTY_FILE_SHA256 = sha256(Buffer.alloc(0));

function portablePathKey(value) {
  return value.normalize("NFC").toLowerCase();
}

export function assertNoCapacitorGeneratedFileCollisions(distRoot) {
  const resolvedDistRoot = resolve(distRoot);
  if (!existsSync(resolvedDistRoot) || !statSync(resolvedDistRoot).isDirectory()) {
    throw new Error("AAB evidence를 만들 현재 dist가 없거나 디렉터리가 아닙니다.");
  }
  const reservedKeys = new Set(CAPACITOR_GENERATED_PUBLIC_FILES.map(portablePathKey));
  const collision = readdirSync(resolvedDistRoot).find((name) => reservedKeys.has(portablePathKey(name)));
  if (collision) {
    throw new Error(`dist 루트에 Capacitor 생성 예약 파일과 충돌하는 항목이 있습니다: ${collision}`);
  }
}

export function assertArchiveEntriesSafe(entries, { kind } = {}) {
  if (!Array.isArray(entries) || entries.length < 1) {
    throw new Error("검증할 archive entry가 없습니다.");
  }
  if (!new Set(["aab", "apks", "apk"]).has(kind)) {
    throw new Error("archive kind는 aab, apks 또는 apk여야 합니다.");
  }

  const exactEntries = new Map();
  const portableEntries = new Map();
  const validated = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || !entry) {
      throw new Error("archive에 빈 entry 이름이 있습니다.");
    }
    if (
      entry.includes("\\")
      || entry.startsWith("/")
      || /^[A-Za-z]:/.test(entry)
      || /[\u0000-\u001f\u007f]/.test(entry)
    ) {
      throw new Error(`archive에 안전하지 않은 entry 경로가 있습니다: ${JSON.stringify(entry)}`);
    }
    const isDirectory = entry.endsWith("/");
    const canonical = isDirectory ? entry.slice(0, -1) : entry;
    const segments = canonical.split("/");
    if (!canonical || segments.some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error(`archive에 경로 순회 또는 빈 segment가 있습니다: ${JSON.stringify(entry)}`);
    }
    if (exactEntries.has(canonical)) {
      throw new Error(`archive에 중복 entry가 있습니다: ${canonical}`);
    }
    const portableKey = portablePathKey(canonical);
    if (portableEntries.has(portableKey)) {
      throw new Error(
        `archive에 대소문자 또는 Unicode 정규화 충돌 entry가 있습니다: ${portableEntries.get(portableKey)} / ${canonical}`,
      );
    }
    if (
      kind === "aab"
      && (
        (segments[0] === "assets" && segments[1] === "public")
        || (segments[1] === "assets" && segments[2] === "public" && segments[0] !== "base")
      )
    ) {
      throw new Error(`AAB base 모듈 밖에 web assets가 있습니다: ${canonical}`);
    }
    exactEntries.set(canonical, { isDirectory });
    portableEntries.set(portableKey, canonical);
    validated.push(canonical);
  }

  for (const canonical of validated) {
    const segments = canonical.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = segments.slice(0, index).join("/");
      if (exactEntries.get(ancestor)?.isDirectory === false) {
        throw new Error(`archive에 파일/디렉터리 경로 충돌이 있습니다: ${ancestor} / ${canonical}`);
      }
    }
  }
  return { kind, entryCount: entries.length, safe: true };
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 값이 필요합니다.`);
  return value.trim();
}

function defaultCommandRunner(command, args, { cwd } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim().split(/\r?\n/, 1)[0];
    throw new Error(`${basename(command)} 실행 실패(exit ${result.status}): ${detail || "출력 없음"}`);
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    combined: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function resolveExecutable(command) {
  if (isAbsolute(command)) return resolve(command);
  if (command.includes("/") || command.includes("\\")) return resolve(command);
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, [command], {
    encoding: "utf8",
    windowsHide: true,
  });
  const first = result.status === 0 ? result.stdout.trim().split(/\r?\n/, 1)[0] : null;
  if (!first) throw new Error(`${command} 실행 파일 경로를 확인할 수 없습니다.`);
  return resolve(first);
}

function bundletool(commandRunner, javaPath, jarPath, args) {
  return commandRunner(javaPath, ["-jar", jarPath, ...args]).stdout.trim();
}

function dumpManifestValue(commandRunner, javaPath, jarPath, aabPath, xpath) {
  return bundletool(commandRunner, javaPath, jarPath, [
    "dump",
    "manifest",
    `--bundle=${aabPath}`,
    `--xpath=${xpath}`,
  ]).trim();
}

function walkSoFiles(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) files.push(...walkSoFiles(root, path));
    else if (entry.isFile() && entry.name.endsWith(".so")) files.push(path);
  }
  return files.sort();
}

function parseCertificateSha256(output) {
  const match = output.match(/SHA256:\s*((?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}|[0-9A-Fa-f]{64})/);
  return match ? normalizeSha256(match[1].replaceAll(":", "")) : null;
}

function toolEvidence(path) {
  return {
    fileName: basename(path),
    sha256: hashFile(path),
  };
}

function textEvidence(value) {
  const normalized = value.endsWith("\n") ? value : `${value}\n`;
  return {
    value: normalized,
    bytes: Buffer.byteLength(normalized, "utf8"),
    sha256: sha256(normalized),
  };
}

export function redactManifestApiKeys(manifest) {
  // 정책 검사는 원본 manifest로 수행하고, 보관 로그에서만 공개 클라이언트 키를 가린다.
  return manifest.replace(/<meta-data\b[^>]*>/g, (tag) => {
    if (!/\bandroid:name\s*=\s*(["'])com\.google\.android\.geo\.API_KEY\1/.test(tag)) return tag;
    return tag.replace(/(\bandroid:value\s*=\s*)(["'])[\s\S]*?\2/g, "$1$2[REDACTED]$2");
  });
}

function archiveEntries(commandRunner, jarToolPath, archivePath, kind) {
  const output = commandRunner(jarToolPath, ["tf", archivePath]).stdout;
  const entries = output.split(/\r?\n/);
  if (entries.at(-1) === "") entries.pop();
  const result = assertArchiveEntriesSafe(entries, { kind });
  return { entries, ...result };
}

function normalizeDirectoryEvidence(value, label) {
  const sha256Value = normalizeSha256(value?.sha256);
  const fileCount = value?.fileCount;
  if (!sha256Value || !Number.isSafeInteger(fileCount) || fileCount < 1) {
    throw new Error(`${label}가 없거나 비어 있습니다.`);
  }
  return { sha256: sha256Value, fileCount };
}

function sameDirectoryEvidence(left, right) {
  return left.sha256 === right.sha256 && left.fileCount === right.fileCount;
}

function readCapacitorGeneratedFiles(root, label) {
  return CAPACITOR_GENERATED_PUBLIC_FILES.map((path) => {
    const resolvedPath = resolve(root, path);
    if (!existsSync(resolvedPath)) {
      throw new Error(`${label}에 필수 Capacitor 생성 파일이 없습니다: ${path}`);
    }
    const stat = lstatSync(resolvedPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`${label}의 Capacitor 생성 항목이 일반 파일이 아닙니다: ${path}`);
    }
    const evidence = { path, bytes: stat.size, sha256: hashFile(resolvedPath) };
    if (evidence.bytes !== 0 || evidence.sha256 !== EMPTY_FILE_SHA256) {
      throw new Error(`${label}의 Capacitor 생성 파일은 정확한 0바이트 파일이어야 합니다: ${path}`);
    }
    return evidence;
  });
}

function readRequiredFileEvidence(root, paths, label) {
  return paths.map((path) => {
    const resolvedPath = resolve(root, path);
    if (!existsSync(resolvedPath)) throw new Error(`${label}에 필수 파일이 없습니다: ${path}`);
    const stat = lstatSync(resolvedPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`${label}의 필수 항목이 일반 파일이 아닙니다: ${path}`);
    }
    return { path, bytes: stat.size, sha256: hashFile(resolvedPath) };
  });
}

function normalizePackagingExcludedFiles(files, label) {
  if (!Array.isArray(files) || files.length !== ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES.length) {
    throw new Error(`${label}의 Android 패키징 제외 파일 목록이 올바르지 않습니다.`);
  }
  const sorted = files.map((file) => ({
    path: typeof file?.path === "string" ? file.path : null,
    bytes: file?.bytes,
    sha256: normalizeSha256(file?.sha256),
  })).sort((left, right) => String(left.path).localeCompare(String(right.path), "en"));
  const expected = [...ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES]
    .sort((left, right) => left.localeCompare(right, "en"));
  if (sorted.some((file, index) => (
    file.path !== expected[index]
    || !Number.isSafeInteger(file.bytes)
    || file.bytes < 1
    || !file.sha256
  ))) {
    throw new Error(`${label}의 Android 패키징 제외 파일 이름·크기·해시가 올바르지 않습니다.`);
  }
  return sorted;
}

function normalizeGeneratedFiles(files, label) {
  if (!Array.isArray(files) || files.length !== CAPACITOR_GENERATED_PUBLIC_FILES.length) {
    throw new Error(`${label}의 Capacitor 생성 파일 목록이 올바르지 않습니다.`);
  }
  const sorted = files.map((file) => ({
    path: typeof file?.path === "string" ? file.path : null,
    bytes: file?.bytes,
    sha256: normalizeSha256(file?.sha256),
  })).sort((left, right) => String(left.path).localeCompare(String(right.path), "en"));
  const expected = [...CAPACITOR_GENERATED_PUBLIC_FILES].sort((left, right) => left.localeCompare(right, "en"));
  if (
    sorted.some((file, index) => (
      file.path !== expected[index]
      || file.bytes !== 0
      || file.sha256 !== EMPTY_FILE_SHA256
    ))
  ) {
    throw new Error(`${label}의 Capacitor 생성 파일 이름·크기·해시가 올바르지 않습니다.`);
  }
  return sorted;
}

function artifactSnapshot(path, label) {
  if (!existsSync(path)) throw new Error(`${label} 파일이 없습니다.`);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label}가 일반 파일이 아닙니다.`);
  return {
    bytes: stat.size,
    mtime: stat.mtime.toISOString(),
    sha256: hashFile(path),
  };
}

function assertArtifactSnapshotUnchanged(path, expected, label) {
  const actual = artifactSnapshot(path, label);
  if (
    actual.bytes !== expected.bytes
    || actual.mtime !== expected.mtime
    || actual.sha256 !== expected.sha256
  ) {
    throw new Error(`${label}가 검증 도중 변경되었습니다.`);
  }
  return actual;
}

function assertDirectorySnapshotUnchanged(root, expected, label, options) {
  const actual = hashDirectory(root, options);
  const normalizedExpected = normalizeDirectoryEvidence(expected, label);
  const normalizedActual = normalizeDirectoryEvidence(actual, label);
  if (!sameDirectoryEvidence(normalizedExpected, normalizedActual)) {
    throw new Error(`${label}가 검증 도중 변경되었습니다.`);
  }
  return normalizedActual;
}

export function assertCapacitorWebAssetsMatchDist({
  sourceDist,
  androidSourceProjection,
  capacitorPublic,
  capacitorProjection,
  embeddedPublic,
  expectedEmbeddedPublic,
  embeddedProjection,
  capacitorGeneratedFiles,
  embeddedGeneratedFiles,
  androidPackagingExcludedFiles,
  capacitorPackagingExcludedFiles,
} = {}) {
  const source = normalizeDirectoryEvidence(sourceDist, "AAB evidence 원본 dist");
  const androidProjected = normalizeDirectoryEvidence(
    androidSourceProjection,
    "Android 패키징용 dist 투영",
  );
  const capacitorRaw = normalizeDirectoryEvidence(capacitorPublic, "Android Capacitor public");
  const capacitorProjected = normalizeDirectoryEvidence(
    capacitorProjection,
    "Android Capacitor dist 투영",
  );
  const embeddedRaw = normalizeDirectoryEvidence(embeddedPublic, "universal APK 내부 assets/public");
  const expectedEmbedded = normalizeDirectoryEvidence(
    expectedEmbeddedPublic,
    "원본 dist 기반 universal APK 기대 투영",
  );
  const embeddedProjected = normalizeDirectoryEvidence(
    embeddedProjection,
    "universal APK 내부 dist 투영",
  );
  const capacitorFiles = normalizeGeneratedFiles(capacitorGeneratedFiles, "Android Capacitor public");
  const embeddedFiles = normalizeGeneratedFiles(embeddedGeneratedFiles, "universal APK 내부 assets/public");
  const excludedFiles = normalizePackagingExcludedFiles(
    androidPackagingExcludedFiles,
    "원본 dist",
  );
  const capacitorExcludedFiles = normalizePackagingExcludedFiles(
    capacitorPackagingExcludedFiles,
    "Android Capacitor public",
  );
  const generatedCount = CAPACITOR_GENERATED_PUBLIC_FILES.length;
  const packagingExcludedCount = ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES.length;

  if (
    !sameDirectoryEvidence(source, capacitorProjected)
    || !sameDirectoryEvidence(androidProjected, embeddedProjected)
    || !sameDirectoryEvidence(expectedEmbedded, embeddedRaw)
    || source.fileCount !== androidProjected.fileCount + packagingExcludedCount
    || capacitorRaw.fileCount !== source.fileCount + generatedCount
    || embeddedRaw.fileCount !== androidProjected.fileCount + generatedCount
    || JSON.stringify(capacitorFiles) !== JSON.stringify(embeddedFiles)
    || JSON.stringify(excludedFiles) !== JSON.stringify(capacitorExcludedFiles)
  ) {
    throw new Error("Capacitor 생성 파일을 제외한 universal APK web assets가 현재 dist와 다릅니다.");
  }

  return {
    projectionVersion: CAPACITOR_PUBLIC_PROJECTION_VERSION,
    sourceDist: source,
    androidSourceProjection: androidProjected,
    capacitorPublic: capacitorRaw,
    embeddedPublic: embeddedRaw,
    embeddedDistProjection: embeddedProjected,
    capacitorGeneratedFiles: capacitorFiles,
    androidPackagingExcludedFiles: excludedFiles,
    matched: true,
  };
}

export function assertEmbeddedWebAssetsMatchDist(sourceDist, embeddedPublic) {
  const source = normalizeDirectoryEvidence(sourceDist, "AAB evidence 원본 dist");
  const embedded = normalizeDirectoryEvidence(embeddedPublic, "universal APK 내부 assets/public");
  if (!sameDirectoryEvidence(source, embedded)) {
    throw new Error("universal APK 내부 web assets가 현재 dist와 다릅니다.");
  }
  return {
    sourceDist: source,
    embeddedPublic: embedded,
    matched: true,
  };
}

export function buildAabEvidence({
  appRoot = resolve(import.meta.dirname, ".."),
  aabPath,
  bundletoolJarPath,
  javaPath = "java",
  jarToolPath = "jar",
  jarsignerPath = "jarsigner",
  keytoolPath = "keytool",
  zipalignPath,
  readelfPath,
  buildType,
  expectedSourceCommit,
  expectedCertificateSha256,
  generatedAt = new Date().toISOString(),
  commandRunner = defaultCommandRunner,
} = {}) {
  const resolvedAabPath = resolve(requiredText(aabPath, "AAB 경로"));
  const resolvedBundletoolPath = resolve(requiredText(bundletoolJarPath, "bundletool JAR 경로"));
  const resolvedJavaPath = resolveExecutable(requiredText(javaPath, "java 경로"));
  const resolvedJarToolPath = resolveExecutable(requiredText(jarToolPath, "jar 경로"));
  const resolvedJarsignerPath = resolveExecutable(requiredText(jarsignerPath, "jarsigner 경로"));
  const resolvedKeytoolPath = resolveExecutable(requiredText(keytoolPath, "keytool 경로"));
  const resolvedZipalignPath = resolve(requiredText(zipalignPath, "zipalign 경로"));
  const resolvedReadelfPath = resolve(requiredText(readelfPath, "llvm-readelf 경로"));
  const variant = requiredText(buildType, "build type");
  if (variant !== "debug" && variant !== "release") {
    throw new Error("build type은 debug 또는 release여야 합니다.");
  }

  const git = readGitState(appRoot);
  const expectedCommit = normalizeCommit(expectedSourceCommit);
  if (!git.head) throw new Error("앱 Git HEAD를 확인할 수 없습니다.");
  if (!expectedCommit || git.head !== expectedCommit) {
    throw new Error("AAB evidence source SHA가 실제 앱 HEAD와 다릅니다.");
  }
  if (variant === "release" && !git.clean) {
    throw new Error("release AAB evidence는 clean 앱 worktree에서만 만들 수 있습니다.");
  }

  const expectedCertificate = normalizeSha256(expectedCertificateSha256);
  if (variant === "release" && !expectedCertificate) {
    throw new Error("release AAB에는 승인된 upload certificate SHA-256이 필요합니다.");
  }

  const metadata = readAppReleaseMetadata(appRoot);
  if (!metadata.applicationId || !metadata.versionCode || !metadata.packageVersion) {
    throw new Error("Android applicationId/versionCode/package version을 확인할 수 없습니다.");
  }
  if (!metadata.gradleUsesPackageVersion) {
    throw new Error("Android versionName이 package.json을 정본으로 사용하지 않습니다.");
  }
  if (!isReleaseVersionPolicySafe(metadata)) {
    throw new Error("app-version.json 정책이 package.json보다 앞서거나 버전 순서가 올바르지 않습니다.");
  }
  const sourceDistRoot = resolve(appRoot, "dist");
  assertNoCapacitorGeneratedFileCollisions(sourceDistRoot);
  const sourceDist = hashDirectory(sourceDistRoot);
  if (!sourceDist || sourceDist.fileCount < 1 || !normalizeSha256(sourceDist.sha256)) {
    throw new Error("AAB evidence를 만들 현재 dist가 없거나 비어 있습니다.");
  }
  const androidSourceProjection = hashDirectory(sourceDistRoot, {
    excludeRelativePaths: ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES,
  });
  const androidPackagingExcludedFiles = readRequiredFileEvidence(
    sourceDistRoot,
    ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES,
    "원본 dist",
  );
  const capacitorPublicRoot = resolve(appRoot, "android", "app", "src", "main", "assets", "public");
  const capacitorPublic = hashDirectory(capacitorPublicRoot);
  const capacitorProjection = hashDirectory(capacitorPublicRoot, {
    excludeRelativePaths: CAPACITOR_GENERATED_PUBLIC_FILES,
  });
  const capacitorGeneratedFiles = readCapacitorGeneratedFiles(
    capacitorPublicRoot,
    "Android Capacitor public",
  );
  const expectedEmbeddedPublic = hashDirectory(sourceDistRoot, {
    excludeRelativePaths: ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES,
    additionalFiles: capacitorGeneratedFiles,
  });
  const capacitorPackagingExcludedFiles = readRequiredFileEvidence(
    capacitorPublicRoot,
    ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES,
    "Android Capacitor public",
  );
  const initialAab = artifactSnapshot(resolvedAabPath, "AAB");
  const workRoot = mkdtempSync(join(tmpdir(), "hyeni-aab-evidence-"));
  try {
    const verifiedAabPath = resolve(workRoot, basename(resolvedAabPath));
    copyFileSync(resolvedAabPath, verifiedAabPath);
    const copiedAab = artifactSnapshot(verifiedAabPath, "AAB 검증 스냅샷");
    if (copiedAab.bytes !== initialAab.bytes || copiedAab.sha256 !== initialAab.sha256) {
      throw new Error("AAB 검증 스냅샷이 원본 시작 해시와 다릅니다.");
    }

  const bundletoolVersion = requiredText(
    bundletool(commandRunner, resolvedJavaPath, resolvedBundletoolPath, ["version"]),
    "bundletool version",
  );
  const bundletoolSha256 = hashFile(resolvedBundletoolPath);
  if (
    bundletoolVersion !== APPROVED_BUNDLETOOL_VERSION
    || bundletoolSha256 !== APPROVED_BUNDLETOOL_SHA256
  ) {
    throw new Error("bundletool 버전 또는 SHA-256이 승인된 공식 고정본과 다릅니다.");
  }
  const aabArchive = archiveEntries(
    commandRunner,
    resolvedJarToolPath,
    verifiedAabPath,
    "aab",
  );
  const manifestDump = requiredText(
    bundletool(commandRunner, resolvedJavaPath, resolvedBundletoolPath, [
      "dump",
      "manifest",
      `--bundle=${verifiedAabPath}`,
    ]),
    "bundletool manifest dump",
  );
  const configDump = requiredText(
    bundletool(commandRunner, resolvedJavaPath, resolvedBundletoolPath, [
      "dump",
      "config",
      `--bundle=${verifiedAabPath}`,
    ]),
    "bundletool config dump",
  );
  const versionCodeText = dumpManifestValue(
    commandRunner,
    resolvedJavaPath,
    resolvedBundletoolPath,
    verifiedAabPath,
    "/manifest/@android:versionCode",
  );
  const versionName = dumpManifestValue(
    commandRunner,
    resolvedJavaPath,
    resolvedBundletoolPath,
    verifiedAabPath,
    "/manifest/@android:versionName",
  );
  const packageName = dumpManifestValue(
    commandRunner,
    resolvedJavaPath,
    resolvedBundletoolPath,
    verifiedAabPath,
    "/manifest/@package",
  );
  const embeddedSourceCommit = normalizeCommit(dumpManifestValue(
    commandRunner,
    resolvedJavaPath,
    resolvedBundletoolPath,
    verifiedAabPath,
    `/manifest/application/meta-data[@android:name='${SOURCE_META_NAME}']/@android:value`,
  ));
  const debuggableText = dumpManifestValue(
    commandRunner,
    resolvedJavaPath,
    resolvedBundletoolPath,
    verifiedAabPath,
    "/manifest/application/@android:debuggable",
  );
  const versionCode = Number(versionCodeText);

  if (!Number.isSafeInteger(versionCode) || versionCode < 1) {
    throw new Error("bundletool이 유효한 versionCode를 반환하지 않았습니다.");
  }
  if (packageName !== metadata.applicationId) throw new Error("AAB package name이 Gradle과 다릅니다.");
  if (versionName !== metadata.packageVersion) throw new Error("AAB versionName이 package.json과 다릅니다.");
  if (versionCode !== metadata.versionCode) throw new Error("AAB versionCode가 Gradle과 다릅니다.");
  if (embeddedSourceCommit !== git.head) throw new Error("AAB 내부 source SHA가 실제 앱 HEAD와 다릅니다.");
  const manifestPolicy = inspectAndroidManifestPolicy(manifestDump, packageName);
  if (variant === "release" && debuggableText.toLowerCase() === "true") {
    throw new Error("release AAB manifest가 debuggable=true입니다.");
  }
  if (variant === "debug" && debuggableText.toLowerCase() !== "true") {
    throw new Error("debug AAB manifest가 debuggable=true가 아닙니다.");
  }
  if (!configDump.includes("PAGE_ALIGNMENT_16K")) {
    throw new Error("AAB config에서 PAGE_ALIGNMENT_16K를 확인하지 못했습니다.");
  }

  const jarsignerResult = commandRunner(resolvedJarsignerPath, [
    "-verify",
    "-verbose",
    "-certs",
    verifiedAabPath,
  ]);
  if (
    !/jar verified/i.test(jarsignerResult.combined)
    || /jar is unsigned|unsigned entries/i.test(jarsignerResult.combined)
  ) {
    throw new Error("jarsigner가 AAB 전체 서명을 verified로 확인하지 못했습니다.");
  }
  const keytoolResult = commandRunner(resolvedKeytoolPath, [
    "-printcert",
    "-jarfile",
    verifiedAabPath,
  ]);
  const certificateSha256 = parseCertificateSha256(keytoolResult.combined);
  if (!certificateSha256) throw new Error("AAB signer certificate SHA-256을 추출하지 못했습니다.");
  if (expectedCertificate && certificateSha256 !== expectedCertificate) {
    throw new Error("AAB signer certificate가 승인된 upload certificate와 다릅니다.");
  }

  let zipalignResult;
  let webAssets = null;
  let apksArchive = null;
  let universalApkArchive = null;
  const elfEvidence = [];
  let loadSegmentCount = 0;
  let minimumLoadAlignment = null;
    const apksPath = resolve(workRoot, "candidate.apks");
    bundletool(commandRunner, resolvedJavaPath, resolvedBundletoolPath, [
      "build-apks",
      `--bundle=${verifiedAabPath}`,
      `--output=${apksPath}`,
      "--mode=universal",
      "--overwrite",
    ]);
    apksArchive = archiveEntries(commandRunner, resolvedJarToolPath, apksPath, "apks");
    if (apksArchive.entries.filter((entry) => entry === "universal.apk").length !== 1) {
      throw new Error("bundletool APKS에 정확히 하나의 universal.apk가 없습니다.");
    }
    const apksExtractRoot = resolve(workRoot, "apks");
    mkdirSync(apksExtractRoot, { recursive: true });
    commandRunner(resolvedJarToolPath, ["xf", apksPath], { cwd: apksExtractRoot });
    const universalApkPath = resolve(apksExtractRoot, "universal.apk");
    statSync(universalApkPath);
    universalApkArchive = archiveEntries(
      commandRunner,
      resolvedJarToolPath,
      universalApkPath,
      "apk",
    );
    zipalignResult = commandRunner(resolvedZipalignPath, [
      "-c",
      "-P",
      "16",
      "-v",
      "4",
      universalApkPath,
    ]);

    const apkExtractRoot = resolve(workRoot, "apk");
    mkdirSync(apkExtractRoot, { recursive: true });
    commandRunner(resolvedJarToolPath, ["xf", universalApkPath], { cwd: apkExtractRoot });
    const embeddedPublicRoot = resolve(apkExtractRoot, "assets", "public");
    webAssets = assertCapacitorWebAssetsMatchDist({
      sourceDist,
      androidSourceProjection,
      capacitorPublic,
      capacitorProjection,
      embeddedPublic: hashDirectory(embeddedPublicRoot),
      expectedEmbeddedPublic,
      embeddedProjection: hashDirectory(embeddedPublicRoot, {
        excludeRelativePaths: CAPACITOR_GENERATED_PUBLIC_FILES,
      }),
      capacitorGeneratedFiles,
      embeddedGeneratedFiles: readCapacitorGeneratedFiles(
        embeddedPublicRoot,
        "universal APK 내부 assets/public",
      ),
      androidPackagingExcludedFiles,
      capacitorPackagingExcludedFiles,
    });
    const soFiles = walkSoFiles(apkExtractRoot);
    if (soFiles.length < 1) throw new Error("16KB 검사 대상 native .so 파일이 없습니다.");
    for (const soPath of soFiles) {
      const result = commandRunner(resolvedReadelfPath, ["-lW", soPath]);
      const loadLines = result.stdout.split(/\r?\n/).filter((line) => /^\s*LOAD\s/.test(line));
      if (loadLines.length < 1) throw new Error(`${basename(soPath)}에 ELF LOAD header가 없습니다.`);
      let fileMinimumAlignment = null;
      for (const line of loadLines) {
        const alignmentText = line.trim().split(/\s+/).at(-1)?.replace(/^0x/i, "");
        const alignment = alignmentText ? Number.parseInt(alignmentText, 16) : Number.NaN;
        if (!Number.isSafeInteger(alignment)) {
          throw new Error(`${basename(soPath)}의 ELF LOAD alignment를 해석할 수 없습니다.`);
        }
        if (alignment < 16_384) {
          throw new Error(`${basename(soPath)}의 ELF LOAD alignment가 16KB보다 작습니다.`);
        }
        fileMinimumAlignment = fileMinimumAlignment === null
          ? alignment
          : Math.min(fileMinimumAlignment, alignment);
        minimumLoadAlignment = minimumLoadAlignment === null
          ? alignment
          : Math.min(minimumLoadAlignment, alignment);
        loadSegmentCount += 1;
      }
      elfEvidence.push({
        path: relative(apkExtractRoot, soPath).replaceAll("\\", "/"),
        loadSegmentCount: loadLines.length,
        minimumLoadAlignment: fileMinimumAlignment,
        sha256: hashFile(soPath),
      });
    }

  const javaVersion = commandRunner(resolvedJavaPath, ["-version"]).combined.trim();
  const readelfVersion = commandRunner(resolvedReadelfPath, ["--version"]).stdout.trim().split(/\r?\n/, 1)[0];
  const manifestText = textEvidence(redactManifestApiKeys(manifestDump));
  const configText = textEvidence(configDump);
  const jarsignerText = textEvidence(jarsignerResult.combined);
  const certificateText = textEvidence(keytoolResult.combined);
  const zipalignText = textEvidence(zipalignResult.combined);
  const elfText = textEvidence(JSON.stringify(elfEvidence));
  if (!webAssets) throw new Error("AAB 내부 web assets 검증 결과가 없습니다.");
  if (!apksArchive || !universalApkArchive) {
    throw new Error("AAB 파생 archive 안전 검증 결과가 없습니다.");
  }
  assertArtifactSnapshotUnchanged(resolvedAabPath, initialAab, "AAB");
  assertDirectorySnapshotUnchanged(sourceDistRoot, sourceDist, "원본 dist");
  assertDirectorySnapshotUnchanged(
    sourceDistRoot,
    androidSourceProjection,
    "Android 패키징용 dist 투영",
    { excludeRelativePaths: ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES },
  );
  assertDirectorySnapshotUnchanged(capacitorPublicRoot, capacitorPublic, "Android Capacitor public");
  assertDirectorySnapshotUnchanged(
    capacitorPublicRoot,
    capacitorProjection,
    "Android Capacitor dist 투영",
    { excludeRelativePaths: CAPACITOR_GENERATED_PUBLIC_FILES },
  );
  const finalCapacitorGeneratedFiles = readCapacitorGeneratedFiles(
    capacitorPublicRoot,
    "Android Capacitor public",
  );
  if (JSON.stringify(finalCapacitorGeneratedFiles) !== JSON.stringify(capacitorGeneratedFiles)) {
    throw new Error("Android Capacitor 생성 파일이 검증 도중 변경되었습니다.");
  }
  const finalAndroidPackagingExcludedFiles = readRequiredFileEvidence(
    sourceDistRoot,
    ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES,
    "원본 dist",
  );
  const finalCapacitorPackagingExcludedFiles = readRequiredFileEvidence(
    capacitorPublicRoot,
    ANDROID_PACKAGING_EXCLUDED_PUBLIC_FILES,
    "Android Capacitor public",
  );
  if (
    JSON.stringify(finalAndroidPackagingExcludedFiles) !== JSON.stringify(androidPackagingExcludedFiles)
    || JSON.stringify(finalCapacitorPackagingExcludedFiles)
      !== JSON.stringify(capacitorPackagingExcludedFiles)
  ) {
    throw new Error("Android 패키징 제외 파일이 검증 도중 변경되었습니다.");
  }
  const archiveSafety = {
    allEntriesSafe: true,
    noDuplicateOrPortableNameCollisions: true,
    noFeatureModuleWebAssets: true,
    aabEntryCount: aabArchive.entryCount,
    apksEntryCount: apksArchive.entryCount,
    universalApkEntryCount: universalApkArchive.entryCount,
  };
  const integrity = {
    aabStableDuringVerification: true,
    sourceDistStableDuringVerification: true,
    androidSourceProjectionStableDuringVerification: true,
    capacitorPublicStableDuringVerification: true,
  };
  const verificationLog = [
    "[bundletool manifest]",
    manifestText.value.trimEnd(),
    "[Android manifest policy]",
    JSON.stringify(manifestPolicy, null, 2),
    "[bundletool config]",
    configText.value.trimEnd(),
    "[jarsigner verify]",
    jarsignerText.value.trimEnd(),
    "[keytool certificate]",
    certificateText.value.trimEnd(),
    "[zipalign -P 16]",
    zipalignText.value.trimEnd(),
    "[embedded web assets parity]",
    JSON.stringify(webAssets, null, 2),
    "[archive entry safety]",
    JSON.stringify(archiveSafety, null, 2),
    "[verification input stability]",
    JSON.stringify(integrity, null, 2),
    "[ELF LOAD alignment summary]",
    JSON.stringify(elfEvidence, null, 2),
    "",
  ].join("\n");

  return {
    evidence: {
      schemaVersion: 4,
      artifactKind: "hyeni-android-aab",
      generatedAt,
      buildType: variant,
      sourceCommit: git.head,
      app: {
        packageName,
        packageVersion: metadata.packageVersion,
        minimumSupportedVersion: metadata.minimumSupportedVersion,
        latestVersion: metadata.latestVersion,
      },
      manifest: {
        versionName,
        versionCode,
        sourceCommit: embeddedSourceCommit,
        debuggable: debuggableText.toLowerCase() === "true",
        policy: manifestPolicy,
      },
      aab: {
        fileName: basename(resolvedAabPath),
        ...initialAab,
      },
      webAssets,
      archiveSafety,
      integrity,
      signature: {
        jarsignerVerified: true,
        certificateSha256,
        expectedCertificateSha256: expectedCertificate,
        expectedCertificateMatched: expectedCertificate ? certificateSha256 === expectedCertificate : null,
        jarsignerOutputSha256: jarsignerText.sha256,
        certificateOutputSha256: certificateText.sha256,
      },
      alignment16Kb: {
        bundleConfigPageAlignment16Kb: true,
        universalApkZipAligned16Kb: true,
        nativeLibraryCount: elfEvidence.length,
        elfLoadSegmentCount: loadSegmentCount,
        minimumElfLoadAlignment: minimumLoadAlignment,
        allElfLoadSegmentsAtLeast16384: minimumLoadAlignment !== null && minimumLoadAlignment >= 16_384,
        bundleConfigOutputSha256: configText.sha256,
        zipalignOutputSha256: zipalignText.sha256,
        elfSummarySha256: elfText.sha256,
        elfLibraries: elfEvidence,
      },
      tools: {
        bundletool: {
          version: bundletoolVersion,
          fileName: basename(resolvedBundletoolPath),
          sha256: bundletoolSha256,
        },
        java: { versionOutput: javaVersion },
        jarsigner: toolEvidence(resolvedJarsignerPath),
        keytool: toolEvidence(resolvedKeytoolPath),
        zipalign: toolEvidence(resolvedZipalignPath),
        readelf: { versionOutput: readelfVersion, ...toolEvidence(resolvedReadelfPath) },
      },
      verificationLog: {
        fileName: null,
        bytes: Buffer.byteLength(verificationLog, "utf8"),
        sha256: sha256(verificationLog),
      },
    },
    verificationLog,
  };
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} 값이 필요합니다.`);
  return value;
}

function outputPath(appRoot, value) {
  return isAbsolute(value) ? value : resolve(appRoot, value);
}

function run() {
  const appRoot = resolve(argument("app-root") ?? resolve(import.meta.dirname, ".."));
  const out = outputPath(appRoot, requiredText(argument("out"), "--out"));
  const logOut = outputPath(
    appRoot,
    argument("verification-log-out") ?? `${out}.verification.txt`,
  );
  if (resolve(out) === resolve(logOut)) {
    throw new Error("evidence JSON과 verification log는 서로 다른 경로여야 합니다.");
  }
  if (existsSync(out) || existsSync(logOut)) {
    throw new Error("기존 release evidence 파일은 덮어쓰지 않습니다. 새 출력 경로를 사용하세요.");
  }
  const { evidence, verificationLog } = buildAabEvidence({
    appRoot,
    aabPath: outputPath(appRoot, requiredText(argument("aab"), "--aab")),
    bundletoolJarPath: outputPath(
      appRoot,
      requiredText(argument("bundletool-jar") ?? process.env.BUNDLETOOL_JAR, "--bundletool-jar"),
    ),
    javaPath: argument("java") ?? "java",
    jarToolPath: argument("jar") ?? "jar",
    jarsignerPath: argument("jarsigner") ?? "jarsigner",
    keytoolPath: argument("keytool") ?? "keytool",
    zipalignPath: outputPath(appRoot, requiredText(argument("zipalign"), "--zipalign")),
    readelfPath: outputPath(appRoot, requiredText(argument("readelf"), "--readelf")),
    buildType: requiredText(argument("build-type"), "--build-type"),
    expectedSourceCommit: argument("expected-source-sha") ?? process.env.GITHUB_SHA,
    expectedCertificateSha256:
      argument("expected-certificate-sha256") ?? process.env.HYENI_RELEASE_UPLOAD_CERTIFICATE_SHA256,
  });
  evidence.verificationLog.fileName = basename(logOut);
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(logOut), { recursive: true });
  writeFileSync(logOut, verificationLog, { encoding: "utf8", flag: "wx" });
  writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${out}\n${logOut}\n`);
}

const isDirect = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirect) run();
