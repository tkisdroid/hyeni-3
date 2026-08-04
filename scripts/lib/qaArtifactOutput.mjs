import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

export function createQaRunId(
  now = new Date(),
  processId = process.pid,
  uniqueId = randomUUID(),
) {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${timestamp}-p${processId}-${uniqueId.slice(0, 8)}`;
}

export function resolveQaOutputDir(
  args,
  { rootDir, outputRoot, runId = createQaRunId() },
) {
  let requestedDir = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== "--out-dir") {
      throw new Error(`지원하지 않는 QA 인자입니다: ${argument}`);
    }
    if (requestedDir !== null) {
      throw new Error("--out-dir는 한 번만 지정할 수 있습니다");
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("--out-dir 뒤에 출력 디렉터리를 지정해야 합니다");
    }
    requestedDir = value;
    index += 1;
  }

  if (requestedDir === null) return resolve(outputRoot, runId);
  return isAbsolute(requestedDir) ? resolve(requestedDir) : resolve(rootDir, requestedDir);
}

export async function prepareFreshQaOutputDir(outputDir) {
  const target = resolve(outputDir);
  await mkdir(dirname(target), { recursive: true });
  try {
    await mkdir(target, { recursive: false });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`QA 증거 디렉터리가 이미 존재합니다. 기존 증거를 덮어쓰지 않습니다: ${target}`);
    }
    throw error;
  }
  return target;
}
