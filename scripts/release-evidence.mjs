import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { relative, resolve } from "node:path";

export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const COMMIT_PATTERN = /^[a-f0-9]{40}$/;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeSha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value.trim().toLowerCase())
    ? value.trim().toLowerCase()
    : null;
}

export function normalizeCommit(value) {
  return typeof value === "string" && COMMIT_PATTERN.test(value.trim().toLowerCase())
    ? value.trim().toLowerCase()
    : null;
}

function parseReleaseVersion(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+){0,3}$/.test(value)) return null;
  const parts = value.split(".").map(Number);
  return parts.every((part) => Number.isSafeInteger(part) && part >= 0) ? parts : null;
}

function compareReleaseVersions(left, right) {
  const leftParts = parseReleaseVersion(left);
  const rightParts = parseReleaseVersion(right);
  if (!leftParts || !rightParts) return null;
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
}

export function isReleaseVersionPolicySafe({
  packageVersion,
  minimumSupportedVersion,
  latestVersion,
} = {}) {
  const minimumToLatest = compareReleaseVersions(minimumSupportedVersion, latestVersion);
  const latestToPackage = compareReleaseVersions(latestVersion, packageVersion);
  return minimumToLatest !== null
    && latestToPackage !== null
    && minimumToLatest <= 0
    && latestToPackage <= 0;
}

export function hashFile(path) {
  return sha256(readFileSync(path));
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

function walkFiles(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => compareNames(a.name, b.name))) {
    const path = resolve(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`릴리스 산출물에 symbolic link를 둘 수 없습니다: ${relative(root, path)}`);
    }
    if (entry.isDirectory()) files.push(...walkFiles(root, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`지원하지 않는 릴리스 산출물 항목입니다: ${relative(root, path)}`);
  }
  return files;
}

export function hashDirectory(root, { excludeRelativePaths = [], additionalFiles = [] } = {}) {
  if (!existsSync(root) || !statSync(root).isDirectory()) return null;
  const excluded = new Set(excludeRelativePaths.map((name) => String(name).replaceAll("\\", "/")));
  const manifestEntries = walkFiles(root).flatMap((path) => {
    const name = relative(root, path).replaceAll("\\", "/");
    return excluded.has(name) ? [] : [{
      path: name,
      bytes: statSync(path).size,
      sha256: hashFile(path),
    }];
  });
  const existingNames = new Set(manifestEntries.map((entry) => entry.path));
  for (const file of additionalFiles) {
    const name = typeof file?.path === "string" ? file.path : "";
    const segments = name.split("/");
    if (
      !name
      || name.includes("\\")
      || name.startsWith("/")
      || segments.some((segment) => !segment || segment === "." || segment === "..")
      || existingNames.has(name)
      || !Number.isSafeInteger(file?.bytes)
      || file.bytes < 0
      || !normalizeSha256(file?.sha256)
    ) {
      throw new Error(`추가 release manifest 파일이 올바르지 않습니다: ${name || "(empty)"}`);
    }
    existingNames.add(name);
    manifestEntries.push({ path: name, bytes: file.bytes, sha256: normalizeSha256(file.sha256) });
  }
  manifestEntries.sort((left, right) => compareManifestPaths(left.path, right.path));
  const manifest = manifestEntries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`);
  return {
    fileCount: manifest.length,
    sha256: sha256(`${manifest.join("\n")}\n`),
  };
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function readGitState(root) {
  try {
    const porcelain = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
    return {
      head: normalizeCommit(git(root, ["rev-parse", "HEAD"])),
      branch: git(root, ["branch", "--show-current"]) || null,
      clean: porcelain.length === 0,
      changedEntryCount: porcelain ? porcelain.split(/\r?\n/).length : 0,
    };
  } catch (error) {
    return {
      head: null,
      branch: null,
      clean: false,
      changedEntryCount: null,
      error: error instanceof Error ? error.message.split(/\r?\n/, 1)[0] : "git_state_unavailable",
    };
  }
}

export function fileEvidence(path, root) {
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  if (!stat.isFile()) return null;
  return {
    path: relative(root, path).replaceAll("\\", "/"),
    bytes: stat.size,
    mtime: stat.mtime.toISOString(),
    sha256: hashFile(path),
  };
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readAppReleaseMetadata(appRoot) {
  const packageJson = readJson(resolve(appRoot, "package.json"));
  const versionPolicy = readJson(resolve(appRoot, "public", "app-version.json"));
  const gradle = readFileSync(resolve(appRoot, "android", "app", "build.gradle"), "utf8");
  const applicationId = gradle.match(/^\s*applicationId\s+["']([^"']+)["']/m)?.[1] ?? null;
  const versionCodeText = gradle.match(/^\s*versionCode\s+(\d+)\s*$/m)?.[1] ?? null;
  const versionCode = versionCodeText ? Number(versionCodeText) : null;
  const packageVersion = typeof packageJson.version === "string" ? packageJson.version : null;
  const minimumSupportedVersion = typeof versionPolicy.minimumSupportedVersion === "string"
    ? versionPolicy.minimumSupportedVersion
    : null;
  const latestVersion = typeof versionPolicy.latestVersion === "string"
    ? versionPolicy.latestVersion
    : null;

  return {
    applicationId,
    versionCode: Number.isSafeInteger(versionCode) && versionCode > 0 ? versionCode : null,
    packageVersion,
    minimumSupportedVersion,
    latestVersion,
    gradleUsesPackageVersion: /versionName\s+hyeniPackageVersion\b/.test(gradle),
  };
}
