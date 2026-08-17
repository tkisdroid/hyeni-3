import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const viteBin = resolve(ROOT_DIR, "node_modules", "vite", "bin", "vite.js");

/**
 * 로컬 UI 검증용 preview 서버를 shell 없이 시작한다.
 * 호출자는 검증 완료 뒤 반환된 프로세스를 반드시 종료해야 한다.
 */
export function startLocalVitePreview({ port, cwd = ROOT_DIR } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("UI 하니스 포트는 1부터 65535 사이의 정수여야 합니다");
  }
  if (!existsSync(viteBin)) {
    throw new Error("로컬 Vite 실행 파일이 없습니다. 먼저 npm ci를 실행하세요");
  }

  return spawn(process.execPath, [viteBin, "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd,
    env: {},
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
}
