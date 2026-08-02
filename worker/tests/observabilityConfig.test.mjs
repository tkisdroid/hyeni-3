import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function tomlSection(source, name) {
  const header = `[${name}]`;
  const start = source.indexOf(header);
  if (start < 0) return "";
  const end = source.indexOf("\n[", start + header.length);
  return source.slice(start, end < 0 ? undefined : end);
}

test("초기 출시 Worker는 구조화 로그를 전수 수집하되 요청 URL invocation 저장은 끈다", () => {
  const wrangler = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const observability = tomlSection(wrangler, "observability");
  const logs = tomlSection(wrangler, "observability.logs");
  const versionMetadata = tomlSection(wrangler, "version_metadata");

  assert.match(observability, /enabled\s*=\s*true/);
  assert.match(observability, /head_sampling_rate\s*=\s*1(?:\.0)?\b/);
  assert.match(logs, /enabled\s*=\s*true/);
  assert.match(logs, /invocation_logs\s*=\s*false/);
  assert.match(logs, /head_sampling_rate\s*=\s*1(?:\.0)?\b/);
  assert.match(versionMetadata, /binding\s*=\s*"CF_VERSION_METADATA"/);
});

test("Worker Env는 배포 버전 메타데이터 바인딩을 명시한다", () => {
  const types = readFileSync(new URL("../types.ts", import.meta.url), "utf8");

  assert.match(types, /CF_VERSION_METADATA:\s*WorkerVersionMetadata/);
});
