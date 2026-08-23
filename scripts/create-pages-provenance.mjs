import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  hashDirectory,
  hashFile,
  isReleaseVersionPolicySafe,
  normalizeCommit,
  readAppReleaseMetadata,
  readGitState,
} from "./release-evidence.mjs";

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 값이 필요합니다.`);
  return value.trim();
}

export function buildPagesProvenance({
  appRoot = resolve(import.meta.dirname, ".."),
  distPath = resolve(appRoot, "dist"),
  expectedSourceCommit,
  ciRunId,
  ciRunAttempt,
  repository = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const git = readGitState(appRoot);
  const expectedCommit = normalizeCommit(expectedSourceCommit);
  if (!git.head) throw new Error("앱 Git HEAD를 확인할 수 없습니다.");
  if (!git.clean) throw new Error("Pages provenance는 clean 앱 worktree에서만 만들 수 있습니다.");
  if (!expectedCommit || git.head !== expectedCommit) {
    throw new Error("Pages provenance source SHA가 실제 앱 HEAD와 다릅니다.");
  }

  const metadata = readAppReleaseMetadata(appRoot);
  if (!isReleaseVersionPolicySafe(metadata)) {
    throw new Error("app-version.json 정책이 package.json보다 앞서거나 버전 순서가 올바르지 않습니다.");
  }
  if (!metadata.gradleUsesPackageVersion) {
    throw new Error("Android versionName이 package.json을 정본으로 사용하지 않습니다.");
  }

  const dist = hashDirectory(distPath);
  if (!dist || dist.fileCount < 1) throw new Error("검증할 Pages dist가 비어 있거나 없습니다.");
  const runId = requiredText(ciRunId, "CI run ID");
  const runAttempt = requiredText(ciRunAttempt, "CI run attempt");

  return {
    schemaVersion: 1,
    artifactKind: "hyeni-pages-dist",
    generatedAt,
    source: {
      repository: typeof repository === "string" && repository.trim() ? repository.trim() : null,
      commit: git.head,
    },
    ci: {
      runId,
      runAttempt,
      artifactName: `hyeni-pages-dist-${git.head}`,
    },
    app: {
      packageVersion: metadata.packageVersion,
      minimumSupportedVersion: metadata.minimumSupportedVersion,
      latestVersion: metadata.latestVersion,
      packageLockSha256: hashFile(resolve(appRoot, "package-lock.json")),
    },
    dist,
  };
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
  const out = requiredText(argument("out"), "--out");
  const provenance = buildPagesProvenance({
    appRoot,
    distPath: argument("dist") ? outputPath(appRoot, argument("dist")) : resolve(appRoot, "dist"),
    expectedSourceCommit: argument("expected-source-sha") ?? process.env.GITHUB_SHA,
    ciRunId: argument("ci-run-id") ?? process.env.GITHUB_RUN_ID,
    ciRunAttempt: argument("ci-run-attempt") ?? process.env.GITHUB_RUN_ATTEMPT,
    repository: argument("repository") ?? process.env.GITHUB_REPOSITORY,
  });
  const target = outputPath(appRoot, out);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(provenance, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${target}\n`);
}

const isDirect = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirect) run();
